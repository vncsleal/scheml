/**
 * ScheML Trait Type System
 * All five trait classes as discriminated union types.
 */

import { AlgorithmConfig, QualityGate, FeatureResolver, OutputResolver, TaskType } from './types';

// ---------------------------------------------------------------------------
// Core discriminant
// ---------------------------------------------------------------------------

export type TraitType =
  | 'predictive'
  | 'anomaly'
  | 'similarity'
  | 'sequential'
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

export interface PredictiveTrait<TEntity = any> extends BaseTraitDefinition {
  readonly type: 'predictive';

  /** Prisma / Drizzle / Zod entity reference (adapter-specific) */
  readonly entity: string | TEntity;

  /** Field on the entity that holds the ground-truth label for training */
  target: string;

  /** Fields used as input features */
  features: string[];

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

export interface AnomalyTrait<TEntity = any> extends BaseTraitDefinition {
  readonly type: 'anomaly';
  readonly entity: string | TEntity;

  /** Fields that define normal behaviour */
  baseline: string[];

  /** Controls the anomaly score threshold at inference */
  sensitivity: 'low' | 'medium' | 'high';
}

// ---------------------------------------------------------------------------
// Similarity trait — cosine / FAISS nearest neighbours
// ---------------------------------------------------------------------------

export interface SimilarityTrait<TEntity = any> extends BaseTraitDefinition {
  readonly type: 'similarity';
  readonly entity: string | TEntity;

  /** Fields to compute similarity over */
  on: string[];
}

// ---------------------------------------------------------------------------
// Sequential trait — window-based tabular aggregation (v1)
// ---------------------------------------------------------------------------

export interface SequentialTrait<TEntity = any> extends BaseTraitDefinition {
  readonly type: 'sequential';
  readonly entity: string | TEntity;

  /** Field containing the event/value sequence */
  sequence: string;

  /** Field used to order events */
  orderBy: string;

  /** Field to predict (next-value or aggregate) */
  target: string;

  output: {
    field: string;
    taskType: TaskType;
    resolver?: OutputResolver<TEntity>;
  };
}

// ---------------------------------------------------------------------------
// Generative trait — structured prompt via AI SDK LanguageModel
// ---------------------------------------------------------------------------

export interface GenerativeTrait<TEntity = any> extends BaseTraitDefinition {
  readonly type: 'generative';
  readonly entity: string | TEntity;

  /** Entity fields to serialize as context in the prompt */
  context: string[];

  /** Prompt template — context is injected as structured JSON before this text */
  prompt: string;

  /**
   * Zod schema describing the expected output shape.
   * Mapped internally to AI SDK Output.object() / Output.choice() / generateText.
   */
  outputSchema?: unknown;
}

// ---------------------------------------------------------------------------
// Union — exhaustive discriminated union of all trait types
// ---------------------------------------------------------------------------

export type AnyTraitDefinition =
  | PredictiveTrait
  | AnomalyTrait
  | SimilarityTrait
  | SequentialTrait
  | GenerativeTrait;

/**
 * A resolved trait definition: the raw definition plus the feedback API.
 * This is what `defineTrait` returns.
 */
export type ResolvedTrait<T extends AnyTraitDefinition = AnyTraitDefinition> =
  T & TraitFeedbackApi;
