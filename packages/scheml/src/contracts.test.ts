import { describe, expect, it } from 'vitest';
import { computeSchemaHashForMetadata, validateTrainingModelDefinition } from './contracts';
import { hashPrismaModelSubset } from './schema';
import { ModelDefinitionError } from './errors';
import type { ModelDefinition } from './types';

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

  describe('validateTrainingModelDefinition', () => {
    it('accepts omitted algorithm and treats it as automl', () => {
      const model: ModelDefinition<any> = {
        name: 'churnRisk',
        modelName: 'User',
        output: { field: 'score', taskType: 'binary_classification', resolver: () => true },
        features: { plan: (user: any) => user.plan },
      };

      expect(() => validateTrainingModelDefinition(model)).not.toThrow();
    });

    it('rejects unsupported algorithms before Python handoff', () => {
      const model: ModelDefinition<any> = {
        name: 'badAlgo',
        modelName: 'User',
        output: { field: 'score', taskType: 'regression', resolver: () => 1 },
        features: { plan: (user: any) => user.plan },
        algorithm: { name: 'xgboost' as any },
      };

      expect(() => validateTrainingModelDefinition(model)).toThrow(ModelDefinitionError);
      expect(() => validateTrainingModelDefinition(model)).toThrow(
        /Unsupported algorithm "xgboost"/
      );
    });

    it('rejects hyperparameters for automl', () => {
      const model: ModelDefinition<any> = {
        name: 'automlWithParams',
        modelName: 'User',
        output: { field: 'score', taskType: 'regression', resolver: () => 1 },
        features: { plan: (user: any) => user.plan },
        algorithm: { name: 'automl', hyperparameters: { timeBudget: 30 } },
      };

      expect(() => validateTrainingModelDefinition(model)).toThrow(
        /AutoML does not currently accept algorithm hyperparameters/
      );
    });

    it('rejects unsupported hyperparameters for explicit algorithms', () => {
      const model: ModelDefinition<any> = {
        name: 'forestBadParams',
        modelName: 'User',
        output: { field: 'score', taskType: 'regression', resolver: () => 1 },
        features: { plan: (user: any) => user.plan },
        algorithm: { name: 'forest', hyperparameters: { learningRate: 0.1 } },
      };

      expect(() => validateTrainingModelDefinition(model)).toThrow(
        /Unsupported hyperparameter "learningRate" for algorithm "forest"/
      );
    });

    it('rejects invalid hyperparameter constraints', () => {
      const model: ModelDefinition<any> = {
        name: 'forestInvalidCount',
        modelName: 'User',
        output: { field: 'score', taskType: 'regression', resolver: () => 1 },
        features: { plan: (user: any) => user.plan },
        algorithm: { name: 'forest', hyperparameters: { nEstimators: 0 } },
      };

      expect(() => validateTrainingModelDefinition(model)).toThrow(
        /requires "nEstimators" to be an integer >= 1/
      );
    });

    it('accepts curated explicit hyperparameters that map to the Python backend', () => {
      const model: ModelDefinition<any> = {
        name: 'forestGoodParams',
        modelName: 'User',
        output: { field: 'score', taskType: 'binary_classification', resolver: () => true },
        features: { plan: (user: any) => user.plan },
        algorithm: {
          name: 'forest',
          hyperparameters: { nEstimators: 200, maxDepth: 12, minSamplesSplit: 4 },
        },
      };

      expect(() => validateTrainingModelDefinition(model)).not.toThrow();
    });
  });
});
