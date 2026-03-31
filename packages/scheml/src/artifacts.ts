/**
 * ScheML Artifact Contracts
 *
 * Defines the on-disk artifact shapes for every trainable trait type.
 * The `PredictionSession` loader and `train.ts` writer both import from here
 * so the two sides are always in sync.
 *
 * Artifact file naming convention:
 *   `<traitName>.<type>.json`       ← metadata for all types
 *   `<traitName>.onnx`              ← predictive / sequential
 *   `<traitName>.faiss`             ← similarity (large dataset, ≥50k rows)
 *   `<traitName>.embeddings.npy`    ← similarity (small dataset, <50k rows)
 *
 * All metadata files share a common `ArtifactMetadataBase` header, then
 * extend it with type-specific fields.
 */

// ---------------------------------------------------------------------------
// Base
// ---------------------------------------------------------------------------

/**
 * Fields present on every artifact metadata file regardless of trait type.
 */
export interface ArtifactMetadataBase {
  /** ScheML package version at training time */
  version: string;
  /** Semantic version of this schema: used to detect format migration needs */
  metadataSchemaVersion: string;
  /**
   * Trait type discriminant — must match the `type` field in the trait definition.
   * Used by PredictionSession to choose the correct loader.
   */
  traitType: 'predictive' | 'anomaly' | 'similarity' | 'sequential' | 'generative';
  /** Canonical trait name */
  traitName: string;
  /** Adapter-agnostic hash of the entity schema subset at training time */
  schemaHash: string;
  /**
   * Legacy field — Prisma-specific hash kept for backward-compatibility with
   * artifacts produced before Phase 3. Code should prefer `schemaHash`.
   * @deprecated Use schemaHash
   */
  prismaSchemaHash?: string;
  /** ISO-8601 timestamp when this artifact was written */
  compiledAt: string;
}

// ---------------------------------------------------------------------------
// Predictive artifact (ONNX)
// ---------------------------------------------------------------------------

export interface PredictiveArtifactMetadata extends ArtifactMetadataBase {
  traitType: 'predictive';
  taskType: 'regression' | 'binary_classification' | 'multiclass_classification';
  bestEstimator: string;
  features: import('./types').FeatureSchema;
  output: { field: string; shape: number[] };
  tensorSpec: { inputShape: number[]; outputShape: number[] };
  featureDependencies: import('./types').FeatureDependency[];
  encoding: Record<string, import('./types').CategoryEncoding>;
  imputation: Record<string, import('./types').ImputationRule>;
  scaling: Record<string, import('./types').ScalingSpec>;
  trainingMetrics: import('./types').TrainingMetrics[];
  dataset: import('./types').TrainingDataset;
  /** Relative path from the metadata file to the ONNX model file */
  onnxFile: string;
  /** @deprecated kept for back-compat with pre-Phase-3 artifacts */
  modelName?: string;
  /** @deprecated kept for back-compat with pre-Phase-3 artifacts */
  algorithm?: import('./types').AlgorithmConfig;
}

// ---------------------------------------------------------------------------
// Anomaly artifact (Isolation Forest — sklearn pickle embedded as base64)
// ---------------------------------------------------------------------------

/**
 * Isolation Forest produces anomaly scores.
 * The model is serialised as a base64-encoded joblib pickle embedded directly
 * in the metadata JSON — no separate binary file, keeping the artifact self-contained.
 * Inference runs in Node.js by calling a micro Python subprocess that loads the
 * pickle and scores new rows.
 */
export interface AnomalyArtifactMetadata extends ArtifactMetadataBase {
  traitType: 'anomaly';
  /**
   * Base64-encoded joblib-compressed Isolation Forest model.
   * Size is typically <500 KB for reasonable feature counts.
   */
  modelBase64: string;
  /** Number of features expected at inference time */
  featureCount: number;
  /** Ordered list of feature names (match input column order) */
  featureNames: string[];
  /** Contamination parameter used at training time */
  contamination: number;
  /**
   * Anomaly score threshold above which an entity is considered anomalous.
   * Defaults to 0.5. Can be overridden in the trait definition via `sensitivity`.
   */
  threshold: number;
  /** Normalisation parameters: mean + std per feature, for inference-time scaling */
  normalization: {
    means: number[];
    stds: number[];
  };
  featureDependencies?: import('./types').FeatureDependency[];
  dataset?: import('./types').TrainingDataset;
}

// ---------------------------------------------------------------------------
// Similarity artifact (FAISS or cosine matrix)
// ---------------------------------------------------------------------------

/**
 * Strategy used to build the similarity index.
 * - 'cosine_matrix': exact cosine similarity over a stored embedding matrix; small datasets
 * - 'faiss_ivf': approximate nearest-neighbours via FAISS; large datasets
 */
export type SimilarityStrategy = 'cosine_matrix' | 'faiss_ivf';

