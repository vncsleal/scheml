/**
 * Feature Encoding & Normalization
 * Convert resolver outputs to deterministic numeric feature vectors
 */

import {
  CategoryEncoding,
  ImputationRule,
  EncodedFeature,
  FeatureSchema,
} from './types';
import {
  EncodingError,
  HydrationError,
  UnseenCategoryError,
} from './errors';

/**
 * Normalize a scalar value to a numeric feature
 */
export function normalizeScalarValue(
  value: unknown,
  featureName: string,
  encoding?: CategoryEncoding,
  imputation?: ImputationRule
): number {
  // Handle null/undefined
  if (value === null || value === undefined) {
    if (imputation) {
      return applyImputation(imputation);
    }
    throw new Error(`${featureName}: null value without imputation rule`);
  }

  // Handle numeric
  if (typeof value === 'number') {
    if (!isFinite(value)) {
      throw new Error(`${featureName}: non-finite number`);
    }
    return value;
  }

  // Handle boolean
  if (typeof value === 'boolean') {
    return value ? 1 : 0;
  }

  // Handle string/categorical
  if (typeof value === 'string') {
    if (!encoding) {
      throw new Error(`${featureName}: categorical value without encoding specification`);
    }
    return encodeCategoryValue(value, featureName, encoding);
  }

  // Handle Date
  if (value instanceof Date) {
    return value.getTime() / 1000; // Convert to seconds since epoch
  }

  throw new Error(`${featureName}: unsupported scalar type ${typeof value}`);
}

/**
 * Encode a categorical value to numeric using label or hash encoding
 */
function encodeCategoryValue(
  value: string,
  featureName: string,
  encoding: CategoryEncoding
): number {
  if (encoding.type === 'label') {
    if (!encoding.mapping) {
      throw new Error(`${featureName}: label encoding missing mapping`);
    }
    const code = encoding.mapping[value];
    if (code === undefined) {
      throw new UnseenCategoryError('unknown-model', featureName, value);
    }
    return code;
  } else if (encoding.type === 'hash') {
    // Simple hash: sum of character codes mod 1000
    // In practice, use MurmurHash or similar for production
    const hash = Array.from(value).reduce((acc, char) => acc + char.charCodeAt(0), 0);
    return hash % 1000;
  }

  throw new Error(`${featureName}: unknown encoding type ${encoding.type}`);
}

/**
 * Apply imputation strategy
 */
function applyImputation(rule: ImputationRule): number {
  switch (rule.strategy) {
    case 'constant':
      if (typeof rule.value !== 'number') {
        throw new Error('Constant imputation requires numeric value');
      }
      return rule.value;
    case 'mean':
      // Mean is computed during training and stored in metadata
      return 0;
    case 'median':
      // Median is computed during training and stored in metadata
      return 0;
    case 'mode':
      // Mode is computed during training and stored in metadata
      return 0;
    default:
      throw new Error(`Unknown imputation strategy: ${rule.strategy}`);
  }
}

/**
 * Build category mapping from training data
 */
export function buildCategoryMapping(
  values: (string | null | undefined)[],
  strategy: 'label' | 'hash' = 'label'
): Record<string, number> {
  if (strategy === 'hash') {
    // Hash encoding doesn't need explicit mapping
    return {};
  }

  const categories = new Set<string>();
  for (const val of values) {
    if (val !== null && val !== undefined) {
      categories.add(val);
    }
  }

  const mapping: Record<string, number> = {};
  const sorted = Array.from(categories).sort();

  for (let i = 0; i < sorted.length; i++) {
    mapping[sorted[i]] = i;
  }

  return mapping;
}

/**
 * Create feature schema from resolved features
 */
export function createFeatureSchema(
  features: Record<string, unknown>,
  encodingStrategies: Record<string, 'label' | 'hash'> = {},
  imputationRules: Record<string, ImputationRule> = {}
): FeatureSchema {
  const featureNames = Object.keys(features);
  const encodedFeatures: EncodedFeature[] = [];

  for (let i = 0; i < featureNames.length; i++) {
    const name = featureNames[i];
    const value = features[name];
    const encoding = encodingStrategies[name];
    const imputation = imputationRules[name];

    const originalType = Array.isArray(value)
      ? 'array'
      : value === null
        ? 'null'
        : typeof value;

    encodedFeatures.push({
      name,
      index: i,
      originalType,
      encoding: encoding
        ? {
            type: encoding,
            mapping: encoding === 'label' ? buildCategoryMapping([]) : undefined,
          }
        : undefined,
      imputation,
    });
  }

  return {
    features: encodedFeatures,
    count: featureNames.length,
    order: featureNames,
  };
}

/**
 * Normalize feature vector from resolver outputs
 */
export function normalizeFeatureVector(
  features: Record<string, unknown>,
  schema: FeatureSchema,
  encodings: Record<string, CategoryEncoding | undefined>,
  imputations: Record<string, ImputationRule | undefined>
): number[] {
  const vector: number[] = new Array(schema.count);

  for (const encoded of schema.features) {
    const value = features[encoded.name];
    const encoding = encodings[encoded.name];
    const imputation = imputations[encoded.name];

    try {
      vector[encoded.index] = normalizeScalarValue(
        value,
        encoded.name,
        encoding,
        imputation
      );
    } catch (error) {
      throw new EncodingError('unknown-model', encoded.name, (error as Error).message);
    }
  }

  return vector;
}

/**
 * Validate feature vector length
 */
export function validateFeatureVector(
  vector: number[],
  expectedLength: number
): boolean {
  return vector.length === expectedLength && vector.every((v) => typeof v === 'number');
}
