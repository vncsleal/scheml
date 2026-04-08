/**
 * ScheML Trait Type System
 * All five trait classes as discriminated union types.
 */

import { AlgorithmConfig, QualityGate, FeatureResolver, OutputResolver, TaskType } from './types';

// ---------------------------------------------------------------------------
// Compile-time field safety helper
// ---------------------------------------------------------------------------

/**
 * Resolves to `string & keyof T` for a typed entity — constraining field names
 * to actual entity keys at compile time. Degrades gracefully to `string` when
 * `T = any` (unparameterized / Prisma string-entity usage).
 *
 * @example
 * ```ts
 * // With explicit type — TS error if field doesn't exist on Customer:
 * defineTrait<Customer>('Customer', { target: 'nonExistent' })
 * // Without type param — unconstrained string, no error:
 * defineTrait('Customer', { target: 'anything' })
 * ```
 */
export type StringKeyOf<T> = string & keyof T;

// ---------------------------------------------------------------------------
// Core discriminant
// ---------------------------------------------------------------------------

export type TraitType =
  | 'predictive'
  | 'anomaly'
  | 'similarity'
  | 'temporal'
  | 'generative';

// ---------------------------------------------------------------------------
// Feedback API — attached to every resolved trait definition object
// ---------------------------------------------------------------------------

export interface TraitFeedbackApi {
  /**
   * Record a single ground-truth observation for accuracy decay tracking.
   * Optionally pass `predicted` to enable paired accuracy computation in
   * `scheml check`.
   * Persists to `.scheml/feedback/<traitName>.jsonl`.
   */
  record(
    entityId: string | number,
    observation: { actual: unknown; predicted?: unknown }
  ): Promise<void>;

  /**
   * Record a batch of ground-truth observations in one call.
   * Include `predicted` on each entry to enable accuracy decay detection.
   */
  recordBatch(
    entries: Array<{ id: string | number; actual: unknown; predicted?: unknown }>
  ): Promise<void>;
}

// ---------------------------------------------------------------------------
// Base definition — fields common to all trait types
// ---------------------------------------------------------------------------

export interface BaseTraitDefinition {
  readonly type: TraitType;
  readonly name: string;
  qualityGates?: QualityGate[];
  /**
   * Dependent traits used as additional features for this trait.
   * Pass object references (not strings) — checked at graph walk time.
   */
  traits?: AnyTraitDefinition[];
}

// ---------------------------------------------------------------------------
// Predictive trait — FLAML → ONNX inference
// ---------------------------------------------------------------------------

export interface PredictiveTrait<TEntity = Record<string, unknown>> extends BaseTraitDefinition {
  readonly type: 'predictive';

  /** Prisma / Drizzle / Zod entity reference (adapter-specific) */
  readonly entity: string | TEntity;

  /** Field on the entity that holds the ground-truth label for training */
  target: StringKeyOf<TEntity>;

  /** Fields used as input features */
  features: StringKeyOf<TEntity>[];

  output: {
    field: string;
    taskType: TaskType;
    resolver?: OutputResolver<TEntity>;
  };

  /** Named feature resolvers (optional — adapter may extract directly from fields) */
  featureResolvers?: Record<string, FeatureResolver<TEntity>>;

  algorithm?: AlgorithmConfig;
}

// ---------------------------------------------------------------------------
// Anomaly trait — Isolation Forest scoring
// ---------------------------------------------------------------------------

export interface AnomalyTrait<TEntity = Record<string, unknown>> extends BaseTraitDefinition {
  readonly type: 'anomaly';
  readonly entity: string | TEntity;

  /** Fields that define normal behaviour */
  baseline: StringKeyOf<TEntity>[];

  /** Controls the anomaly score threshold at inference */
  sensitivity: 'low' | 'medium' | 'high';
}

// ---------------------------------------------------------------------------
// Similarity trait — cosine / FAISS nearest neighbours
// ---------------------------------------------------------------------------

export interface SimilarityTrait<TEntity = Record<string, unknown>> extends BaseTraitDefinition {
  readonly type: 'similarity';
  readonly entity: string | TEntity;

  /** Fields to compute similarity over */
  on: StringKeyOf<TEntity>[];
}

// ---------------------------------------------------------------------------
// Temporal trait — window-based tabular aggregation (fixed-window tsfresh-style)
// ---------------------------------------------------------------------------

/**
 * Window-based tabular aggregation trait. Performs fixed-window feature extraction
 * from ordered event sequences (similar to tsfresh / tslearn). Not a true
 * RNN/Transformer sequence model — the `type` discriminant is `'temporal'`.
 */
export interface TemporalTrait<TEntity = Record<string, unknown>> extends BaseTraitDefinition {
  readonly type: 'temporal';
  readonly entity: string | TEntity;

  /** Field containing the event/value sequence */
  sequence: StringKeyOf<TEntity>;

  /** Field used to order events */
  orderBy: StringKeyOf<TEntity>;

  /** Field to predict (next-value or aggregate) */
  target: StringKeyOf<TEntity>;

  output: {
    field: string;
    taskType: TaskType;
    resolver?: OutputResolver<TEntity>;
  };

  /** Optional estimator override for the aggregated tabular temporal model */
  algorithm?: AlgorithmConfig;
}

// ---------------------------------------------------------------------------
// Generative trait — structured prompt via AI SDK LanguageModel
// ---------------------------------------------------------------------------

/**
 * Structural duck-type for a Zod schema accepted by `GenerativeTrait.outputSchema`.
 * Avoids a hard runtime dependency on the `zod` package in ScheML itself —
 * inference runs duck-typed detection on `_def.typeName` (see `generative.ts`).
 * Any Zod type satisfies this interface: `z.string()`, `z.enum([...])`, `z.object({...})`.
 */
export interface ZodLike {
  _def: { typeName: string; [key: string]: unknown };
  parse(data: unknown): unknown;
  safeParse(data: unknown): { success: boolean; data?: unknown; error?: unknown };
}

export interface GenerativeTrait<TEntity = Record<string, unknown>> extends BaseTraitDefinition {
  readonly type: 'generative';
  readonly entity: string | TEntity;

  /** Entity fields to serialize as context in the prompt */
  context: StringKeyOf<TEntity>[];

  /** Prompt template — context is injected as structured JSON before this text */
  prompt: string;

  /**
   * Zod schema describing the expected output shape.
   * Mapped internally to AI SDK Output.object() / Output.choice() / generateText.
   * Must be a Zod type (`z.string()`, `z.enum([...])`, `z.object({...})`, etc.).
   */
  outputSchema?: ZodLike;
}

// ---------------------------------------------------------------------------
// Union — exhaustive discriminated union of all trait types
// ---------------------------------------------------------------------------

export type AnyTraitDefinition =
  | PredictiveTrait
  | AnomalyTrait
  | SimilarityTrait
  | TemporalTrait
  | GenerativeTrait;

/**
 * A resolved trait definition: the raw definition plus the feedback API.
 * This is what `defineTrait` returns.
 */
export type ResolvedTrait<T extends BaseTraitDefinition = AnyTraitDefinition> =
  T & TraitFeedbackApi;


