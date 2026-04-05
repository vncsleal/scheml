/**
 * Prisma Schema Hashing
 * Deterministic schema normalization and validation
 */

import * as crypto from 'crypto';

/**
 * Normalize a Prisma schema for hashing.
 *
 * Guarantees the output is invariant to:
 * - Comments
 * - Whitespace / indentation (including `prisma format` alignment)
 * - Field declaration order within a model or enum block
 * - Model / enum block order within the file
 *
 * This means the hash is stable across `prisma format` runs and across any
 * manual reordering of fields or models, as long as the schema semantics are
 * unchanged.
 */
export function normalizePrismaSchema(schema: string): string {
  // 1. Strip comments
  const text = schema
    .replace(/\/\/.*$/gm, '')       // single-line
    .replace(/\/\*[\s\S]*?\*\//g, ''); // block

  // 2. Parse top-level blocks (datasource, generator, model, enum, type).
  //    Prisma block bodies never contain nested braces so [^}]* is safe.
  const blockRe = /\b(datasource|generator|model|enum|type)\s+(\w+)\s*\{([^}]*)\}/g;

  interface ParsedBlock {
    keyword: string;
    name: string;
    body: string;
  }

  const blocks: ParsedBlock[] = [];
  let m: RegExpExecArray | null;
  while ((m = blockRe.exec(text)) !== null) {
    blocks.push({ keyword: m[1], name: m[2], body: m[3] });
  }

  // 3. Canonicalize the body of each block:
  //    - Collapse whitespace within each line
  //    - model/enum: sort field lines alphabetically, then sort @@-directives
  //      (keeping them after fields, since they apply to the block as a whole)
  //    - datasource/generator: preserve declaration order (some tools are
  //      order-sensitive for key=value pairs in these blocks)
  function canonicalizeBody(keyword: string, body: string): string {
    const lines = body
      .split('\n')
      .map(l => l.replace(/\s+/g, ' ').trim())
      .filter(Boolean);

    if (keyword === 'model' || keyword === 'enum') {
      const fields     = lines.filter(l => !l.startsWith('@@')).sort();
      const directives = lines.filter(l =>  l.startsWith('@@')).sort();
      return [...fields, ...directives].join(' ');
    }
    return lines.join(' ');
  }

  // 4. Sort blocks for ordering invariance:
  //    datasource/generator stay first in their original order.
  //    model, enum, type blocks are sorted by name.
  const priority = blocks.filter(b => b.keyword === 'datasource' || b.keyword === 'generator');
  const enums    = blocks.filter(b => b.keyword === 'enum').sort((a, b) => a.name.localeCompare(b.name));
  const models   = blocks.filter(b => b.keyword === 'model').sort((a, b) => a.name.localeCompare(b.name));
  const types    = blocks.filter(b => b.keyword === 'type').sort((a, b) => a.name.localeCompare(b.name));

  return [...priority, ...enums, ...models, ...types]
    .map(b => `${b.keyword} ${b.name} { ${canonicalizeBody(b.keyword, b.body)} }`)
    .join(' ');
}

/**
 * Compute SHA256 hash of normalized schema
 */
export function hashPrismaSchema(schema: string): string {
  const normalized = normalizePrismaSchema(schema);
  return crypto
    .createHash('sha256')
    .update(normalized, 'utf-8')
    .digest('hex');
}

/**
 * Compute SHA256 hash scoped to a single Prisma model and its referenced enums.
 *
 * Unlike hashPrismaSchema, this hash is stable across changes to unrelated
 * models. Adding a new `BlogPost` model while `User` is unchanged no longer
 * triggers SchemaDriftError for a User-based prediction model.
 */
export function hashPrismaModelSubset(schema: string, modelName: string): string {
  // Parse all blocks using the same normalization used by the full schema hash
  const text = schema
    .replace(/\/\/.*$/gm, '')
    .replace(/\/\*[\s\S]*?\*\//g, '');

  const blockRe = /\b(datasource|generator|model|enum|type)\s+(\w+)\s*\{([^}]*)\}/g;
  const allBlocks = new Map<string, { keyword: string; name: string; body: string }>();
  let m: RegExpExecArray | null;
  while ((m = blockRe.exec(text)) !== null) {
    allBlocks.set(m[2], { keyword: m[1], name: m[2], body: m[3] });
  }

  const modelBlock = allBlocks.get(modelName);
  if (!modelBlock) {
    // Fall back to full hash if the model block can't be isolated
    return hashPrismaSchema(schema);
  }

  // Collect enum names referenced in the model block body
  const enumNames = Array.from(allBlocks.values())
    .filter((b) => b.keyword === 'enum')
    .map((b) => b.name);

  const referencedEnums = enumNames.filter((name) =>
    new RegExp(`\\b${name}\\b`).test(modelBlock.body)
  );

  const subsetBlocks = [
    modelBlock,
    ...referencedEnums.map((n) => allBlocks.get(n)).filter(Boolean),
  ] as { keyword: string; name: string; body: string }[];

  // Reuse canonicalization from normalizePrismaSchema
  const normalized = normalizePrismaSchema(
    subsetBlocks.map((b) => `${b.keyword} ${b.name} {\n${b.body}\n}`).join('\n\n')
  );

  return crypto.createHash('sha256').update(normalized, 'utf-8').digest('hex');
}

/**
 * Validate schema hash consistency
 */
export function validateSchemaHash(
  expected: string,
  actual: string
): { valid: boolean; expectedHash: string; actualHash: string } {
  return {
    valid: expected === actual,
    expectedHash: expected,
    actualHash: actual,
  };
}

/**
 * Extract model names from Prisma schema
 */
export function extractModelNames(schema: string): string[] {
  const modelRegex = /model\s+(\w+)\s*{/g;
  const models: string[] = [];
  let match;

  while ((match = modelRegex.exec(schema)) !== null) {
    models.push(match[1]);
  }

  return models;
}

/**
 * Parse Prisma schema to extract field definitions for a model
 */
export function parseModelSchema(
  schema: string,
  modelName: string
): Record<string, { type: string; optional: boolean }> {
  const escapedName = modelName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const modelRegex = new RegExp(`model\\s+${escapedName}\\s*{([^}]+)}`, 's');
  const match = schema.match(modelRegex);

  if (!match) {
    return {};
  }

  const fields: Record<string, { type: string; optional: boolean }> = {};
  const fieldLines = match[1].split('\n');

  for (const line of fieldLines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('@@')) continue;

    // Parse field: name Type? modifiers
    const fieldRegex = /^(\w+)\s+([\w\[\]]+)(\?)?/;
    const fieldMatch = trimmed.match(fieldRegex);

    if (fieldMatch) {
      const [, fieldName, fieldType, optional] = fieldMatch;
      fields[fieldName] = {
        type: fieldType,
        optional: !!optional,
      };
    }
  }

  return fields;
}
