/**
 * ScheML public API
 */

// Types
export * from './types';

// Trait type system
export type {
  TraitType,
  StringKeyOf,
  ZodLike,
  TraitFeedbackApi,
  BaseTraitDefinition,
  PredictiveTrait,
  AnomalyTrait,
  SimilarityTrait,
  TemporalTrait,
  GenerativeTrait,
  AnyTraitDefinition,
  ResolvedTrait,
} from './traitTypes';

// Trait definition API
export { defineTrait } from './defineTrait';

// Trait graph validation
export { resolveTraitGraph, topologicalSort, TraitGraphError } from './traitGraph';

// Errors
export * from './errors';

// Schema utilities
export {
  normalizeSchemaText,
  hashSchemaText,
  hashSchemaEntitySubset,
  validateSchemaHash,
  extractModelNames,
  parseModelSchema,
} from './schema';

export type { SchemaHashComparison } from './schemaHash';
export {
  hashSchemaGraph,
  hashSchemaGraphEntity,
  hashSchemaEntity,
  hashSchemaSource,
  resolveSchemaEntityName,
  computeMetadataSchemaHash,
  compareSchemaHashes,
} from './schemaHash';

// Feature analysis
export type { AccessPath, FeatureAnalysis, AnalysisIssue } from './analysis';
export { analyzeFeatureResolver, validateHydration } from './analysis';

// Encoding & normalization
export {
  normalizeScalarValue,
  applyScaling,
  buildCategoryMapping,
  buildCategories,
  normalizeFeatureVector,
  validateFeatureVector,
} from './encoding';

// Prediction engine
export type { PredictionSessionOptions } from './prediction';
export { ModelMetadataLoader, FeatureExtractor, PredictionSession } from './prediction';

// Adapter system
export type {
  SchemaGraph,
  EntitySchema,
  FieldSchema,
  SchemaReader,
  DataExtractor,
  QueryInterceptor,
  ScheMLAdapter,
  ExtractOptions,
  Row,
  InferenceResult,
} from './adapters/interface';

export {
  PrismaSchemaReader,
  PrismaDataExtractor,
  PrismaQueryInterceptor,
  createPrismaAdapter,
} from './adapters/prisma';

export { ZodSchemaReader, createZodAdapter } from './adapters/zod';

export {
  DrizzleSchemaReader,
  DrizzleDataExtractor,
  createDrizzleAdapter,
} from './adapters/drizzle';

export {
  TypeOrmSchemaReader,
  TypeOrmDataExtractor,
  TypeOrmQueryInterceptor,
  createTypeOrmAdapter,
} from './adapters/typeorm';

export { getAdapter, registerAdapter, listAdapters } from './adapters/index';

// Artifact type contracts (used by train.ts writer and PredictionSession loader)
export type {
  ArtifactMetadataBase,
  ArtifactMetadata,
  PredictiveArtifactMetadata,
  AnomalyArtifactMetadata,
  SimilarityArtifactMetadata,
  TemporalArtifactMetadata,
  GenerativeArtifactMetadata,
  SimilarityStrategy,
} from './artifacts';
export {
  isPredictiveArtifact,
  isAnomalyArtifact,
  isSimilarityArtifact,
  isTemporalArtifact,
  isGenerativeArtifact,
  metadataFileName,
  onnxFileName,
  similarityIndexFileName,
} from './artifacts';

// Generative trait utilities
export type { OutputSchemaShape, DetectedOutputSchema } from './generative';
export { detectOutputSchemaShape, validateGenerativeTrait, compileGenerativeTrait } from './generative';

// Configuration factory
export type { ScheMLConfig } from './defineConfig';
export { defineConfig } from './defineConfig';

// History — append-only JSONL audit trail for training runs and drift events
export type { HistoryRecord, HistoryStatus } from './history';
export {
  detectAuthor,
  historyDir,
  historyFilePath,
  readHistoryRecords,
  readLatestHistoryRecord,
  appendHistoryRecord,
  nextArtifactVersion,
  VALID_TRANSITIONS,
  validateStatusTransition,
  transitionStatus,
  deprecateArtifact,
} from './history';

// Drift detection — compare stored schema hash to current entity schema
export type { SchemaFieldSnapshot, SchemaSnapshot, SchemaDelta } from './drift';
export { extractArtifactFeatureNames, checkArtifactDrift } from './drift';

// Runtime extension helpers
export { TTLCache } from './cache';
export type { ExtendClientOptions } from './runtime';
export { createPredictionSession, extendClient } from './runtime';

// Feedback — accuracy decay detection from ground-truth observations
export type { FeedbackRecord, AccuracyDecayResult } from './feedback';
export {
  feedbackFilePath,
  readFeedbackRecords,
  checkFeedbackDecay,
} from './feedback';

export const VERSION = '0.1.0';
