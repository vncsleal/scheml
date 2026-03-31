/**
 * Adapter tests — Phase 3
 *
 * Tests for the adapter interface implementations:
 *  - PrismaSchemaReader (SchemaGraph construction, field mapping, model hashing)
 *  - ZodSchemaReader (ZodObject traversal, optional/nullable fields, enum detection)
 *  - DrizzleSchemaReader (column introspection from runtime table objects)
 *  - getAdapter / registerAdapter registry
 */

import { describe, it, expect, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PrismaSchemaReader } from './adapters/prisma';
import { ZodSchemaReader, createZodAdapter } from './adapters/zod';
import { DrizzleSchemaReader, createDrizzleAdapter } from './adapters/drizzle';
import { getAdapter, registerAdapter, listAdapters } from './adapters/index';

// ---------------------------------------------------------------------------
// Shared Prisma schema fixture
// ---------------------------------------------------------------------------

const PRISMA_SCHEMA = `
model User {
  id          Int      @id @default(autoincrement())
  email       String   @unique
  active      Boolean
  score       Float?
  plan        String
  createdAt   DateTime @default(now())
}

enum Role {
  ADMIN
  MEMBER
}

model Post {
  id       Int    @id
  title    String
  authorId Int
}
`;

// Write the schema to a temp file so PrismaSchemaReader can read it
function writeTmpSchema(content: string): string {
  const filePath = path.join(os.tmpdir(), `scheml-test-${Date.now()}.prisma`);
  fs.writeFileSync(filePath, content, 'utf-8');
  return filePath;
}

// ---------------------------------------------------------------------------
// PrismaSchemaReader
// ---------------------------------------------------------------------------

describe('PrismaSchemaReader', () => {
  let schemaPath: string;

  beforeEach(() => {
    schemaPath = writeTmpSchema(PRISMA_SCHEMA);
  });

  it('reads all models into entities map', async () => {
    const reader = new PrismaSchemaReader();
    const graph = await reader.readSchema(schemaPath);
    expect(graph.entities.has('User')).toBe(true);
    expect(graph.entities.has('Post')).toBe(true);
  });

  it('does not include enums as entities', async () => {
    const reader = new PrismaSchemaReader();
    const graph = await reader.readSchema(schemaPath);
    expect(graph.entities.has('Role')).toBe(false);
  });

  it('maps Prisma Int → number', async () => {
    const reader = new PrismaSchemaReader();
    const graph = await reader.readSchema(schemaPath);
    expect(graph.entities.get('User')!.fields['id'].scalarType).toBe('number');
  });

  it('maps Prisma String → string', async () => {
    const reader = new PrismaSchemaReader();
    const graph = await reader.readSchema(schemaPath);
    expect(graph.entities.get('User')!.fields['email'].scalarType).toBe('string');
  });

  it('maps Prisma Boolean → boolean', async () => {
    const reader = new PrismaSchemaReader();
    const graph = await reader.readSchema(schemaPath);
    expect(graph.entities.get('User')!.fields['active'].scalarType).toBe('boolean');
  });

  it('maps Prisma DateTime → date', async () => {
    const reader = new PrismaSchemaReader();
    const graph = await reader.readSchema(schemaPath);
    expect(graph.entities.get('User')!.fields['createdAt'].scalarType).toBe('date');
  });

  it('marks optional fields as nullable', async () => {
    const reader = new PrismaSchemaReader();
    const graph = await reader.readSchema(schemaPath);
    expect(graph.entities.get('User')!.fields['score'].nullable).toBe(true);
  });

  it('marks required fields as non-nullable', async () => {
    const reader = new PrismaSchemaReader();
    const graph = await reader.readSchema(schemaPath);
    expect(graph.entities.get('User')!.fields['email'].nullable).toBe(false);
  });

  it('preserves rawSource in the graph', async () => {
    const reader = new PrismaSchemaReader();
    const graph = await reader.readSchema(schemaPath);
    expect(graph.rawSource).toContain('model User');
  });

  it('hashModel returns a deterministic 64-char hex string', async () => {
    const reader = new PrismaSchemaReader();
    const graph = await reader.readSchema(schemaPath);
    const hash1 = reader.hashModel(graph, 'User');
    const hash2 = reader.hashModel(graph, 'User');
    expect(hash1).toMatch(/^[0-9a-f]{64}$/);
    expect(hash1).toBe(hash2);
  });

  it('hashModel is stable across schema re-reads', async () => {
    const reader = new PrismaSchemaReader();
    const graph1 = await reader.readSchema(schemaPath);
    const graph2 = await reader.readSchema(schemaPath);
    expect(reader.hashModel(graph1, 'User')).toBe(reader.hashModel(graph2, 'User'));
  });

  it('hashModel differs between models', async () => {
    const reader = new PrismaSchemaReader();
    const graph = await reader.readSchema(schemaPath);
    expect(reader.hashModel(graph, 'User')).not.toBe(reader.hashModel(graph, 'Post'));
  });

  it('adding an unrelated model does not change hashModel for User', async () => {
    const reader = new PrismaSchemaReader();
    const graph1 = await reader.readSchema(schemaPath);
    const hash1 = reader.hashModel(graph1, 'User');

    const extended = PRISMA_SCHEMA + '\nmodel Comment { id Int @id }';
    const extPath = writeTmpSchema(extended);
    const graph2 = await reader.readSchema(extPath);
    const hash2 = reader.hashModel(graph2, 'User');

    expect(hash1).toBe(hash2);
  });
});

