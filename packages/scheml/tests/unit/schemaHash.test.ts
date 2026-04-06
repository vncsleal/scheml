import { describe, expect, it } from 'vitest';
import {
  compareSchemaHashes,
  computeMetadataSchemaHash,
  hashSchemaEntity,
  hashSchemaGraph,
  hashSchemaGraphEntity,
  resolveSchemaEntityName,
} from '../../src/schemaHash';
import type { SchemaGraph, SchemaReader } from '../../src/adapters/interface';

const sampleGraph: SchemaGraph = {
  entities: new Map([
    ['User', {
      name: 'User',
      fields: {
        id: { name: 'id', scalarType: 'string', nullable: false, isEnum: false },
        plan: { name: 'plan', scalarType: 'string', nullable: false, isEnum: true },
      },
    }],
    ['AuditLog', {
      name: 'AuditLog',
      fields: {
        id: { name: 'id', scalarType: 'string', nullable: false, isEnum: false },
        createdAt: { name: 'createdAt', scalarType: 'date', nullable: false, isEnum: false },
      },
    }],
  ]),
  rawSource: 'schema-source',
};

const reader: SchemaReader = {
  async readSchema() {
    return sampleGraph;
  },
  hashModel(_graph, modelName) {
    return `reader:${modelName}`;
  },
};

describe('schemaHash', () => {
  it('hashSchemaGraph is deterministic', () => {
    expect(hashSchemaGraph(sampleGraph)).toBe(hashSchemaGraph(sampleGraph));
  });

  it('hashSchemaGraphEntity falls back to graph hash when entity is missing', () => {
    expect(hashSchemaGraphEntity(sampleGraph, 'Missing')).toBe(hashSchemaGraph(sampleGraph));
  });

  it('hashSchemaEntity uses reader.hashModel when provided', () => {
    expect(hashSchemaEntity(sampleGraph, 'User', reader)).toBe('reader:User');
  });

  it('resolveSchemaEntityName prefers metadata.entityName', () => {
    expect(resolveSchemaEntityName({
      modelName: 'churnRisk',
      entityName: 'User',
      featureDependencies: [{ modelName: 'AuditLog' } as never],
    })).toBe('User');
  });

  it('computeMetadataSchemaHash resolves the entity through the neutral layer', () => {
    expect(computeMetadataSchemaHash(sampleGraph, {
      modelName: 'churnRisk',
      featureDependencies: [{ modelName: 'User' } as never],
    }, reader)).toBe('reader:User');
  });

  it('compareSchemaHashes returns a stable comparison object', () => {
    expect(compareSchemaHashes('abc', 'abc')).toEqual({
      valid: true,
      expectedHash: 'abc',
      actualHash: 'abc',
    });
  });
});