export interface SimilarityArtifactMetadata extends ArtifactMetadataBase {
  traitType: 'similarity';
  strategy: SimilarityStrategy;
  /**
   * Number of entities in the index.
   */
  entityCount: number;
  /** Embedding dimension (number of features after normalisation) */
  embeddingDim: number;
  /** Ordered list of feature names used to build the embedding */
  featureNames: string[];
  /**
   * Entity IDs in index order.
   * For small datasets, stored directly in metadata.  For large datasets
   * (FAISS), this is a separate `.ids.json` file path relative to metadata.
   */
  entityIds?: unknown[];
  entityIdsFile?: string;
  /**
   * Relative path to the index file from the metadata file.
   * - 'cosine_matrix' strategy → `.embeddings.npy`
   * - 'faiss_ivf' strategy → `.faiss`
   */
  indexFile: string;
  /** Per-feature normalisation: means + stds applied before indexing */
  normalization: {
    means: number[];
    stds: number[];
  };
  featureDependencies?: import('./types').FeatureDependency[];
  dataset?: import('./types').TrainingDataset;
}

// ---------------------------------------------------------------------------
// Sequential artifact (ONNX — window-aggregated tabular features)
// ---------------------------------------------------------------------------

export interface SequentialArtifactMetadata extends ArtifactMetadataBase {
  traitType: 'sequential';
  /** Number of timesteps in each window */
  windowSize: number;
  /** Aggregation functions applied per feature per window step */
  aggregations: Array<'mean' | 'sum' | 'min' | 'max' | 'last'>;
  /** Relative path from the metadata file to the ONNX model file */
  onnxFile: string;
  taskType?: 'regression' | 'binary_classification' | 'multiclass_classification';
  bestEstimator?: string;
  /** Feature schema after window aggregation expansion */
  features?: import('./types').FeatureSchema;
  output?: { field: string; shape: number[] };
  tensorSpec?: { inputShape: number[]; outputShape: number[] };
  featureDependencies?: import('./types').FeatureDependency[];
  encoding?: Record<string, import('./types').CategoryEncoding>;
  imputation?: Record<string, import('./types').ImputationRule>;
  scaling?: Record<string, import('./types').ScalingSpec>;
  trainingMetrics?: import('./types').TrainingMetrics[];
  dataset?: import('./types').TrainingDataset;
}

// ---------------------------------------------------------------------------
// Generative artifact (compiled prompt template — no Python backend)
// ---------------------------------------------------------------------------

/**
 * Compilation artifact for generative traits.
 * Written by `scheml train` to capture the context field list, prompt template,
 * and output schema shape. The Zod `outputSchema` is NOT serialised — it lives
 * in the trait definition and is resolved at inference time.
 */
export interface GenerativeArtifactMetadata extends ArtifactMetadataBase {
  traitType: 'generative';
  /** Entity fields serialised into the prompt context block */
  contextFields: string[];
  /** Raw prompt template from the trait definition */
  promptTemplate: string;
  /**
   * AI SDK invocation strategy derived from the `outputSchema` Zod type:
   * - `'text'`   → `generateText` (plain output)
   * - `'choice'` → `generateObject({ output: 'enum', enum: choiceOptions })`
   * - `'object'` → `generateObject({ schema: zodSchema })`
   */
  outputSchemaShape: 'text' | 'choice' | 'object';
  /** Enum values when outputSchemaShape === 'choice' */
  choiceOptions?: string[];
}

// ---------------------------------------------------------------------------
// Discriminated union
// ---------------------------------------------------------------------------

export type ArtifactMetadata =
  | PredictiveArtifactMetadata
  | AnomalyArtifactMetadata
  | SimilarityArtifactMetadata
  | SequentialArtifactMetadata
  | GenerativeArtifactMetadata;

// ---------------------------------------------------------------------------
// Type guards
// ---------------------------------------------------------------------------

export function isPredictiveArtifact(m: ArtifactMetadata): m is PredictiveArtifactMetadata {
  return m.traitType === 'predictive';
}

export function isAnomalyArtifact(m: ArtifactMetadata): m is AnomalyArtifactMetadata {
  return m.traitType === 'anomaly';
}

export function isSimilarityArtifact(m: ArtifactMetadata): m is SimilarityArtifactMetadata {
  return m.traitType === 'similarity';
}

export function isSequentialArtifact(m: ArtifactMetadata): m is SequentialArtifactMetadata {
  return m.traitType === 'sequential';
}

export function isGenerativeArtifact(m: ArtifactMetadata): m is GenerativeArtifactMetadata {
  return m.traitType === 'generative';
}

// ---------------------------------------------------------------------------
// Artifact file path helpers
// ---------------------------------------------------------------------------

/**
 * Returns the metadata file name for a trait.
 * All types use the same `.metadata.json` suffix so existing tooling (check, status)
 * continues to work without changes to glob patterns.
 */
export function metadataFileName(traitName: string): string {
  return `${traitName}.metadata.json`;
}

export function onnxFileName(traitName: string): string {
  return `${traitName}.onnx`;
}

export function anomalyFileName(_traitName: string): string {
  // Anomaly model is embedded in metadata; no separate binary file.
  return '';
}

export function similarityIndexFileName(traitName: string, strategy: SimilarityStrategy): string {
  return strategy === 'faiss_ivf'
    ? `${traitName}.faiss`
    : `${traitName}.embeddings.npy`;
}

export function similarityIdsFileName(traitName: string): string {
  return `${traitName}.ids.json`;
}