// ---------------------------------------------------------------------------
// ZodSchemaReader
// ---------------------------------------------------------------------------

describe('ZodSchemaReader', () => {
  // Build a minimal ZodObject without depending on the zod package directly.
  // We replicate the _def structure that ZodSchemaReader inspects.
  function fakeZodField(typeName: string, wraps?: string): any {
    if (wraps) {
      return {
        _def: {
          typeName,
          innerType: { _def: { typeName: wraps } },
        },
        isOptional: () => true,
      };
    }
    return { _def: { typeName } };
  }

  function fakeZodObject(shape: Record<string, any>): any {
    return {
      _def: {
        typeName: 'ZodObject',
        shape: () => shape,
      },
    };
  }

  it('reads entities from a ZodObject map', async () => {
    const schemas = {
      User: fakeZodObject({
        id:    fakeZodField('ZodNumber'),
        email: fakeZodField('ZodString'),
      }),
    };
    const reader = new ZodSchemaReader(schemas);
    const graph = await reader.readSchema('');
    expect(graph.entities.has('User')).toBe(true);
  });

  it('maps ZodString → string', async () => {
    const schemas = { User: fakeZodObject({ email: fakeZodField('ZodString') }) };
    const reader = new ZodSchemaReader(schemas);
    const graph = await reader.readSchema('');
    expect(graph.entities.get('User')!.fields['email'].scalarType).toBe('string');
  });

  it('maps ZodNumber → number', async () => {
    const schemas = { User: fakeZodObject({ score: fakeZodField('ZodNumber') }) };
    const reader = new ZodSchemaReader(schemas);
    const graph = await reader.readSchema('');
    expect(graph.entities.get('User')!.fields['score'].scalarType).toBe('number');
  });

  it('maps ZodBoolean → boolean', async () => {
    const schemas = { User: fakeZodObject({ active: fakeZodField('ZodBoolean') }) };
    const reader = new ZodSchemaReader(schemas);
    const graph = await reader.readSchema('');
    expect(graph.entities.get('User')!.fields['active'].scalarType).toBe('boolean');
  });

  it('marks ZodOptional-wrapped fields as nullable', async () => {
    const schemas = { User: fakeZodObject({ name: fakeZodField('ZodOptional', 'ZodString') }) };
    const reader = new ZodSchemaReader(schemas);
    const graph = await reader.readSchema('');
    expect(graph.entities.get('User')!.fields['name'].nullable).toBe(true);
  });

  it('marks non-wrapped fields as non-nullable', async () => {
    const schemas = { User: fakeZodObject({ id: fakeZodField('ZodNumber') }) };
    const reader = new ZodSchemaReader(schemas);
    const graph = await reader.readSchema('');
    expect(graph.entities.get('User')!.fields['id'].nullable).toBe(false);
  });

  it('marks ZodEnum fields as isEnum=true', async () => {
    const schemas = { User: fakeZodObject({ role: fakeZodField('ZodEnum') }) };
    const reader = new ZodSchemaReader(schemas);
    const graph = await reader.readSchema('');
    expect(graph.entities.get('User')!.fields['role'].isEnum).toBe(true);
  });

  it('hashModel returns consistent hex', async () => {
    const schemas = { User: fakeZodObject({ id: fakeZodField('ZodNumber') }) };
    const reader = new ZodSchemaReader(schemas);
    const graph = await reader.readSchema('');
    const h1 = reader.hashModel(graph, 'User');
    const h2 = reader.hashModel(graph, 'User');
    expect(h1).toMatch(/^[0-9a-f]{64}$/);
    expect(h1).toBe(h2);
  });

  it('hashModel falls back to all-entities hash for unknown model', async () => {
    const schemas = { User: fakeZodObject({ id: fakeZodField('ZodNumber') }) };
    const reader = new ZodSchemaReader(schemas);
    const graph = await reader.readSchema('');
    const h = reader.hashModel(graph, 'NonExistent');
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });

  it('createZodAdapter produces a valid ScheMLAdapter', () => {
    const adapter = createZodAdapter({});
    expect(adapter.name).toBe('zod');
    expect(typeof adapter.reader.readSchema).toBe('function');
    expect(adapter.extractor).toBeUndefined();
    expect(adapter.interceptor).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// DrizzleSchemaReader
// ---------------------------------------------------------------------------

describe('DrizzleSchemaReader', () => {
  // Minimal fake Drizzle column objects
  function fakeColumn(columnType: string, notNull: boolean): any {
    return { columnType, notNull };
  }

  function fakeTable(columns: Record<string, any>): any {
    // Use the Symbol key that DrizzleSchemaReader checks first
    const table: any = {};
    table[Symbol.for('drizzle:Columns')] = columns;
    return table;
  }

  it('reads entities from table map', async () => {
    const tables = { User: fakeTable({ id: fakeColumn('serial', true) }) };
    const reader = new DrizzleSchemaReader(tables);
    const graph = await reader.readSchema('');
    expect(graph.entities.has('User')).toBe(true);
  });

  it('maps integer-type columns → number', async () => {
    const tables = { User: fakeTable({ id: fakeColumn('integer', true) }) };
    const reader = new DrizzleSchemaReader(tables);
    const graph = await reader.readSchema('');
    expect(graph.entities.get('User')!.fields['id'].scalarType).toBe('number');
  });

  it('maps varchar → string', async () => {
    const tables = { User: fakeTable({ email: fakeColumn('varchar', true) }) };
    const reader = new DrizzleSchemaReader(tables);
    const graph = await reader.readSchema('');
    expect(graph.entities.get('User')!.fields['email'].scalarType).toBe('string');
  });

  it('maps boolean → boolean', async () => {
    const tables = { User: fakeTable({ active: fakeColumn('boolean', true) }) };
    const reader = new DrizzleSchemaReader(tables);
    const graph = await reader.readSchema('');
    expect(graph.entities.get('User')!.fields['active'].scalarType).toBe('boolean');
  });

  it('maps timestamp → date', async () => {
    const tables = { User: fakeTable({ createdAt: fakeColumn('timestamp', true) }) };
    const reader = new DrizzleSchemaReader(tables);
    const graph = await reader.readSchema('');
    expect(graph.entities.get('User')!.fields['createdAt'].scalarType).toBe('date');
  });

  it('marks notNull=false columns as nullable', async () => {
    const tables = { User: fakeTable({ score: fakeColumn('double', false) }) };
    const reader = new DrizzleSchemaReader(tables);
    const graph = await reader.readSchema('');
    expect(graph.entities.get('User')!.fields['score'].nullable).toBe(true);
  });

  it('hashModel returns deterministic hex', async () => {
    const tables = { User: fakeTable({ id: fakeColumn('serial', true) }) };
    const reader = new DrizzleSchemaReader(tables);
    const graph = await reader.readSchema('');
    const h = reader.hashModel(graph, 'User');
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });

  it('createDrizzleAdapter produces adapter without extractor when no db given', () => {
    const adapter = createDrizzleAdapter({});
    expect(adapter.name).toBe('drizzle');
    expect(typeof adapter.reader.readSchema).toBe('function');
    expect(adapter.extractor).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Adapter registry
// ---------------------------------------------------------------------------

describe('adapter registry', () => {
  it('getAdapter("prisma") returns a prisma adapter', () => {
    const adapter = getAdapter('prisma');
    expect(adapter.name).toBe('prisma');
    expect(typeof adapter.reader.readSchema).toBe('function');
  });

  it('getAdapter("zod") returns a zod adapter', () => {
    const adapter = getAdapter('zod');
    expect(adapter.name).toBe('zod');
  });

  it('getAdapter("drizzle") returns a drizzle adapter', () => {
    const adapter = getAdapter('drizzle');
    expect(adapter.name).toBe('drizzle');
  });

  it('getAdapter throws for unknown adapter name', () => {
    expect(() => getAdapter('typeorm')).toThrow(/unknown adapter/);
  });

  it('registerAdapter + getAdapter round-trip', () => {
    registerAdapter('custom', () => ({
      name:   'custom',
      reader: {
        readSchema: async () => ({ entities: new Map(), rawSource: '' }),
        hashModel: () => 'abc123',
      },
    }));
    const adapter = getAdapter('custom');
    expect(adapter.name).toBe('custom');
  });
});
