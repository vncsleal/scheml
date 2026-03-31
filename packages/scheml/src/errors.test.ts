import { describe, it, expect } from 'vitest';
import {
  ScheMLError,
  SchemaDriftError,
  ModelDefinitionError,
  FeatureExtractionError,
  HydrationError,
  UnseenCategoryError,
  ArtifactError,
  QualityGateError,
  ONNXRuntimeError,
  EncodingError,
  ConfigurationError,
} from './errors';

describe('ScheMLError (base)', () => {
  it('is instanceof Error', () => {
    const e = new ScheMLError('TEST', 'msg');
    expect(e).toBeInstanceOf(Error);
  });

  it('exposes code and message', () => {
    const e = new ScheMLError('MY_CODE', 'my message');
    expect(e.code).toBe('MY_CODE');
    expect(e.message).toBe('my message');
  });

  it('serializes via toJSON', () => {
    const e = new ScheMLError('CODE', 'msg', { key: 'val' });
    const json = e.toJSON();
    expect(json.code).toBe('CODE');
    expect(json.message).toBe('msg');
    expect(json.context).toEqual({ key: 'val' });
  });
});

describe('SchemaDriftError', () => {
  const err = new SchemaDriftError('abc123', 'def456');

  it('has code SCHEMA_DRIFT_ERROR', () => {
    expect(err.code).toBe('SCHEMA_DRIFT_ERROR');
  });

  it('includes both hashes in context', () => {
    expect(err.context['expectedHash']).toBe('abc123');
    expect(err.context['actualHash']).toBe('def456');
  });

  it('is instanceof SchemaDriftError and ScheMLError', () => {
    expect(err).toBeInstanceOf(SchemaDriftError);
    expect(err).toBeInstanceOf(ScheMLError);
  });

  it('message references both hashes', () => {
    expect(err.message).toContain('abc123');
    expect(err.message).toContain('def456');
  });
});

describe('ModelDefinitionError', () => {
  it('has code MODEL_DEFINITION_ERROR', () => {
    const e = new ModelDefinitionError('UserLTV', 'missing required field');
    expect(e.code).toBe('MODEL_DEFINITION_ERROR');
  });

  it('includes modelName in message', () => {
    const e = new ModelDefinitionError('UserLTV', 'bad config');
    expect(e.message).toContain('UserLTV');
  });

  it('includes modelName in context', () => {
    const e = new ModelDefinitionError('UserLTV', 'bad config');
    expect(e.context['modelName']).toBe('UserLTV');
  });
});

describe('FeatureExtractionError', () => {
  it('has code FEATURE_EXTRACTION_ERROR', () => {
    const e = new FeatureExtractionError('UserLTV', 'accountAge', 'resolver threw');
    expect(e.code).toBe('FEATURE_EXTRACTION_ERROR');
  });

  it('includes modelName and featureName in context', () => {
    const e = new FeatureExtractionError('UserLTV', 'accountAge', 'null value');
    expect(e.context['modelName']).toBe('UserLTV');
    expect(e.context['featureName']).toBe('accountAge');
  });

  it('includes batch index in message when provided', () => {
    const e = new FeatureExtractionError('UserLTV', 'accountAge', 'null', 5);
    expect(e.message).toContain('batch[5]');
  });

  it('does not mention batch index when not provided', () => {
    const e = new FeatureExtractionError('UserLTV', 'accountAge', 'null');
    expect(e.message).not.toContain('batch');
  });
});

describe('HydrationError', () => {
  it('has code HYDRATION_ERROR', () => {
    const e = new HydrationError('UserLTV', 'user.profile', 'not found');
    expect(e.code).toBe('HYDRATION_ERROR');
  });

  it('includes entityPath in message', () => {
    const e = new HydrationError('UserLTV', 'user.profile', 'not found');
    expect(e.message).toContain('user.profile');
  });

  it('includes batch index when provided', () => {
    const e = new HydrationError('UserLTV', 'user.profile', 'not found', 3);
    expect(e.message).toContain('batch[3]');
  });
});

