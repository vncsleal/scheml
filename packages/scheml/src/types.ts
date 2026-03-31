/**
 * ScheML Core Types
 * Defines the type-safe model definition system
 */

/**
 * Supported scalar input types for features
 */
export type ScalarType = number | boolean | string | Date | null;

/**
 * Supported output task types
 */
export type TaskType = 'regression' | 'binary_classification' | 'multiclass_classification';

/**
 * Feature output specification
 */
export interface FeatureOutput {
  type: ScalarType;
  nullable?: boolean;
  imputation?: ImputationRule;
}

/**
 * Imputation rule for handling missing values
 */
export interface ImputationRule {
  strategy: 'mean' | 'median' | 'mode' | 'constant';
  value?: number | string | boolean;
}

/**
 * Categorical feature encoding strategy
 */
export interface CategoryEncoding {
  /** 'onehot' is the default for nominal strings. 'label' and 'hash' are opt-in for power users. */
  type: 'label' | 'hash' | 'onehot';
  /** For label encoding: mapping of category -> numeric code */
  mapping?: Record<string, number>;
  /** For onehot encoding: ordered list of known training categories */
  categories?: string[];
}

/**
 * Standard scaling specification — computed at training time, applied at inference
 */
export interface ScalingSpec {
  strategy: 'standard' | 'none';
  mean?: number;
  std?: number;
}

/**
 * Feature metadata after encoding
 */
export interface EncodedFeature {
  name: string;
  /** Column start index in the flat feature vector */
  index: number;
  /** Number of columns this feature occupies (>1 for onehot) */
  columnCount: number;
  originalType: string;
  encoding?: CategoryEncoding;
  imputation?: ImputationRule;
  scaling?: ScalingSpec;
}

/**
 * Quality gate constraint for build-time validation
 */
export interface QualityGate {
  metric: 'mse' | 'rmse' | 'mae' | 'r2' | 'accuracy' | 'precision' | 'recall' | 'f1';
  threshold: number;
  comparison: 'gte' | 'lte';
  description?: string;
}

/**
 * Algorithm override for power users.
 * When omitted, FLAML AutoML selects and tunes the best algorithm automatically.
 */
export interface AlgorithmConfig {
  /**
   * Algorithm name. Use 'automl' (default) to let FLAML choose.
   * Explicit options: 'linear', 'tree', 'forest', 'gbm'.
   */
  name: string;
  hyperparameters?: Record<string, unknown>;
}

/**
 * Feature resolver: pure function over fully-hydrated entities
 * Returns a scalar value or null
 */
export type FeatureResolver<T> = (entity: T) => ScalarType;

/**
 * Output field resolver
 */
export type OutputResolver<T> = (entity: T) => number | string | boolean;

/**
 * Model definition specification
 * Pure declarative config with no data access or side effects
 */
export interface ModelDefinition<TModel = any> {
  /** Name of the model */
  name: string;
  
  /** Target Prisma model name (e.g., 'User', 'Expense') */
  modelName: string;
  
  /** Output field specification */
  output: {
    field: string;
    taskType: TaskType;
    resolver?: OutputResolver<TModel>;
  };
  
  /** Named feature resolvers */
  features: Record<string, FeatureResolver<TModel>>;

  /**
   * Algorithm override. When omitted, FLAML AutoML selects the best algorithm
   * automatically — recommended for most users.
   */
  algorithm?: AlgorithmConfig;

  /** Build-time quality gates */
  
  qualityGates?: QualityGate[];
  
  /** Prisma schema version hash (computed at compile time) */
  schemaHash?: string;
}

/**
 * Extracted feature schema for a model
 */
export interface FeatureSchema {
  features: EncodedFeature[];
  count: number;
  order: string[];
}

/**
 * Feature dependency contract for schema-only validation
 */
export interface FeatureDependency {
  modelName: string;
  path: string;
  scalarType: 'number' | 'boolean' | 'string' | 'date' | 'unknown';
  nullable: boolean;
  encoding?: CategoryEncoding;
  extractable: boolean;
  issues?: string[];
}

/**
 * Input/output tensor shapes for the trained model
 */
export interface TensorSpec {
  inputShape: number[];
  outputShape: number[];
}

/**
 * Training dataset specification
 */
export interface TrainingDataset {
  size: number;
  splitSeed: number;
  trainSize: number;
  testSize: number;
  materializedAt: string; // ISO timestamp
}

/**
 * Training metrics from hold-out test split
 */
export interface TrainingMetrics {
  metric: string;
  value: number;
  split: 'train' | 'test';
}

/**
 * Model artifact metadata contract
 * Serialized with model.onnx as immutable pair
 */
export interface ModelMetadata {
  version: string; // ScheML version
  metadataSchemaVersion: string;
  
  modelName: string;
  taskType: TaskType;
  
  /** The algorithm that was selected (may be chosen by AutoML) */
  algorithm?: AlgorithmConfig;
  /** The estimator name chosen by FLAML AutoML, if automl was used */
  bestEstimator?: string;

  features: FeatureSchema;

  output: {
    field: string;
    shape: number[];
  };
  
  encoding: {
    [featureName: string]: CategoryEncoding | undefined;
  };

  imputation: {
    [featureName: string]: ImputationRule | undefined;
  };

  scaling: {
    [featureName: string]: ScalingSpec | undefined;
  };

  featureDependencies?: FeatureDependency[];
  tensorSpec?: TensorSpec;
  
  /** Normalized Prisma schema SHA256 hash */
  prismaSchemaHash: string;
  
  trainingMetrics?: TrainingMetrics[];
  dataset?: TrainingDataset;
  
  compiledAt: string; // ISO timestamp
}

/**
 * Prediction input for a single entity
 */
export interface PredictionInput<T> {
  entity: T;
  modelName: string;
}

/**
 * Prediction output
 */
export interface PredictionOutput {
  modelName: string;
  prediction: number | string;
  confidence?: number;
  timestamp: string;
}

/**
 * Batch prediction result
 * 
 * PRD Requirement: Atomic batch execution - either all succeed or entire batch fails.
 * Results array contains only successful predictions (never errors).
 * If any entity fails preflight validation, the entire batch throws without partial execution.
 */
export interface BatchPredictionResult {
  modelName: string;
  results: PredictionOutput[];
  successCount: number;
  failureCount: number; // Always 0 (kept for backward compatibility)
}

/**
 * Feature extraction result
 */
export interface ExtractedFeatures {
  values: number[];
  featureNames: string[];
}

/**
 * Output from a generative trait inference call.
 * The result type depends on the trait's outputSchema:
 * - `z.string()` / no schema → plain string
 * - `z.enum([...])` → the selected enum value (string)
 * - `z.object({...})` → structured object
 */
export interface GenerativePredictionOutput {
  traitName: string;
  result: string | Record<string, unknown>;
  timestamp: string;
}
