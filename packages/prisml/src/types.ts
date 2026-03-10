/**
 * PrisML Core Types
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
  type: 'label' | 'hash';
  /** For label encoding: mapping of category -> numeric code */
  mapping?: Record<string, number>;
}

/**
 * Feature metadata after encoding
 */
export interface EncodedFeature {
  name: string;
  index: number;
  originalType: string;
  encoding?: CategoryEncoding;
  imputation?: ImputationRule;
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
 * Algorithm selection with pinned version
 */
export interface AlgorithmConfig {
  /** Algorithm name: 'linear', 'tree', 'forest', 'gbm' */
  name: string;
  /**
   * Pinned version for determinism.
   * IMPORTANT: This field is declared but not currently enforced — the Python
   * backend does not read or validate it. It is reserved for future version
   * pinning once algorithm versioning is implemented.
   */
  version: string;
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
  
  /** Algorithm choice */
  algorithm: AlgorithmConfig;
  
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
  version: string; // PrisML version
  metadataSchemaVersion: string;
  
  modelName: string;
  taskType: TaskType;
  
  algorithm: AlgorithmConfig;
  
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
