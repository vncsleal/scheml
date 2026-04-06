/**
 * Unit tests for src/drift.ts
 */

import { describe, it, expect } from 'vitest';
import {
  extractArtifactFeatureNames,
  checkArtifactDrift,
  type SchemaSnapshot,
} from './drift';
import type {
  AnomalyArtifactMetadata,
  SimilarityArtifactMetadata,
  PredictiveArtifactMetadata,
  TemporalArtifactMetadata,
  GenerativeArtifactMetadata,
} from './artifacts';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const BASE = {
  version: '0.3.1',
  metadataSchemaVersion: '1.0.0',
  schemaHash: 'hash-abc',
  compiledAt: '2025-01-01T00:00:00.000Z',
};

const ANOMALY: AnomalyArtifactMetadata = {
  ...BASE,
  traitType: 'anomaly',
  artifactFormat: 'onnx',
  traitName: 'userAnomaly',
  entityName: 'User',
  modelBase64: 'base64==',
  featureCount: 3,
  featureNames: ['age', 'score', 'visits'],
  contamination: 0.1,
  threshold: 0.5,
  normalization: { means: [0, 0, 0], stds: [1, 1, 1] },
};

const SIMILARITY: SimilarityArtifactMetadata = {
  ...BASE,
  traitType: 'similarity',
  artifactFormat: 'npy',
  traitName: 'productSimilarity',
  entityName: 'Product',
  strategy: 'cosine_matrix',
  entityCount: 100,
  embeddingDim: 3,
  featureNames: ['price', 'rating', 'clicks'],
  normalization: { means: [0, 0, 0], stds: [1, 1, 1] },
  indexFile: 'productSimilarity.embeddings.npy',
};

const PREDICTIVE: PredictiveArtifactMetadata = {
  ...BASE,
  traitType: 'predictive',
  artifactFormat: 'onnx',
  traitName: 'churnPred',
  entityName: 'User',
  taskType: 'binary_classification',
  bestEstimator: 'LGBMClassifier',
  features: { features: [], order: ['age', 'planType', 'daysSinceLogin'], count: 3 },
  output: { field: 'churnRisk', shape: [1] },
  tensorSpec: { inputShape: [1, 3], outputShape: [1] },
  featureDependencies: [],
  encoding: {},
  imputation: {},
  scaling: {},
  trainingMetrics: [],
  dataset: {
    size: 1000, splitSeed: 42, trainSize: 800, testSize: 200,
    materializedAt: '2025-01-01T00:00:00.000Z',
  },
  onnxFile: 'churnPred.onnx',
};

const TEMPORAL: TemporalArtifactMetadata = {
  ...BASE,
  traitType: 'temporal',
  artifactFormat: 'onnx',
  traitName: 'revenueSeq',
  entityName: 'Payment',
  windowSize: 5,
  aggregations: ['mean', 'sum', 'min', 'max'],
  onnxFile: 'revenueSeq.onnx',
};

const GENERATIVE: GenerativeArtifactMetadata = {
  ...BASE,
  traitType: 'generative',
  artifactFormat: 'json',
  traitName: 'userSummary',
  entityName: 'User',
  contextFields: ['name', 'email', 'plan'],
  promptTemplate: 'Summarize {name}...',
  outputSchemaShape: 'text',
};

// ---------------------------------------------------------------------------
// extractArtifactFeatureNames
// ---------------------------------------------------------------------------

describe('extractArtifactFeatureNames', () => {
  it('returns featureNames for anomaly artifacts', () => {
    expect(extractArtifactFeatureNames(ANOMALY)).toEqual(['age', 'score', 'visits']);
  });

  it('returns featureNames for similarity artifacts', () => {
    expect(extractArtifactFeatureNames(SIMILARITY)).toEqual(['price', 'rating', 'clicks']);
  });

  it('returns features.order for predictive artifacts', () => {
    expect(extractArtifactFeatureNames(PREDICTIVE)).toEqual(['age', 'planType', 'daysSinceLogin']);
  });

  it('returns [] for temporal artifacts (no stored feature list)', () => {
    expect(extractArtifactFeatureNames(TEMPORAL)).toEqual([]);
  });

  it('returns contextFields for generative artifacts', () => {
    expect(extractArtifactFeatureNames(GENERATIVE)).toEqual(['name', 'email', 'plan']);
  });
});

