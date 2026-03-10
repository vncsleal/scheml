import { describe, it, expect } from 'vitest';
import {
  normalizePrismaSchema,
  hashPrismaSchema,
  validateSchemaHash,
  extractModelNames,
  parseModelSchema,
} from './schema';

const SAMPLE_SCHEMA = `
// This is a comment
model User {
  id        String   @id @default(cuid())
  email     String   @unique
  createdAt DateTime @default(now())
  plan      String
  monthlySpend Float?
}

/* block comment */
model Product {
  id    String @id
  price Float
  stock Int
}
`;

describe('normalizePrismaSchema', () => {
  it('removes single-line comments', () => {
    const result = normalizePrismaSchema('// comment\nmodel User { id String }');
    expect(result).not.toContain('//');
    expect(result).toContain('model User');
  });

  it('removes block comments', () => {
    const result = normalizePrismaSchema('/* block */\nmodel User { id String }');
    expect(result).not.toContain('/*');
    expect(result).not.toContain('*/');
  });

  it('collapses whitespace', () => {
    const result = normalizePrismaSchema('model   User   {  id  String  }');
    expect(result).not.toMatch(/\s{2,}/);
  });

  it('produces identical output for semantically-equivalent schemas (whitespace)', () => {
    const a = normalizePrismaSchema('model User {\n  id String\n}');
    const b = normalizePrismaSchema('model User {   id String   }');
    expect(a).toBe(b);
  });

  it('is invariant to field order within a model block', () => {
    const a = normalizePrismaSchema('model User {\n  id String\n  name String\n  email String\n}');
    const b = normalizePrismaSchema('model User {\n  email String\n  id String\n  name String\n}');
    expect(a).toBe(b);
  });

  it('keeps @@ directives after field lines regardless of original position', () => {
    const a = normalizePrismaSchema('model User {\n  @@map("users")\n  id String @id\n  email String\n}');
    const b = normalizePrismaSchema('model User {\n  id String @id\n  email String\n  @@map("users")\n}');
    expect(a).toBe(b);
  });

  it('is invariant to model block order within the file', () => {
    const a = normalizePrismaSchema('model User { id String }\nmodel Post { id String }');
    const b = normalizePrismaSchema('model Post { id String }\nmodel User { id String }');
    expect(a).toBe(b);
  });
});

describe('hashPrismaSchema', () => {
  it('returns a 64-character hex string (SHA256)', () => {
    const hash = hashPrismaSchema(SAMPLE_SCHEMA);
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('is deterministic — same schema produces same hash', () => {
    const h1 = hashPrismaSchema(SAMPLE_SCHEMA);
    const h2 = hashPrismaSchema(SAMPLE_SCHEMA);
    expect(h1).toBe(h2);
  });

  it('is comment-insensitive — adding a comment does not change hash', () => {
    const withComment = SAMPLE_SCHEMA + '\n// trailing comment';
    expect(hashPrismaSchema(SAMPLE_SCHEMA)).toBe(hashPrismaSchema(withComment));
  });

  it('is field-order invariant — reordering fields does not change the hash', () => {
    const a = `model User {\n  id String @id\n  email String\n  plan String\n}`;
    const b = `model User {\n  plan String\n  id String @id\n  email String\n}`;
    expect(hashPrismaSchema(a)).toBe(hashPrismaSchema(b));
  });

  it('is model-order invariant — reordering model blocks does not change the hash', () => {
    const a = `model User { id String }\nmodel Post { id String }`;
    const b = `model Post { id String }\nmodel User { id String }`;
    expect(hashPrismaSchema(a)).toBe(hashPrismaSchema(b));
  });

  it('is change-sensitive — modifying a field changes the hash', () => {
    const modified = SAMPLE_SCHEMA.replace('email     String   @unique', 'email String');
    expect(hashPrismaSchema(SAMPLE_SCHEMA)).not.toBe(hashPrismaSchema(modified));
  });

  it('is change-sensitive — adding a new field changes the hash', () => {
    const modified = SAMPLE_SCHEMA.replace(
      'monthlySpend Float?',
      'monthlySpend Float?\n  newField String'
    );
    expect(hashPrismaSchema(SAMPLE_SCHEMA)).not.toBe(hashPrismaSchema(modified));
  });
});

describe('validateSchemaHash', () => {
  it('returns valid: true when hashes match', () => {
    const hash = hashPrismaSchema(SAMPLE_SCHEMA);
    const result = validateSchemaHash(hash, hash);
    expect(result.valid).toBe(true);
  });

  it('returns valid: false when hashes differ', () => {
    const result = validateSchemaHash('abc123', 'def456');
    expect(result.valid).toBe(false);
  });

  it('exposes both hashes in the result', () => {
    const result = validateSchemaHash('expected', 'actual');
    expect(result.expectedHash).toBe('expected');
    expect(result.actualHash).toBe('actual');
  });
});

describe('extractModelNames', () => {
  it('extracts all model names from a schema', () => {
    const names = extractModelNames(SAMPLE_SCHEMA);
    expect(names).toContain('User');
    expect(names).toContain('Product');
  });

  it('returns empty array for schema with no models', () => {
    expect(extractModelNames('// just a comment')).toEqual([]);
  });

  it('does not include enum names', () => {
    const schema = 'model User { id String }\nenum Role { ADMIN USER }';
    const names = extractModelNames(schema);
    expect(names).toContain('User');
    expect(names).not.toContain('Role');
  });
});

describe('parseModelSchema', () => {
  it('parses all fields for a given model', () => {
    const fields = parseModelSchema(SAMPLE_SCHEMA, 'User');
    expect(fields['id']).toBeDefined();
    expect(fields['email']).toBeDefined();
    expect(fields['plan']).toBeDefined();
  });

  it('marks optional fields correctly', () => {
    const fields = parseModelSchema(SAMPLE_SCHEMA, 'User');
    expect(fields['monthlySpend']?.optional).toBe(true);
    expect(fields['email']?.optional).toBe(false);
  });

  it('captures field types', () => {
    const fields = parseModelSchema(SAMPLE_SCHEMA, 'Product');
    expect(fields['price']?.type).toBe('Float');
    expect(fields['stock']?.type).toBe('Int');
  });

  it('returns empty object for unknown model', () => {
    const fields = parseModelSchema(SAMPLE_SCHEMA, 'NonExistent');
    expect(Object.keys(fields)).toHaveLength(0);
  });
});
