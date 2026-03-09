/**
 * Prisma Schema Hashing
 * Deterministic schema normalization and validation
 */

import * as crypto from 'crypto';

/**
 * Normalize a Prisma schema for hashing
 * Removes comments, normalizes whitespace, sorts model definitions
 */
export function normalizePrismaSchema(schema: string): string {
  // Remove single-line comments
  let normalized = schema.replace(/\/\/.*$/gm, '');
  
  // Remove multi-line comments
  normalized = normalized.replace(/\/\*[\s\S]*?\*\//g, '');
  
  // Normalize whitespace: collapse multiple spaces/newlines
  normalized = normalized.replace(/\s+/g, ' ').trim();
  
  return normalized;
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
  const modelRegex = new RegExp(`model\\s+${modelName}\\s*{([^}]+)}`, 's');
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
