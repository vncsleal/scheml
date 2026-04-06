import { describe, it, expect } from 'vitest';
import {
  isPredictiveArtifact,
  isAnomalyArtifact,
  isSimilarityArtifact,
  isTemporalArtifact,
  metadataFileName,
  onnxFileName,
  similarityIndexFileName,
  similarityIdsFileName,
  anomalyFileName,
  type ArtifactMetadata,
  type PredictiveArtifactMetadata,
  type AnomalyArtifactMetadata,
  type SimilarityArtifactMetadata,
  type TemporalArtifactMetadata,
} from '../../src/artifacts';

// ---------------------------------------------------------------------------
// Minimal artifact samples
// ---------------------------------------------------------------------------

const BASE = {
  version: '0.3.1',
  metadataSchemaVersion: '1.0.0',
  traitName: 'myTrait',
  schemaHash: 'abc123',
  compiledAt: '2026-01-01T00:00:00.000Z',
} as const;

const predictive: PredictiveArtifactMetadata = {
  ...BASE,
  traitType: 'predictive',
  artifactFormat: 'onnx',
  taskType: 'binary_classification',
  bestEstimator: 'lgbm',
  features: {
    count: 2,
    features: [
      { name: 'age', index: 0, columnCount: 1, originalType: 'number' },
      { name: 'spend', index: 1, columnCount: 1, originalType: 'number' },
    ],
    order: ['age', 'spend'],
  },
  output: { field: 'churn', shape: [1] },
  tensorSpec: { inputShape: [1, 2], outputShape: [1] },
  featureDependencies: [],
  encoding: {},
  imputation: {},
  scaling: {},
  trainingMetrics: [],
  dataset: {
    size: 100,
    splitSeed: 42,
    trainSize: 80,
    testSize: 20,
    materializedAt: '2026-01-01T00:00:00.000Z',
  },
  onnxFile: 'myTrait.onnx',
};

const anomaly: AnomalyArtifactMetadata = {
  ...BASE,
  traitType: 'anomaly',
  artifactFormat: 'onnx',
  modelBase64: 'BASE64DATA==',
  featureCount: 3,
  featureNames: ['age', 'spend', 'sessions'],
  contamination: 0.1,
  threshold: 0.5,
  normalization: { means: [30, 200, 5], stds: [10, 50, 2] },
};

const similarity: SimilarityArtifactMetadata = {
  ...BASE,
  traitType: 'similarity',
  artifactFormat: 'npy',
  strategy: 'cosine_matrix',
  entityCount: 50,
  embeddingDim: 3,
  featureNames: ['age', 'spend', 'sessions'],
  indexFile: 'myTrait.embeddings.npy',
  normalization: { means: [30, 200, 5], stds: [10, 50, 2] },
  entityIds: [1, 2, 3],
};

const temporal: TemporalArtifactMetadata = {
  ...BASE,
  traitType: 'temporal',
  artifactFormat: 'onnx',
  windowSize: 5,
  aggregations: ['mean', 'sum', 'min', 'max'],
  onnxFile: 'myTrait.onnx',
  taskType: 'regression',
  bestEstimator: 'lgbm',
};

// ---------------------------------------------------------------------------
// Type guard tests
// ---------------------------------------------------------------------------

describe('isPredictiveArtifact', () => {
  it('returns true for predictive artifact', () => {
    expect(isPredictiveArtifact(predictive)).toBe(true);
  });
  it('returns false for non-predictive artifact', () => {
    expect(isPredictiveArtifact(anomaly as ArtifactMetadata)).toBe(false);
    expect(isPredictiveArtifact(similarity as ArtifactMetadata)).toBe(false);
    expect(isPredictiveArtifact(temporal as ArtifactMetadata)).toBe(false);
  });
});

describe('isAnomalyArtifact', () => {
  it('returns true for anomaly artifact', () => {
    expect(isAnomalyArtifact(anomaly as ArtifactMetadata)).toBe(true);
  });
  it('returns false for non-anomaly artifact', () => {
    expect(isAnomalyArtifact(predictive)).toBe(false);
    expect(isAnomalyArtifact(similarity as ArtifactMetadata)).toBe(false);
    expect(isAnomalyArtifact(temporal as ArtifactMetadata)).toBe(false);
  });
});

