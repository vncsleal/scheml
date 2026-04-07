import { describe, expect, it } from 'vitest';
import { ConfigurationError, QualityGateError } from '../../src/errors';
import { evaluateQualityGates } from '../../src/commands/train';
import { requireGenerativeProvider } from '../../src/generativeProvider';

describe('evaluateQualityGates', () => {
  it('returns gate results when all configured gates pass', () => {
    const results = evaluateQualityGates(
      'churnRisk',
      [
        { metric: 'f1', threshold: 0.8, comparison: 'gte' },
        { metric: 'precision', threshold: 0.75, comparison: 'gte' },
      ],
      [
        { metric: 'precision', value: 0.82, split: 'test' },
        { metric: 'f1', value: 0.84, split: 'test' },
      ],
    );

    expect(results).toEqual({
      f1: { threshold: 0.8, result: 0.84 },
      precision: { threshold: 0.75, result: 0.82 },
    });
  });

  it('prefers test-split metrics when multiple splits are present', () => {
    const results = evaluateQualityGates(
      'ltv',
      [{ metric: 'rmse', threshold: 0.5, comparison: 'lte' }],
      [
        { metric: 'rmse', value: 0.2, split: 'train' },
        { metric: 'rmse', value: 0.4, split: 'test' },
      ],
    );

    expect(results).toEqual({
      rmse: { threshold: 0.5, result: 0.4 },
    });
  });

  it('throws QualityGateError when a gate fails', () => {
    expect(() =>
      evaluateQualityGates(
        'churnRisk',
        [{ metric: 'f1', threshold: 0.9, comparison: 'gte' }],
        [{ metric: 'f1', value: 0.61, split: 'test' }],
      )
    ).toThrow(QualityGateError);
  });

  it('throws ConfigurationError when no metrics are available', () => {
    expect(() =>
      evaluateQualityGates(
        'churnRisk',
        [{ metric: 'f1', threshold: 0.9, comparison: 'gte' }],
        [],
      )
    ).toThrow(ConfigurationError);
  });

  it('throws ConfigurationError when a required metric is missing', () => {
    expect(() =>
      evaluateQualityGates(
        'churnRisk',
        [{ metric: 'recall', threshold: 0.9, comparison: 'gte' }],
        [{ metric: 'f1', value: 0.91, split: 'test' }],
      )
    ).toThrow(ConfigurationError);
  });
});

describe('requireGenerativeProvider', () => {
  it('returns the configured provider when present', () => {
    const provider = { model: 'gpt-4.1-mini' };

    expect(requireGenerativeProvider('retentionMessage', provider)).toBe(provider);
  });

  it('prefers the explicit runtime override', () => {
    const configured = { model: 'configured' };
    const override = { model: 'override' };

    expect(requireGenerativeProvider('retentionMessage', configured, override)).toBe(override);
  });

  it('throws ConfigurationError when no provider is configured', () => {
    expect(() => requireGenerativeProvider('retentionMessage')).toThrow(ConfigurationError);
  });
});