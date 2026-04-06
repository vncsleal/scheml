/**
 * defineTrait — declare an intelligence trait on an entity type.
 *
 * `defineTrait` is the primary ScheML API. It accepts a typed trait
 * configuration and returns a resolved trait object that carries:
 *  - All configuration fields (type, name, features, etc.)
 *  - `record()` / `recordBatch()` feedback API methods
 *
 * @example Predictive trait (Prisma adapter)
 * ```ts
 * import { defineTrait } from '@vncsleal/scheml'
 *
 * const churnRisk = defineTrait('Customer', {
 *   type: 'predictive',
 *   name: 'churnRisk',
 *   target: 'churned',
 *   features: ['lastLoginAt', 'totalPurchases', 'planTier'],
 *   output: { field: 'churnScore', taskType: 'binary_classification' },
 *   qualityGates: [{ metric: 'f1', threshold: 0.85, comparison: 'gte' }],
 * })
 * ```
 *
 * @example Predictive trait (Drizzle adapter)
 * ```ts
 * import { users } from './db/schema'
 *
 * const churnRisk = defineTrait(users, {
 *   type: 'predictive',
 *   name: 'churnRisk',
 *   target: 'churned',
 *   features: ['lastLoginAt', 'totalPurchases'],
 *   output: { field: 'churnScore', taskType: 'binary_classification' },
 * })
 * ```
 *
 * @example Generative trait
 * ```ts
 * const retentionMessage = defineTrait('Customer', {
 *   type: 'generative',
 *   name: 'retentionMessage',
 *   context: ['planTier', 'lastLoginAt', 'totalPurchases'],
 *   prompt: 'Write a short, personalized retention message for this customer.',
 * })
 * ```
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  AnyTraitDefinition,
  ResolvedTrait,
  PredictiveTrait,
  AnomalyTrait,
  SimilarityTrait,
  TemporalTrait,
  GenerativeTrait,
} from './traitTypes';

// ---------------------------------------------------------------------------
// Feedback persistence (append-only JSONL)
// ---------------------------------------------------------------------------

function feedbackPath(traitName: string): string {
  // Sanitize trait name to prevent path traversal.
  const safeName = path.basename(traitName).replace(/[^a-zA-Z0-9_-]/g, '_');
  return path.resolve(process.cwd(), '.scheml', 'feedback', `${safeName}.jsonl`);
}

function appendFeedback(traitName: string, entry: object): Promise<void> {
  const filePath = feedbackPath(traitName);
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return fs.promises.appendFile(
    filePath,
    JSON.stringify({ ...entry, recordedAt: new Date().toISOString() }) + '\n'
  );
}

// ---------------------------------------------------------------------------
// Generic overload: entity is adapter-specific (string | table object | ZodObject)
// ---------------------------------------------------------------------------

/**
 * String-name adapters: entity name as string
 */
export function defineTrait<TEntity = Record<string, unknown>>(
  entity: string,
  config: Omit<PredictiveTrait<TEntity>, 'entity'>
): ResolvedTrait<PredictiveTrait<TEntity>>;

export function defineTrait<TEntity = Record<string, unknown>>(
  entity: string,
  config: Omit<AnomalyTrait<TEntity>, 'entity'>
): ResolvedTrait<AnomalyTrait<TEntity>>;

export function defineTrait<TEntity = Record<string, unknown>>(
  entity: string,
  config: Omit<SimilarityTrait<TEntity>, 'entity'>
): ResolvedTrait<SimilarityTrait<TEntity>>;

export function defineTrait<TEntity = Record<string, unknown>>(
  entity: string,
  config: Omit<TemporalTrait<TEntity>, 'entity'>
): ResolvedTrait<TemporalTrait<TEntity>>;

export function defineTrait<TEntity = Record<string, unknown>>(
  entity: string,
  config: Omit<GenerativeTrait<TEntity>, 'entity'>
): ResolvedTrait<GenerativeTrait<TEntity>>;

/**
 * Drizzle / Zod adapter: entity as runtime object
 */
export function defineTrait<TEntity = Record<string, unknown>>(
  entity: TEntity,
  config: Omit<PredictiveTrait<TEntity>, 'entity'>
): ResolvedTrait<PredictiveTrait<TEntity>>;

export function defineTrait<TEntity = Record<string, unknown>>(
  entity: TEntity,
  config: Omit<AnomalyTrait<TEntity>, 'entity'>
): ResolvedTrait<AnomalyTrait<TEntity>>;

export function defineTrait<TEntity = Record<string, unknown>>(
  entity: TEntity,
  config: Omit<SimilarityTrait<TEntity>, 'entity'>
): ResolvedTrait<SimilarityTrait<TEntity>>;

export function defineTrait<TEntity = Record<string, unknown>>(
  entity: TEntity,
  config: Omit<TemporalTrait<TEntity>, 'entity'>
): ResolvedTrait<TemporalTrait<TEntity>>;

export function defineTrait<TEntity = Record<string, unknown>>(
  entity: TEntity,
  config: Omit<GenerativeTrait<TEntity>, 'entity'>
): ResolvedTrait<GenerativeTrait<TEntity>>;

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

export function defineTrait(
  entity: unknown,
  config: Omit<AnyTraitDefinition, 'entity'>
): ResolvedTrait {
  // Validate name: must be safe for use in file paths and CLI args.
  // Prevents path traversal (e.g. '../../etc/passwd') in artifact file naming.
  if (!/^[a-zA-Z0-9_-]+$/.test(config.name)) {
    throw new Error(
      `Invalid trait name "${config.name}". Names must contain only letters, numbers, underscores, and hyphens.`
    );
  }

  const definition: AnyTraitDefinition = {
    ...config,
    entity,
  } as AnyTraitDefinition;

  const resolved: ResolvedTrait = Object.assign(definition, {
    record: (entityId: string | number, observation: { actual: unknown }) =>
      appendFeedback(definition.name, { entityId, ...observation }),

    recordBatch: (entries: Array<{ id: string | number; actual: unknown; predicted?: unknown }>) =>
      Promise.all(
        entries.map((e) =>
          appendFeedback(definition.name, {
            entityId: e.id,
            actual: e.actual,
            ...(e.predicted !== undefined ? { predicted: e.predicted } : {}),
          })
        )
      ).then(() => undefined),
  });

  return resolved;
}
