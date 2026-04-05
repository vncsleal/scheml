import { describe, expect, it } from 'vitest';
import { computeSchemaHashForMetadata, usesModelSubsetSchemaHash, validateTrainingModelDefinition } from './contracts';
import { hashPrismaModelSubset, hashPrismaSchema } from './schema';
import { ModelDefinitionError } from './errors';
import { defineModel } from './defineModel';

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
  describe('usesModelSubsetSchemaHash', () => {
    it('uses the full-schema hash for legacy metadata', () => {
      expect(usesModelSubsetSchemaHash('1.1.0')).toBe(false);
      expect(usesModelSubsetSchemaHash(undefined)).toBe(false);
    });

    it('uses the model-subset hash for metadata schema v1.2.0 and newer', () => {
      expect(usesModelSubsetSchemaHash('1.2.0')).toBe(true);
      expect(usesModelSubsetSchemaHash('1.2.1')).toBe(true);
      expect(usesModelSubsetSchemaHash('2.0.0')).toBe(true);
    });
  });

  describe('computeSchemaHashForMetadata', () => {
    it('computes the legacy full-schema hash for v1.1.0 artifacts', () => {
      const graph = { rawSource: SAMPLE_SCHEMA, entities: new Map() } as any;
      const reader = {} as any; // not used in legacy path
      expect(
        computeSchemaHashForMetadata(graph, {
          metadataSchemaVersion: '1.1.0',
          modelName: 'User',
        } as any, reader)
      ).toBe(hashPrismaSchema(SAMPLE_SCHEMA));
    });

    it('computes the model-subset hash for v1.2.x artifacts', () => {
      const graph = { rawSource: SAMPLE_SCHEMA, entities: new Map() } as any;
      const reader = {
        hashModel: (_g: any, name: string) => hashPrismaModelSubset(SAMPLE_SCHEMA, name),
      } as any;
      expect(
        computeSchemaHashForMetadata(graph, {
          metadataSchemaVersion: '1.2.1',
          modelName: 'churnRisk',
          featureDependencies: [{ modelName: 'User' }],
        } as any, reader)
      ).toBe(hashPrismaModelSubset(SAMPLE_SCHEMA, 'User'));
    });
  });

  describe('validateTrainingModelDefinition', () => {
    it('accepts omitted algorithm and treats it as automl', () => {
      const model = defineModel({
        name: 'churnRisk',
        modelName: 'User',
        output: { field: 'score', taskType: 'binary_classification', resolver: () => true },
        features: { plan: (user: any) => user.plan },
      });

      expect(() => validateTrainingModelDefinition(model)).not.toThrow();
    });

    it('rejects unsupported algorithms before Python handoff', () => {
      const model = defineModel({
        name: 'badAlgo',
        modelName: 'User',
        output: { field: 'score', taskType: 'regression', resolver: () => 1 },
        features: { plan: (user: any) => user.plan },
        algorithm: { name: 'xgboost' as any },
      });

      expect(() => validateTrainingModelDefinition(model)).toThrow(ModelDefinitionError);
      expect(() => validateTrainingModelDefinition(model)).toThrow(
        /Unsupported algorithm "xgboost"/
      );
    });

    it('rejects hyperparameters for automl', () => {
      const model = defineModel({
        name: 'automlWithParams',
        modelName: 'User',
        output: { field: 'score', taskType: 'regression', resolver: () => 1 },
        features: { plan: (user: any) => user.plan },
        algorithm: { name: 'automl', hyperparameters: { timeBudget: 30 } },
      });

      expect(() => validateTrainingModelDefinition(model)).toThrow(
        /AutoML does not currently accept algorithm hyperparameters/
      );
    });

    it('rejects unsupported hyperparameters for explicit algorithms', () => {
      const model = defineModel({
        name: 'forestBadParams',
        modelName: 'User',
        output: { field: 'score', taskType: 'regression', resolver: () => 1 },
        features: { plan: (user: any) => user.plan },
        algorithm: { name: 'forest', hyperparameters: { learningRate: 0.1 } },
      });

      expect(() => validateTrainingModelDefinition(model)).toThrow(
        /Unsupported hyperparameter "learningRate" for algorithm "forest"/
      );
    });

    it('rejects invalid hyperparameter constraints', () => {
      const model = defineModel({
        name: 'forestInvalidCount',
        modelName: 'User',
        output: { field: 'score', taskType: 'regression', resolver: () => 1 },
        features: { plan: (user: any) => user.plan },
        algorithm: { name: 'forest', hyperparameters: { nEstimators: 0 } },
      });

      expect(() => validateTrainingModelDefinition(model)).toThrow(
        /requires "nEstimators" to be an integer >= 1/
      );
    });

    it('accepts curated explicit hyperparameters that map to the Python backend', () => {
      const model = defineModel({
        name: 'forestGoodParams',
        modelName: 'User',
        output: { field: 'score', taskType: 'binary_classification', resolver: () => true },
        features: { plan: (user: any) => user.plan },
        algorithm: {
          name: 'forest',
          hyperparameters: { nEstimators: 200, maxDepth: 12, minSamplesSplit: 4 },
        },
      });

      expect(() => validateTrainingModelDefinition(model)).not.toThrow();
    });
  });
});
