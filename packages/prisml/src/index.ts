/**
 * PrisML public API
 */

// Types
export * from './types';

// Errors
export * from './errors';

// Model definition
export { defineModel, ModelRegistry, globalModelRegistry, registerModel } from './defineModel';

// Schema utilities
export {
  normalizePrismaSchema,
  hashPrismaSchema,
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
  buildCategoryMapping,
  createFeatureSchema,
  normalizeFeatureVector,
  validateFeatureVector,
} from './encoding';

// Prediction engine
export { ModelMetadataLoader, FeatureExtractor, PredictionSession } from './prediction';

export const VERSION = '0.1.0';
