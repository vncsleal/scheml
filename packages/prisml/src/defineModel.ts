/**
 * Model Definition API
 * Type-safe, declarative model specification
 */

import { ModelDefinition, AlgorithmConfig, TaskType, FeatureResolver, OutputResolver, QualityGate } from './types';

/**
 * defineModel: Declare a predictive model
 *
 * @example
 * ```typescript
 * import { defineModel } from '@vncsleal/prisml';
 *
 * export const userLifetimeValueModel = defineModel<User>({
 *   name: 'userLifetimeValue',
 *   modelName: 'User',
 *   output: {
 *     field: 'estimatedLTV',
 *     taskType: 'regression',
 *     resolver: (user) => user.actualLifetimeValue, // For training labels
 *   },
 *   features: {
 *     accountAge: (user) => user.createdAt ? Date.now() - user.createdAt.getTime() : null,
 *     signupSource: (user) => user.source, // 'organic', 'paid', 'referral'
 *     monthlySpend: (user) => user.totalSpend / user.monthsActive,
 *     isPremium: (user) => user.plan === 'premium',
 *   },
 *   algorithm: {
 *     name: 'forest',
 *     version: '1.0.0',
 *     hyperparameters: {
 *       nEstimators: 100,
 *       maxDepth: 10,
 *     },
 *   },
 *   qualityGates: [
 *     {
 *       metric: 'rmse',
 *       threshold: 500,
 *       comparison: 'lte',
 *       description: 'Must predict within $500 RMSE',
 *     },
 *   ],
 * });
 * ```
 */
export function defineModel<TModel = any>(config: ModelDefinition<TModel>): ModelDefinition<TModel> {
  // Pure specification: no validation, no side effects
  return {
    ...config,
    schemaHash: undefined, // Filled at compile time
  };
}

/**
 * Model registry for compile-time discovery
 * Models are discovered via TypeScript AST analysis of model definition files
 */
export class ModelRegistry {
  private models: Map<string, ModelDefinition> = new Map();

  register(model: ModelDefinition): void {
    if (this.models.has(model.name)) {
      throw new Error(`Model "${model.name}" is already registered`);
    }
    this.models.set(model.name, model);
  }

  get(name: string): ModelDefinition | undefined {
    return this.models.get(name);
  }

  getAll(): ModelDefinition[] {
    return Array.from(this.models.values());
  }

  has(name: string): boolean {
    return this.models.has(name);
  }
}

/**
 * Global model registry instance
 */
export const globalModelRegistry = new ModelRegistry();

/**
 * Helper to register a model globally
 */
export function registerModel(model: ModelDefinition): void {
  globalModelRegistry.register(model);
}