describe('UnseenCategoryError', () => {
  it('has code UNSEEN_CATEGORY_ERROR', () => {
    const e = new UnseenCategoryError('UserLTV', 'plan', 'enterprise_v2');
    expect(e.code).toBe('UNSEEN_CATEGORY_ERROR');
  });

  it('includes the unseen value in context', () => {
    const e = new UnseenCategoryError('UserLTV', 'plan', 'enterprise_v2');
    expect(e.context['value']).toBe('enterprise_v2');
  });

  it('includes the unseen value in the message', () => {
    const e = new UnseenCategoryError('UserLTV', 'plan', 'enterprise_v2');
    expect(e.message).toContain('enterprise_v2');
  });
});

describe('ArtifactError', () => {
  it('has code ARTIFACT_ERROR', () => {
    const e = new ArtifactError('UserLTV', 'file not found');
    expect(e.code).toBe('ARTIFACT_ERROR');
  });

  it('includes modelName in message', () => {
    const e = new ArtifactError('UserLTV', 'not found');
    expect(e.message).toContain('UserLTV');
  });
});

describe('QualityGateError', () => {
  it('has code QUALITY_GATE_ERROR', () => {
    const e = new QualityGateError('UserLTV', 'r2', 0.8, 0.65, 'gte');
    expect(e.code).toBe('QUALITY_GATE_ERROR');
  });

  it('includes metric, threshold and actual in message', () => {
    const e = new QualityGateError('UserLTV', 'r2', 0.8, 0.65, 'gte');
    expect(e.message).toContain('r2');
    expect(e.message).toContain('0.8');
    expect(e.message).toContain('0.65');
  });

  it('includes all values in context', () => {
    const e = new QualityGateError('UserLTV', 'accuracy', 0.9, 0.7, 'gte');
    expect(e.context['metric']).toBe('accuracy');
    expect(e.context['threshold']).toBe(0.9);
    expect(e.context['actual']).toBe(0.7);
  });
});

describe('ONNXRuntimeError', () => {
  it('has code ONNX_RUNTIME_ERROR', () => {
    const e = new ONNXRuntimeError('UserLTV', 'session failed');
    expect(e.code).toBe('ONNX_RUNTIME_ERROR');
  });

  it('includes modelName in message', () => {
    const e = new ONNXRuntimeError('UserLTV', 'session failed');
    expect(e.message).toContain('UserLTV');
  });
});

describe('EncodingError', () => {
  it('has code ENCODING_ERROR', () => {
    const e = new EncodingError('UserLTV', 'plan', 'unsupported type');
    expect(e.code).toBe('ENCODING_ERROR');
  });

  it('includes modelName and featureName in message', () => {
    const e = new EncodingError('UserLTV', 'plan', 'bad value');
    expect(e.message).toContain('UserLTV');
    expect(e.message).toContain('plan');
  });
});

describe('ConfigurationError', () => {
  it('has code CONFIGURATION_ERROR', () => {
    const e = new ConfigurationError('Python not found');
    expect(e.code).toBe('CONFIGURATION_ERROR');
  });

  it('includes message', () => {
    const e = new ConfigurationError('Python not found');
    expect(e.message).toContain('Python not found');
  });
});

describe('Error instanceof chain', () => {
  it('all ScheML errors are instanceof ScheMLError', () => {
    const errors = [
      new SchemaDriftError('a', 'b'),
      new ModelDefinitionError('m', 'msg'),
      new FeatureExtractionError('m', 'f', 'reason'),
      new HydrationError('m', 'path', 'reason'),
      new UnseenCategoryError('m', 'f', 'val'),
      new ArtifactError('m', 'msg'),
      new QualityGateError('m', 'r2', 0.8, 0.5, 'gte'),
      new ONNXRuntimeError('m', 'msg'),
      new EncodingError('m', 'f', 'reason'),
      new ConfigurationError('msg'),
    ];
    for (const e of errors) {
      expect(e).toBeInstanceOf(ScheMLError);
      expect(e).toBeInstanceOf(Error);
    }
  });
});