// ---------------------------------------------------------------------------
// checkArtifactDrift — no drift
// ---------------------------------------------------------------------------

describe('checkArtifactDrift — no drift', () => {
  it('returns hasDrift: false when hashes match', () => {
    const result = checkArtifactDrift(ANOMALY, 'hash-abc');
    expect(result.hasDrift).toBe(false);
    expect(result.traitName).toBe('userAnomaly');
    expect(result.storedHash).toBe('hash-abc');
    expect(result.currentHash).toBe('hash-abc');
    expect(result.added).toBeUndefined();
    expect(result.removed).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// checkArtifactDrift — drift detected
// ---------------------------------------------------------------------------

describe('checkArtifactDrift — drift detected', () => {
  it('returns hasDrift: true when hashes differ', () => {
    const result = checkArtifactDrift(ANOMALY, 'hash-XYZ');
    expect(result.hasDrift).toBe(true);
    expect(result.storedHash).toBe('hash-abc');
    expect(result.currentHash).toBe('hash-XYZ');
  });

  it('does not populate added/removed when currentFields is not supplied', () => {
    const result = checkArtifactDrift(ANOMALY, 'hash-XYZ');
    expect(result.added).toBeUndefined();
    expect(result.removed).toBeUndefined();
  });

  it('populates removed when artifact feature is missing from current schema', () => {
    // Current schema no longer has 'score' and 'visits'
    const current: SchemaSnapshot = {
      age: { type: 'Int', optional: false },
      newField: { type: 'String', optional: true },
    };
    const result = checkArtifactDrift(ANOMALY, 'hash-XYZ', current);
    expect(result.hasDrift).toBe(true);
    expect(result.removed).toContain('score');
    expect(result.removed).toContain('visits');
    expect(result.removed).not.toContain('age');
  });

  it('populates added when schema has new fields not in the artifact', () => {
    const current: SchemaSnapshot = {
      age: { type: 'Int', optional: false },
      score: { type: 'Float', optional: false },
      visits: { type: 'Int', optional: false },
      newField: { type: 'String', optional: true },
    };
    const result = checkArtifactDrift(ANOMALY, 'hash-XYZ', current);
    expect(result.added).toContain('newField');
  });

  it('returns empty added/removed when all feature names still exist', () => {
    const current: SchemaSnapshot = {
      age: { type: 'Int', optional: false },
      score: { type: 'Float', optional: false },
      visits: { type: 'Int', optional: false },
    };
    // Hash differs but fields are unchanged (e.g. a comment changed in schema)
    const result = checkArtifactDrift(ANOMALY, 'hash-XYZ', current);
    expect(result.hasDrift).toBe(true);
    expect(result.removed).toEqual([]);
    expect(result.added).toEqual([]);
  });

  it('works for predictive artifacts with features.order', () => {
    const current: SchemaSnapshot = {
      age: { type: 'Int', optional: false },
      planType: { type: 'String', optional: false },
      // daysSinceLogin was removed
    };
    const result = checkArtifactDrift(PREDICTIVE, 'hash-changed', current);
    expect(result.hasDrift).toBe(true);
    expect(result.removed).toContain('daysSinceLogin');
  });

  it('works for generative artifact with contextFields', () => {
    const current: SchemaSnapshot = {
      name: { type: 'String', optional: false },
      email: { type: 'String', optional: false },
      // plan was removed, bio was added
      bio: { type: 'String', optional: true },
    };
    const result = checkArtifactDrift(GENERATIVE, 'hash-changed', current);
    expect(result.removed).toContain('plan');
    expect(result.added).toContain('bio');
  });

  it('does not populate field-level delta when hasDrift is false', () => {
    const current: SchemaSnapshot = {
      age: { type: 'Int', optional: false },
      score: { type: 'Float', optional: false },
      visits: { type: 'Int', optional: false },
    };
    // Same hash — no drift
    const result = checkArtifactDrift(ANOMALY, 'hash-abc', current);
    expect(result.hasDrift).toBe(false);
    expect(result.added).toBeUndefined();
    expect(result.removed).toBeUndefined();
  });
});
