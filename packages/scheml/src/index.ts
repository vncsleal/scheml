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

export const VERSION = '0.3.1';