describe('isSimilarityArtifact', () => {
  it('returns true for similarity artifact', () => {
    expect(isSimilarityArtifact(similarity as ArtifactMetadata)).toBe(true);
  });
  it('returns false for non-similarity artifact', () => {
    expect(isSimilarityArtifact(predictive)).toBe(false);
    expect(isSimilarityArtifact(anomaly as ArtifactMetadata)).toBe(false);
    expect(isSimilarityArtifact(temporal as ArtifactMetadata)).toBe(false);
  });
});

describe('isTemporalArtifact', () => {
  it('returns true for temporal artifact', () => {
    expect(isTemporalArtifact(temporal as ArtifactMetadata)).toBe(true);
  });
  it('returns false for non-temporal artifact', () => {
    expect(isTemporalArtifact(predictive)).toBe(false);
    expect(isTemporalArtifact(anomaly as ArtifactMetadata)).toBe(false);
    expect(isTemporalArtifact(similarity as ArtifactMetadata)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Type guard narrows correctly
// ---------------------------------------------------------------------------

describe('type narrowing after guard', () => {
  it('narrows to AnomalyArtifactMetadata on isAnomalyArtifact', () => {
    const m: ArtifactMetadata = anomaly as ArtifactMetadata;
    if (isAnomalyArtifact(m)) {
      expect(m.modelBase64).toBe('BASE64DATA==');
      expect(m.featureCount).toBe(3);
      expect(m.threshold).toBe(0.5);
    } else {
      throw new Error('expected anomaly guard to pass');
    }
  });

  it('narrows to SimilarityArtifactMetadata on isSimilarityArtifact', () => {
    const m: ArtifactMetadata = similarity as ArtifactMetadata;
    if (isSimilarityArtifact(m)) {
      expect(m.strategy).toBe('cosine_matrix');
      expect(m.entityCount).toBe(50);
    } else {
      throw new Error('expected similarity guard to pass');
    }
  });

  it('narrows to TemporalArtifactMetadata on isTemporalArtifact', () => {
    const m: ArtifactMetadata = temporal as ArtifactMetadata;
    if (isTemporalArtifact(m)) {
      expect(m.windowSize).toBe(5);
      expect(m.onnxFile).toBe('myTrait.onnx');
    } else {
      throw new Error('expected temporal guard to pass');
    }
  });
});

// ---------------------------------------------------------------------------
// File name helpers
// ---------------------------------------------------------------------------

describe('metadataFileName', () => {
  it('returns traitName.metadata.json', () => {
    expect(metadataFileName('userChurn')).toBe('userChurn.metadata.json');
    expect(metadataFileName('sessionAnomaly')).toBe('sessionAnomaly.metadata.json');
  });
});

describe('onnxFileName', () => {
  it('returns traitName.onnx', () => {
    expect(onnxFileName('userChurn')).toBe('userChurn.onnx');
  });
});

describe('anomalyFileName', () => {
  it('returns empty string — model is embedded in metadata', () => {
    expect(anomalyFileName('sessionAnomaly')).toBe('');
  });
});

describe('similarityIndexFileName', () => {
  it('returns .embeddings.npy for cosine_matrix strategy', () => {
    expect(similarityIndexFileName('productSim', 'cosine_matrix')).toBe(
      'productSim.embeddings.npy'
    );
  });
  it('returns .faiss for faiss_ivf strategy', () => {
    expect(similarityIndexFileName('productSim', 'faiss_ivf')).toBe('productSim.faiss');
  });
});

describe('similarityIdsFileName', () => {
  it('returns traitName.ids.json', () => {
    expect(similarityIdsFileName('productSim')).toBe('productSim.ids.json');
  });
});

// ---------------------------------------------------------------------------
// Base fields are present on all artifact types
// ---------------------------------------------------------------------------

describe('ArtifactMetadataBase fields', () => {
  const all: ArtifactMetadata[] = [
    predictive,
    anomaly as ArtifactMetadata,
    similarity as ArtifactMetadata,
    temporal as ArtifactMetadata,
  ];

  it.each(all)('artifact $traitType has required base fields', (m) => {
    expect(typeof m.version).toBe('string');
    expect(typeof m.metadataSchemaVersion).toBe('string');
    expect(typeof m.traitType).toBe('string');
    expect(typeof m.traitName).toBe('string');
    expect(typeof m.schemaHash).toBe('string');
    expect(typeof m.compiledAt).toBe('string');
  });
});
