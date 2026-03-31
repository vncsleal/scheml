/**
 * Model Definition API
 * Type-safe, declarative model specification
 */

import { ModelDefinition, AlgorithmConfig, TaskType, FeatureResolver, OutputResolver, QualityGate } from './types';

/**
 * @deprecated Use `defineTrait` from '\@vncsleal/scheml' instead.
 * `defineModel` is a legacy alias kept for backward compatibility.
 *
 * @example
 * ```typescript
 * import { defineModel } from '@vncsleal/scheml';
 *
 * export const userLifetimeValueModel = defineModel<User>({
 *   name: 'userLifetimeValue',
 *   modelName: 'User',
 *   output: {
 *     field: 'estimatedLTV',
 *     taskType: 'regression',
 *     resolver: (user) => user.actualLifetimeValue,
 *   },
 *   features: {
 *     accountAge: (user) => user.createdAt ? Date.now() - user.createdAt.getTime() : null,
 *     signupSource: (user) => user.source,
 *     monthlySpend: (user) => user.totalSpend / user.monthsActive,
 *     isPremium: (user) => user.plan === 'premium',
 *   },
 *   algorithm: {
 *     name: 'forest',
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
    schemaHash: undefined, // Populated by scheml train at compile time
  };
}
