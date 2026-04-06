import { describe, expect, it } from 'vitest';
import { computeSchemaHashForMetadata } from '../../src/contracts';
import { computeMetadataSchemaHash } from '../../src/schemaHash';
import { hashSchemaEntitySubset } from '../../src/schema';
import type { SchemaGraph, SchemaReader } from '../../src/adapters/interface';

const SAMPLE_SCHEMA = `
datasource db {
  provider = "sqlite"
  url      = "file:dev.db"
}

model User {
  id       String @id
  email    String
  plan     Plan
}

model AuditLog {
  id        String @id
  createdAt DateTime
}

enum Plan {
  FREE
  PRO
}
`;

describe('contracts', () => {
  describe('computeSchemaHashForMetadata', () => {
    it('computes the model-subset hash via reader.hashModel', () => {
      const graph: SchemaGraph = { rawSource: SAMPLE_SCHEMA, entities: new Map() };
      const reader: SchemaReader = {
        readSchema: async () => graph,
        hashModel: (_graph, name) => hashSchemaEntitySubset(SAMPLE_SCHEMA, name),
      };
      const metadata = {
        modelName: 'churnRisk',
        featureDependencies: [{ modelName: 'User' }],
      };
      expect(
        computeSchemaHashForMetadata(graph, metadata, reader)
      ).toBe(hashSchemaEntitySubset(SAMPLE_SCHEMA, 'User'));

      expect(
        computeMetadataSchemaHash(graph, metadata, reader)
      ).toBe(hashSchemaEntitySubset(SAMPLE_SCHEMA, 'User'));
    });
  });
});
