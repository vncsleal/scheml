import { describe, it, expect } from 'vitest';
import { defineModel } from './defineModel';
import type { ModelDefinition } from './types';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

type User = { id: string; age: number; plan: string };

function makeDefinition(overrides: Partial<ModelDefinition<User>> = {}): ModelDefinition<User> {
  return defineModel<User>({
    name: 'userLTV',
    modelName: 'User',
    output: {
      field: 'estimatedLTV',
      taskType: 'regression',
      resolver: () => 100,
    },
    features: {
      age: (u) => u.age,
      plan: (u) => u.plan,
    },
    algorithm: { name: 'forest' },
    ...overrides,
  });
}

// ---------------------------------------------------------------------------
// defineModel
// ---------------------------------------------------------------------------

describe('defineModel', () => {
  it('returns the config unchanged (identity)', () => {
    const config = makeDefinition();
    expect(config.name).toBe('userLTV');
    expect(config.modelName).toBe('User');
    expect(config.output.taskType).toBe('regression');
  });

  it('sets schemaHash to undefined (filled at compile time)', () => {
    const config = makeDefinition();
    expect(config.schemaHash).toBeUndefined();
  });

  it('preserves feature resolvers as functions', () => {
    const config = makeDefinition();
    const user: User = { id: '1', age: 30, plan: 'pro' };
    expect(typeof config.features.age).toBe('function');
    expect((config.features.age as (u: User) => unknown)(user)).toBe(30);
  });

  it('preserves qualityGates when provided', () => {
    const config = makeDefinition({
      qualityGates: [{ metric: 'rmse', threshold: 500, comparison: 'lte' }],
    });
    expect(config.qualityGates).toHaveLength(1);
    expect(config.qualityGates![0].metric).toBe('rmse');
  });

  it('does not require qualityGates', () => {
    const config = defineModel<User>({
      name: 'm',
      modelName: 'User',
      output: { field: 'f', taskType: 'regression', resolver: () => 0 },
      features: { age: (u) => u.age },
      algorithm: { name: 'linear' },
    });
    expect(config.qualityGates).toBeUndefined();
  });

  it('supports binary_classification taskType', () => {
    const config = defineModel<User>({
      name: 'churn',
      modelName: 'User',
      output: { field: 'willChurn', taskType: 'binary_classification', resolver: () => false },
      features: { age: (u) => u.age },
      algorithm: { name: 'gbm' },
    });
    expect(config.output.taskType).toBe('binary_classification');
  });

  it('supports multiclass_classification taskType', () => {
    const config = defineModel<User>({
      name: 'tier',
      modelName: 'User',
      output: { field: 'tier', taskType: 'multiclass_classification', resolver: () => 'A' },
      features: { age: (u) => u.age },
      algorithm: { name: 'forest' },
    });
    expect(config.output.taskType).toBe('multiclass_classification');
  });

  it('passes algorithm hyperparameters through', () => {
    const config = makeDefinition({
      algorithm: { name: 'forest', hyperparameters: { nEstimators: 200 } },
    });
    expect(config.algorithm?.hyperparameters?.['nEstimators']).toBe(200);
  });
});
