/**
 * PrisML Error Taxonomy
 * Structured error handling with typed context
 */

/**
 * Base PrisML error class
 */
export class PrisMLError extends Error {
  public readonly code: string;
  public readonly context: Record<string, unknown>;

  constructor(
    code: string,
    message: string,
    context: Record<string, unknown> = {}
  ) {
    super(message);
    this.code = code;
    this.context = context;
    this.name = 'PrisMLError';
    Object.setPrototypeOf(this, PrisMLError.prototype);
  }

  toJSON() {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      context: this.context,
    };
  }
}

/**
 * Schema validation error
 */
export class SchemaValidationError extends PrisMLError {
  constructor(message: string, context?: Record<string, unknown>) {
    super('SCHEMA_VALIDATION_ERROR', message, context);
    this.name = 'SchemaValidationError';
    Object.setPrototypeOf(this, SchemaValidationError.prototype);
  }
}

/**
 * Schema hash mismatch at runtime
 */
export class SchemaDriftError extends PrisMLError {
  constructor(expected: string, actual: string) {
    super(
      'SCHEMA_DRIFT_ERROR',
      `Prisma schema hash mismatch: expected ${expected}, got ${actual}. This indicates schema drift since model compilation.`,
      { expectedHash: expected, actualHash: actual }
    );
    this.name = 'SchemaDriftError';
    Object.setPrototypeOf(this, SchemaDriftError.prototype);
  }
}

/**
 * Model definition validation error
 */
export class ModelDefinitionError extends PrisMLError {
  constructor(modelName: string, message: string, context?: Record<string, unknown>) {
    super(
      'MODEL_DEFINITION_ERROR',
      `Model "${modelName}": ${message}`,
      { modelName, ...context }
    );
    this.name = 'ModelDefinitionError';
    Object.setPrototypeOf(this, ModelDefinitionError.prototype);
  }
}

/**
 * Feature extraction failure
 */
export class FeatureExtractionError extends PrisMLError {
  constructor(
    modelName: string,
    featureName: string,
    reason: string,
    batchIndex?: number,
    context?: Record<string, unknown>
  ) {
    const msg =
      batchIndex !== undefined
        ? `Model "${modelName}", feature "${featureName}" (batch[${batchIndex}]): ${reason}`
        : `Model "${modelName}", feature "${featureName}": ${reason}`;

    super('FEATURE_EXTRACTION_ERROR', msg, {
      modelName,
      featureName,
      batchIndex,
      reason,
      ...context,
    });
    this.name = 'FeatureExtractionError';
    Object.setPrototypeOf(this, FeatureExtractionError.prototype);
  }
}

/**
 * Hydration failure: entity missing required fields
 */
export class HydrationError extends PrisMLError {
  constructor(
    modelName: string,
    entityPath: string,
    reason: string,
    batchIndex?: number
  ) {
    const msg =
      batchIndex !== undefined
        ? `Model "${modelName}" hydration failed at "${entityPath}" (batch[${batchIndex}]): ${reason}`
        : `Model "${modelName}" hydration failed at "${entityPath}": ${reason}`;

    super('HYDRATION_ERROR', msg, {
      modelName,
      entityPath,
      batchIndex,
      reason,
    });
    this.name = 'HydrationError';
    Object.setPrototypeOf(this, HydrationError.prototype);
  }
}

/**
 * Unseen categorical value at runtime
 */
export class UnseenCategoryError extends PrisMLError {
  constructor(
    modelName: string,
    featureName: string,
    value: string,
    batchIndex?: number
  ) {
    const msg =
      batchIndex !== undefined
        ? `Model "${modelName}", feature "${featureName}" (batch[${batchIndex}]): unseen category "${value}"`
        : `Model "${modelName}", feature "${featureName}": unseen category "${value}"`;

    super('UNSEEN_CATEGORY_ERROR', msg, {
      modelName,
      featureName,
      value,
      batchIndex,
    });
    this.name = 'UnseenCategoryError';
    Object.setPrototypeOf(this, UnseenCategoryError.prototype);
  }
}

/**
 * Artifact not found or invalid
 */
export class ArtifactError extends PrisMLError {
  constructor(modelName: string, message: string, context?: Record<string, unknown>) {
    super('ARTIFACT_ERROR', `Model "${modelName}": ${message}`, {
      modelName,
      ...context,
    });
    this.name = 'ArtifactError';
    Object.setPrototypeOf(this, ArtifactError.prototype);
  }
}

/**
 * Quality gate failure during compilation
 */
export class QualityGateError extends PrisMLError {
  constructor(
    modelName: string,
    metric: string,
    threshold: number,
    actual: number,
    comparison: string
  ) {
    const msg = `Model "${modelName}" quality gate failed: ${metric} ${comparison} ${threshold}, got ${actual}`;
    super('QUALITY_GATE_ERROR', msg, {
      modelName,
      metric,
      threshold,
      actual,
      comparison,
    });
    this.name = 'QualityGateError';
    Object.setPrototypeOf(this, QualityGateError.prototype);
  }
}

/**
 * ONNX Runtime error
 */
export class ONNXRuntimeError extends PrisMLError {
  constructor(modelName: string, message: string, originalError?: Error) {
    super('ONNX_RUNTIME_ERROR', `Model "${modelName}": ${message}`, {
      modelName,
      originalMessage: originalError?.message,
    });
    this.name = 'ONNXRuntimeError';
    Object.setPrototypeOf(this, ONNXRuntimeError.prototype);
  }
}

/**
 * Encoding/normalization error
 */
export class EncodingError extends PrisMLError {
  constructor(modelName: string, featureName: string, reason: string) {
    super('ENCODING_ERROR', `Model "${modelName}", feature "${featureName}": ${reason}`, {
      modelName,
      featureName,
      reason,
    });
    this.name = 'EncodingError';
    Object.setPrototypeOf(this, EncodingError.prototype);
  }
}

/**
 * Configuration or environment error
 */
export class ConfigurationError extends PrisMLError {
  constructor(message: string, context?: Record<string, unknown>) {
    super('CONFIGURATION_ERROR', message, context);
    this.name = 'ConfigurationError';
    Object.setPrototypeOf(this, ConfigurationError.prototype);
  }
}
