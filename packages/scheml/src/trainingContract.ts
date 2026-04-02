import {
  CategoryEncoding,
  FeatureSchema,
  ImputationRule,
  ScalingSpec,
} from './types';
import { ConfigurationError } from './errors';

export type TrainingFeatureType = 'number' | 'boolean' | 'string' | 'date' | 'unknown';

export type TrainingRow = {
  features: Record<string, unknown>;
  label: number | string | boolean;
};

type FeatureStats = {
  name: string;
  type: TrainingFeatureType;
  hasNulls: boolean;
  encoding?: CategoryEncoding;
  imputation?: ImputationRule;
  scaling?: ScalingSpec;
};

export type FittedTrainingContract = {
  schema: FeatureSchema;
  featureStats: FeatureStats[];
  encodings: Record<string, CategoryEncoding | undefined>;
  imputations: Record<string, ImputationRule | undefined>;
  scalings: Record<string, ScalingSpec | undefined>;
};

function valueType(value: unknown): Exclude<TrainingFeatureType, 'unknown'> | 'nullish' {
  if (value === null || value === undefined) {
    return 'nullish';
  }
  if (value instanceof Date) {
    return 'date';
  }
  if (typeof value === 'number') {
    return 'number';
  }
  if (typeof value === 'boolean') {
    return 'boolean';
  }
  if (typeof value === 'string') {
    return 'string';
  }
  throw new ConfigurationError(`Unsupported feature value type "${typeof value}"`);
}

export function inferFeatureType(values: unknown[]): TrainingFeatureType {
  const observed = new Set(
    values
      .map(valueType)
      .filter((type): type is Exclude<TrainingFeatureType, 'unknown'> => type !== 'nullish')
  );

  if (observed.size === 0) {
    return 'unknown';
  }

  if (observed.size > 1) {
    throw new ConfigurationError(
      `Mixed feature types observed (${Array.from(observed).join(', ')})`
    );
  }

  return Array.from(observed)[0];
}

function computeStringMode(values: unknown[]): string | undefined {
  const counts = new Map<string, number>();
  for (const value of values) {
    if (typeof value === 'string') {
      counts.set(value, (counts.get(value) || 0) + 1);
    }
  }
  let best: string | undefined;
  let bestCount = -1;
  for (const [key, count] of counts.entries()) {
    if (count > bestCount) {
      best = key;
      bestCount = count;
    }
  }
  return best;
}

function computeBooleanMode(values: unknown[]): boolean | undefined {
  let trueCount = 0;
  let falseCount = 0;
  for (const value of values) {
    if (typeof value === 'boolean') {
      value ? trueCount++ : falseCount++;
    }
  }
  if (trueCount === 0 && falseCount === 0) {
    return undefined;
  }
  return trueCount >= falseCount;
}

function buildFeatureSchema(stats: FeatureStats[]): FeatureSchema {
  let colIndex = 0;
  const features = stats.map((stat) => {
    const columnCount =
      stat.encoding?.type === 'onehot' && stat.encoding.categories
        ? stat.encoding.categories.length
        : 1;

    const feature = {
      name: stat.name,
      index: colIndex,
      columnCount,
      originalType: stat.type,
      encoding: stat.encoding,
      imputation: stat.imputation,
      scaling: stat.scaling,
    };

    colIndex += columnCount;
    return feature;
  });

  return {
    features,
    count: colIndex,
    order: stats.map((stat) => stat.name),
  };
}

export function seededShuffle<T>(items: T[], seed: number): T[] {
  const result = items.slice();
  let state = seed >>> 0;
  for (let i = result.length - 1; i > 0; i--) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    const j = state % (i + 1);
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

export function splitTrainingRows(
  rows: TrainingRow[],
  seed: number,
  testFraction: number
): { trainRows: TrainingRow[]; testRows: TrainingRow[] } {
  if (rows.length < 2) {
    throw new ConfigurationError('At least 2 extracted rows are required to create a train/test split');
  }

  const indices = seededShuffle([...Array(rows.length).keys()], seed);
  const testSize = Math.min(rows.length - 1, Math.max(1, Math.floor(rows.length * testFraction)));
  const testIndices = new Set(indices.slice(0, testSize));

  const trainRows: TrainingRow[] = [];
  const testRows: TrainingRow[] = [];

  indices.forEach((idx) => {
    if (testIndices.has(idx)) {
      testRows.push(rows[idx]);
    } else {
      trainRows.push(rows[idx]);
    }
  });

  return { trainRows, testRows };
}

export function fitTrainingContract(
  modelName: string,
  featureNames: string[],
  trainRows: TrainingRow[],
  allRows: TrainingRow[] = trainRows
): FittedTrainingContract {
  const stats: FeatureStats[] = featureNames.map((name) => {
    const trainValues = trainRows.map((row) => row.features[name]);
    const allValues = allRows.map((row) => row.features[name]);
    const observedAcrossDataset = inferFeatureType(allValues);

    if (observedAcrossDataset === 'unknown') {
      throw new ConfigurationError(
        `Model "${modelName}", feature "${name}": cannot fit a training contract from all-null extracted values`
      );
    }

    const observedInTrain = inferFeatureType(trainValues);
    const type =
      observedInTrain === 'unknown' ? observedAcrossDataset : observedInTrain;
    const hasNulls = allValues.some((value) => value === null || value === undefined);
    const stat: FeatureStats = { name, type, hasNulls };

    if (type === 'string') {
      const categories = Array.from(
        new Set(trainValues.filter((value): value is string => typeof value === 'string'))
      ).sort();
      if (categories.length === 0) {
        throw new ConfigurationError(
          `Model "${modelName}", feature "${name}": cannot fit onehot encoding from training data with no observed categories`
        );
      }
      stat.encoding = { type: 'onehot', categories };
      const mode = computeStringMode(trainValues);
      if (mode !== undefined) {
        stat.imputation = { strategy: 'constant', value: mode };
      }
    }

    if (type === 'number') {
      const nums = trainValues.filter((value): value is number => typeof value === 'number');
      if (nums.length > 0) {
        const mean = nums.reduce((acc, value) => acc + value, 0) / nums.length;
        const variance = nums.reduce((acc, value) => acc + (value - mean) ** 2, 0) / nums.length;
        const std = Math.sqrt(variance) || 1;
        stat.imputation = { strategy: 'constant', value: mean };
        stat.scaling = { strategy: 'standard', mean, std };
      } else {
        stat.imputation = { strategy: 'constant', value: 0 };
        stat.scaling = { strategy: 'standard', mean: 0, std: 1 };
      }
    }

    if (type === 'boolean') {
      const mode = computeBooleanMode(trainValues);
      if (mode !== undefined) {
        stat.imputation = { strategy: 'constant', value: mode ? 1 : 0 };
      } else {
        stat.imputation = { strategy: 'constant', value: 0 };
      }
    }

    return stat;
  });

  const encodings: Record<string, CategoryEncoding | undefined> = {};
  const imputations: Record<string, ImputationRule | undefined> = {};
  const scalings: Record<string, ScalingSpec | undefined> = {};

  for (const stat of stats) {
    encodings[stat.name] = stat.encoding;
    imputations[stat.name] = stat.imputation;
    scalings[stat.name] = stat.scaling;
  }

  return {
    schema: buildFeatureSchema(stats),
    featureStats: stats,
    encodings,
    imputations,
    scalings,
  };
}
