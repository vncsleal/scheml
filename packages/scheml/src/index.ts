/**
 * ScheML public API
 */

// Types
export * from './types';

// Trait type system
export type {
  TraitType,
  TraitFeedbackApi,
  BaseTraitDefinition,
  PredictiveTrait,
  AnomalyTrait,
  SimilarityTrait,
  SequentialTrait,
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

// Model definition (legacy — use defineTrait for new code)
export { defineModel } from './defineModel';

// Schema utilities
export {
  normalizePrismaSchema,
  hashPrismaSchema,
  hashPrismaModelSubset,
  validateSchemaHash,
  extractModelNames,
  parseModelSchema,
} from './schema';

// Feature analysis
export type { AccessPath, FeatureAnalysis, AnalysisIssue } from './analysis';
export { analyzeFeatureResolver, validateHydration } from './analysis';

// Encoding & normalization
export {
  normalizeScalarValue,
  applyScaling,
  buildCategoryMapping,
  buildCategories,
  createFeatureSchema,
  normalizeFeatureVector,
  validateFeatureVector,
} from './encoding';

// Prediction engine
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

export { getAdapter, registerAdapter, listAdapters } from './adapters/index';

// Artifact type contracts (used by train.ts writer and PredictionSession loader)
export type {
  ArtifactMetadataBase,
  ArtifactMetadata,
  PredictiveArtifactMetadata,
  AnomalyArtifactMetadata,
  SimilarityArtifactMetadata,
  SequentialArtifactMetadata,
  GenerativeArtifactMetadata,
  SimilarityStrategy,
} from './artifacts';
export {
  isPredictiveArtifact,
  isAnomalyArtifact,
  isSimilarityArtifact,
  isSequentialArtifact,
  isGenerativeArtifact,
  metadataFileName,
  onnxFileName,
  similarityIndexFileName,
} from './artifacts';

// Generative trait utilities
export type { OutputSchemaShape, DetectedOutputSchema } from './generative';
export { detectOutputSchemaShape, validateGenerativeTrait, compileGenerativeTrait } from './generative';

// Configuration factory
export type { ScheMlConfig } from './defineConfig';
export { defineConfig } from './defineConfig';

// History — append-only JSONL audit trail for training runs and drift events
export type { HistoryRecord } from './history';
export {
  detectAuthor,
  historyDir,
  historyFilePath,
  readHistoryRecords,
  readLatestHistoryRecord,
  appendHistoryRecord,
  nextArtifactVersion,
} from './history';

// Drift detection — compare stored schema hash to current entity schema
export type { SchemaFieldSnapshot, SchemaSnapshot, SchemaDelta } from './drift';
export { extractArtifactFeatureNames, checkArtifactDrift } from './drift';

// Runtime extension helpers
export { TTLCache } from './cache';
export type { ExtendClientOptions } from './runtime';
export { extendClient } from './runtime';

export const VERSION = '0.3.1';
