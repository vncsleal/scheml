import { describe, it, expect, beforeEach } from 'vitest';
import { defineModel, ModelRegistry, globalModelRegistry, registerModel } from './defineModel';
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
    algorithm: { name: 'forest', version: '1.0.0' },
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
      algorithm: { name: 'linear', version: '1.0.0' },
    });
    expect(config.qualityGates).toBeUndefined();
  });

  it('supports binary_classification taskType', () => {
    const config = defineModel<User>({
      name: 'churn',
      modelName: 'User',
      output: { field: 'willChurn', taskType: 'binary_classification', resolver: () => false },
      features: { age: (u) => u.age },
      algorithm: { name: 'gbm', version: '1.0.0' },
    });
    expect(config.output.taskType).toBe('binary_classification');
  });

  it('supports multiclass_classification taskType', () => {
    const config = defineModel<User>({
      name: 'tier',
      modelName: 'User',
      output: { field: 'tier', taskType: 'multiclass_classification', resolver: () => 'A' },
      features: { age: (u) => u.age },
      algorithm: { name: 'forest', version: '1.0.0' },
    });
    expect(config.output.taskType).toBe('multiclass_classification');
  });

  it('passes algorithm hyperparameters through', () => {
    const config = makeDefinition({
      algorithm: { name: 'forest', version: '1.0.0', hyperparameters: { nEstimators: 200 } },
    });
    expect(config.algorithm.hyperparameters?.['nEstimators']).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// ModelRegistry
// ---------------------------------------------------------------------------

describe('ModelRegistry', () => {
  let registry: ModelRegistry;

  beforeEach(() => {
    registry = new ModelRegistry();
  });

  it('registers and retrieves a model by name', () => {
    const model = makeDefinition();
    registry.register(model);
    expect(registry.get('userLTV')).toBe(model);
  });

  it('has() returns true for registered model', () => {
    registry.register(makeDefinition());
    expect(registry.has('userLTV')).toBe(true);
  });

  it('has() returns false for unregistered model', () => {
    expect(registry.has('nonexistent')).toBe(false);
  });

  it('get() returns undefined for unregistered model', () => {
    expect(registry.get('nonexistent')).toBeUndefined();
  });

  it('getAll() returns all registered models', () => {
    const a = makeDefinition({ name: 'modelA' });
    const b = makeDefinition({ name: 'modelB' });
    registry.register(a);
    registry.register(b);
    const all = registry.getAll();
    expect(all).toHaveLength(2);
    expect(all.map((m) => m.name)).toEqual(expect.arrayContaining(['modelA', 'modelB']));
  });

  it('getAll() returns empty array when no models registered', () => {
    expect(registry.getAll()).toEqual([]);
  });

  it('throws on duplicate registration', () => {
    registry.register(makeDefinition());
    expect(() => registry.register(makeDefinition())).toThrow(/already registered/i);
  });

  it('allows registering models with distinct names', () => {
    registry.register(makeDefinition({ name: 'a' }));
    registry.register(makeDefinition({ name: 'b' }));
    expect(registry.getAll()).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// registerModel (global registry helper)
// ---------------------------------------------------------------------------

describe('registerModel', () => {
  it('registers on the global registry — model is retrievable', () => {
    const model = makeDefinition({ name: `globalTestModel_${Date.now()}` });
    registerModel(model);
    expect(globalModelRegistry.get(model.name)).toBe(model);
  });
});
