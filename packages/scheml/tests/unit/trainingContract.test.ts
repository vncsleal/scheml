import { describe, expect, it } from 'vitest';
import {
  fitTrainingContract,
  inferFeatureType,
  splitTrainingRows,
  type TrainingRow,
} from '../../src/trainingContract';

describe('splitTrainingRows', () => {
  it('splits deterministically with a fixed seed', () => {
    const rows: TrainingRow[] = Array.from({ length: 10 }, (_, i) => ({
      features: { id: i },
      label: i,
    }));

    const a = splitTrainingRows(rows, 42, 0.2);
    const b = splitTrainingRows(rows, 42, 0.2);

    expect(a).toEqual(b);
    expect(a.testRows).toHaveLength(2);
    expect(a.trainRows).toHaveLength(8);
  });

  it('rejects datasets that are too small to split', () => {
    const rows: TrainingRow[] = [{ features: { id: 1 }, label: 1 }];

    expect(() => splitTrainingRows(rows, 42, 0.2)).toThrow(
      /At least 2 extracted rows are required/
    );
  });
});

describe('fitTrainingContract', () => {
  it('fits string categories from train rows only', () => {
    const trainRows: TrainingRow[] = [
      { features: { plan: 'free' }, label: 0 },
      { features: { plan: 'pro' }, label: 1 },
      { features: { plan: 'free' }, label: 0 },
    ];

    const contract = fitTrainingContract('churnRisk', ['plan'], trainRows);

    expect(contract.encodings.plan).toEqual({
      type: 'onehot',
      categories: ['free', 'pro'],
    });
    expect(contract.schema.count).toBe(2);
    expect(contract.schema.features[0].columnCount).toBe(2);
  });

  it('fits numeric scaling from train rows only', () => {
    const trainRows: TrainingRow[] = [
      { features: { score: 1 }, label: 0 },
      { features: { score: 3 }, label: 1 },
    ];

    const contract = fitTrainingContract('ltv', ['score'], trainRows);

    expect(contract.scalings.score).toEqual({
      strategy: 'standard',
      mean: 2,
      std: 1,
    });
    expect(contract.imputations.score).toEqual({
      strategy: 'constant',
      value: 2,
    });
  });

  it('rejects mixed feature types across extracted rows', () => {
    const allRows: TrainingRow[] = [
      { features: { plan: 'free' }, label: 0 },
      { features: { plan: 1 }, label: 1 },
    ];

    expect(() => fitTrainingContract('churnRisk', ['plan'], allRows, allRows)).toThrow(
      /Mixed feature types observed/
    );
  });

  it('rejects all-null extracted values for a feature', () => {
    const allRows: TrainingRow[] = [
      { features: { plan: null }, label: 0 },
      { features: { plan: undefined }, label: 1 },
    ];

    expect(() => fitTrainingContract('churnRisk', ['plan'], allRows, allRows)).toThrow(
      /cannot fit a training contract from all-null extracted values/
    );
  });

  it('preserves full-dataset nullability while fitting from train rows only', () => {
    const trainRows: TrainingRow[] = [
      { features: { plan: 'free' }, label: 0 },
      { features: { plan: 'pro' }, label: 1 },
    ];
    const allRows: TrainingRow[] = [
      ...trainRows,
      { features: { plan: null }, label: 0 },
    ];

    const contract = fitTrainingContract('churnRisk', ['plan'], trainRows, allRows);

    expect(contract.featureStats[0].hasNulls).toBe(true);
    expect(contract.encodings.plan).toEqual({
      type: 'onehot',
      categories: ['free', 'pro'],
    });
  });

  it('uses safe numeric defaults when train rows are null-only', () => {
    const trainRows: TrainingRow[] = [
      { features: { score: null }, label: 0 },
      { features: { score: undefined }, label: 1 },
    ];
    const allRows: TrainingRow[] = [
      ...trainRows,
      { features: { score: 5 }, label: 1 },
    ];

    const contract = fitTrainingContract('ltv', ['score'], trainRows, allRows);

    expect(contract.featureStats[0].type).toBe('number');
    expect(contract.imputations.score).toEqual({
      strategy: 'constant',
      value: 0,
    });
    expect(contract.scalings.score).toEqual({
      strategy: 'standard',
      mean: 0,
      std: 1,
    });
  });

  it('rejects string features with no observed train categories', () => {
    const trainRows: TrainingRow[] = [
      { features: { plan: null }, label: 0 },
      { features: { plan: undefined }, label: 1 },
    ];
    const allRows: TrainingRow[] = [
      ...trainRows,
      { features: { plan: 'pro' }, label: 1 },
    ];

    expect(() => fitTrainingContract('churnRisk', ['plan'], trainRows, allRows)).toThrow(
      /cannot fit onehot encoding from training data with no observed categories/
    );
  });
});

describe('inferFeatureType', () => {
  it('returns unknown for all-null inputs', () => {
    expect(inferFeatureType([null, undefined])).toBe('unknown');
  });
});
