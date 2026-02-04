/**
 * Core index: re-export all public APIs
 */

// Types
export * from './types';

// Error handling
export * from './errors';


// Model definition
export { defineModel, ModelRegistry, globalModelRegistry, registerModel } from './defineModel';

// Schema hashing
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

export const VERSION = '0.1.0';
