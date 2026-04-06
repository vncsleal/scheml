import { describe, expect, it } from 'vitest';
import { computeSchemaHashForMetadata } from './contracts';
import { hashPrismaModelSubset } from './schema';

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
      const graph = { rawSource: SAMPLE_SCHEMA, entities: new Map() } as any;
      const reader = {
        hashModel: (_g: any, name: string) => hashPrismaModelSubset(SAMPLE_SCHEMA, name),
      } as any;
      expect(
        computeSchemaHashForMetadata(graph, {
          modelName: 'churnRisk',
          featureDependencies: [{ modelName: 'User' }],
        } as any, reader)
      ).toBe(hashPrismaModelSubset(SAMPLE_SCHEMA, 'User'));
    });
  });
});
