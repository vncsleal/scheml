import { describe, expect, it } from 'vitest';
import { getMaterializedColumnName } from '../../src/materialization';

describe('getMaterializedColumnName', () => {
  it('uses the trait name for predictive traits even when output.field differs', () => {
    expect(
      getMaterializedColumnName({
        type: 'predictive',
        name: 'churnRisk',
        entity: 'User',
        target: 'churned',
        features: ['spend'],
        output: { field: 'predictedChurnRisk', taskType: 'binary_classification' },
      })
    ).toBe('churnRisk');
  });

  it('uses the trait name for anomaly traits', () => {
    expect(
      getMaterializedColumnName({
        type: 'anomaly',
        name: 'anomalyScore',
        entity: 'User',
        baseline: ['spend'],
        sensitivity: 'medium',
      })
    ).toBe('anomalyScore');
  });
});