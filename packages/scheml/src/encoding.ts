/**
 * Feature Encoding & Normalization
 * Convert resolver outputs to deterministic numeric feature vectors
 */

import {
  CategoryEncoding,
  ImputationRule,
  EncodedFeature,
  FeatureSchema,
  ScalingSpec,
} from './types';
import {
  EncodingError,
  UnseenCategoryError,
} from './errors';

/**
 * Encode a single feature value to a number or number[] (for onehot).
 * Internal helper used by normalizeFeatureVector.
 */
function encodeValue(
  value: unknown,
  featureName: string,
  encoding?: CategoryEncoding,
  imputation?: ImputationRule,
  scaling?: ScalingSpec
): number | number[] {
  // Handle null/undefined
  if (value === null || value === undefined) {
    if (imputation) {
      const imputed = applyImputation(imputation);
      return encodeValue(imputed, featureName, encoding, undefined, scaling);
    }
    throw new Error(`${featureName}: null value without imputation rule`);
  }

  // Handle numeric
  if (typeof value === 'number') {
    if (!isFinite(value)) {
      throw new Error(`${featureName}: non-finite number`);
    }
    return scaling ? applyScaling(value, scaling) : value;
  }

  // Handle boolean — booleans are never scaled
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

  // Handle Date — convert to seconds since epoch, then optionally scale
  if (value instanceof Date) {
    const epoch = value.getTime() / 1000;
    return scaling ? applyScaling(epoch, scaling) : epoch;
  }

  throw new Error(`${featureName}: unsupported scalar type ${typeof value}`);
}

/**
 * Normalize a scalar value to a single numeric feature.
 * Does not support onehot encoding — use normalizeFeatureVector for full pipeline.
 */
export function normalizeScalarValue(
  value: unknown,
  featureName: string,
  encoding?: CategoryEncoding,
  imputation?: ImputationRule
): number {
  const result = encodeValue(value, featureName, encoding, imputation);
  if (Array.isArray(result)) {
    throw new Error(
      `${featureName}: onehot encoding returns multiple values; use normalizeFeatureVector instead`
    );
  }
  return result;
}

/**
 * FNV-1a 32-bit hash — fast, zero-dependency, collision-resistant non-cryptographic hash.
 */
function fnv1a32(str: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}

/**
 * Encode a categorical value using label, hash, or onehot encoding.
 * Returns a single number for label/hash, or number[] for onehot.
 */
function encodeCategoryValue(
  value: string,
  featureName: string,
  encoding: CategoryEncoding
): number | number[] {
  if (encoding.type === 'label') {
    if (!encoding.mapping) {
      throw new Error(`${featureName}: label encoding missing mapping`);
    }
    const code = encoding.mapping[value];
    if (code === undefined) {
      throw new UnseenCategoryError('unknown-model', featureName, value);
    }
    return code;
  }

  if (encoding.type === 'hash') {
    return fnv1a32(value) % 1000;
  }

  if (encoding.type === 'onehot') {
    const cats = encoding.categories;
    if (!cats || cats.length === 0) {
      throw new Error(`${featureName}: onehot encoding missing categories list`);
    }
    // Unseen category → all-zeros vector (safe degradation at inference time)
    return cats.map((cat) => (cat === value ? 1 : 0));
  }

  throw new Error(`${featureName}: unknown encoding type ${(encoding as any).type}`);
}

/**
 * Apply standard scaling to a numeric value.
 */
export function applyScaling(value: number, spec: ScalingSpec): number {
  if (spec.strategy === 'standard' && spec.mean !== undefined && spec.std !== undefined) {
    return (value - spec.mean) / spec.std;
  }
  return value;
}

/**
 * Apply imputation strategy
 */
function applyImputation(rule: ImputationRule): number | string | boolean {
  switch (rule.strategy) {
    case 'constant':
      if (rule.value === undefined) {
        throw new Error('Constant imputation requires a value');
      }
      return rule.value;
    case 'mean':
    case 'median':
    case 'mode':
      // These strategies are resolved to a numeric constant at training time
      // and stored in metadata as { strategy: 'constant', value: <computed> }.
      // A runtime imputation rule with strategy 'mean'/'median'/'mode' and no
      // precomputed value indicates a corrupt or hand-crafted metadata file.
      if (typeof rule.value === 'number') {
        return rule.value;
      }
      throw new Error(
        `Imputation strategy '${rule.strategy}' requires a precomputed numeric value in metadata`
      );
    default:
      throw new Error(`Unknown imputation strategy: ${rule.strategy}`);
  }
}

/**
 * Build label encoding mapping from training data values.
 */
export function buildCategoryMapping(
  values: (string | null | undefined)[]
): Record<string, number> {
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
 * Extract sorted unique categories from training data for onehot encoding.
 */
export function buildCategories(values: (string | null | undefined)[]): string[] {
  const categories = new Set<string>();
  for (const val of values) {
    if (val !== null && val !== undefined) {
      categories.add(val);
    }
  }
  return Array.from(categories).sort();
}

/**
 * Create feature schema from resolved features.
 * @deprecated Prefer constructing FeatureSchema directly in train.ts with full stat context.
 */
export function createFeatureSchema(
  features: Record<string, unknown>,
  imputationRules: Record<string, ImputationRule> = {}
): FeatureSchema {
  const featureNames = Object.keys(features);
  const encodedFeatures: EncodedFeature[] = [];
  let colIndex = 0;

  for (const name of featureNames) {
    const value = features[name];
    const imputation = imputationRules[name];
    const originalType = Array.isArray(value)
      ? 'array'
      : value === null
        ? 'null'
        : typeof value;

    encodedFeatures.push({
      name,
      index: colIndex,
      columnCount: 1,
      originalType,
      imputation,
    });
    colIndex++;
  }

  return {
    features: encodedFeatures,
    count: colIndex,
    order: featureNames,
  };
}

/**
 * Normalize feature vector from resolver outputs.
 * Handles onehot expansion (string features expand to one column per category)
 * and optional standard scaling for numeric features.
 */
export function normalizeFeatureVector(
  features: Record<string, unknown>,
  schema: FeatureSchema,
  encodings: Record<string, CategoryEncoding | undefined>,
  imputations: Record<string, ImputationRule | undefined>,
  scalings?: Record<string, ScalingSpec | undefined>
): number[] {
  const vector: number[] = [];

  for (const encoded of schema.features) {
    const value = features[encoded.name];
    const encoding = encodings[encoded.name];
    const imputation = imputations[encoded.name];
    const scaling = scalings?.[encoded.name];

    try {
      const result = encodeValue(value, encoded.name, encoding, imputation, scaling);
      if (Array.isArray(result)) {
        vector.push(...result);
      } else {
        vector.push(result);
      }
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
