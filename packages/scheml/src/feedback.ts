/**
 * ScheML Feedback — accuracy decay detection from ground-truth observations.
 *
 * Users call `trait.record(id, { actual, predicted })` at runtime to persist
 * paired observations to `.scheml/feedback/<traitName>.jsonl`.
 *
 * `scheml check` calls `checkFeedbackDecay` for each trait artifact that has
 * `qualityGates` to detect whether the model's real-world accuracy has fallen
 * below the threshold it met at training time.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { QualityGate } from './types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FeedbackRecord {
  entityId: string | number;
  actual: unknown;
  /**
   * Optional: the model's prediction for this entity at the time the
   * observation was recorded. When present, enables paired accuracy
   * computation in `scheml check`.
   */
  predicted?: unknown;
  recordedAt: string;
}

export interface AccuracyDecayResult {
  /** Trait name this result belongs to */
  traitName: string;
  /** Total feedback records on disk (including unpaired) */
  sampleSize: number;
  /** Feedback records with both actual + predicted present */
  pairedCount: number;
  /** Binary classification accuracy (0–1), if applicable */
  accuracy?: number;
  /** Root mean squared error, if applicable */
  rmse?: number;
  /**
   * `true` when the computed metric fails to satisfy the quality gate
   * threshold that was enforced at training time.
   */
  belowThreshold: boolean;
  /** The quality gate threshold that was checked */
  threshold?: number;
  /** The quality gate metric name that was checked */
  metric?: string;
}

// ---------------------------------------------------------------------------
// I/O helpers
// ---------------------------------------------------------------------------

export function feedbackFilePath(outputDir: string, traitName: string): string {
  return path.join(outputDir, 'feedback', `${traitName}.jsonl`);
}

export function readFeedbackRecords(outputDir: string, traitName: string): FeedbackRecord[] {
  const filePath = feedbackFilePath(outputDir, traitName);
  if (!fs.existsSync(filePath)) return [];
  return fs
    .readFileSync(filePath, 'utf-8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as FeedbackRecord);
}

// ---------------------------------------------------------------------------
// Metric computation
// ---------------------------------------------------------------------------

type Pair = { actual: unknown; predicted: unknown };

/**
 * Compute binary classification accuracy.
 * Predictions >= 0.5 are treated as positive; boolean/1 actual values are positive.
 */
function computeBinaryAccuracy(pairs: Pair[]): number {
  if (!pairs.length) return 0;
  const correct = pairs.filter((r) => {
    const actualPositive = r.actual === true || r.actual === 1 || r.actual === '1';
    const predictedPositive =
      typeof r.predicted === 'number'
        ? r.predicted >= 0.5
        : r.predicted === true || r.predicted === 1 || r.predicted === '1';
    return actualPositive === predictedPositive;
  });
  return correct.length / pairs.length;
}

/** Compute root mean squared error. */
function computeRMSE(pairs: Pair[]): number {
  if (!pairs.length) return 0;
  const sumSq = pairs.reduce((acc, r) => acc + (Number(r.actual) - Number(r.predicted)) ** 2, 0);
  return Math.sqrt(sumSq / pairs.length);
}

// ---------------------------------------------------------------------------
// Gate helpers
// ---------------------------------------------------------------------------

const CLASSIFICATION_METRICS = new Set(['accuracy', 'f1', 'precision', 'recall', 'auc']);
const REGRESSION_METRICS = new Set(['rmse', 'mse', 'mae', 'r2']);

/**
 * Returns `true` when `value` satisfies the quality gate (i.e., the model
 * is still within acceptable range). Returns `false` when the gate fails.
 */
function gatePasses(gate: QualityGate, value: number): boolean {
  switch (gate.comparison) {
    case 'gte': return value >= gate.threshold;
    case 'lte': return value <= gate.threshold;
    default:    return true;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Minimum number of paired records required before emitting a decay warning.
 * Avoids false positives from tiny sample sizes.
 */
const MIN_PAIRED_SAMPLES = 5;

/**
 * Check whether feedback for a trait shows accuracy decay below the quality
 * gate threshold recorded at training time.
 *
 * Returns `null` when:
 * - No feedback file exists
 * - Not enough paired records (< MIN_PAIRED_SAMPLES)
 * - No relevant quality gate is present
 */
export function checkFeedbackDecay(
  outputDir: string,
  traitName: string,
  qualityGates?: QualityGate[]
): AccuracyDecayResult | null {
  const records = readFeedbackRecords(outputDir, traitName);
  if (!records.length) return null;

  const paired = records.filter((r) => r.predicted !== undefined) as Pair[];
  if (paired.length < MIN_PAIRED_SAMPLES) return null;

  const gates = qualityGates ?? [];
  const regressionGate = gates.find((g) => REGRESSION_METRICS.has(g.metric));
  const classificationGate = gates.find((g) => CLASSIFICATION_METRICS.has(g.metric));
  const relevantGate = regressionGate ?? classificationGate;

  if (!relevantGate) return null;

  const isRegression = !!regressionGate;
  const accuracy = isRegression ? undefined : computeBinaryAccuracy(paired);
  const rmse = isRegression ? computeRMSE(paired) : undefined;
  const metricValue = isRegression ? rmse! : accuracy!;
  const belowThreshold = !gatePasses(relevantGate, metricValue);

  return {
    traitName,
    sampleSize: records.length,
    pairedCount: paired.length,
    accuracy,
    rmse,
    belowThreshold,
    threshold: relevantGate.threshold,
    metric: relevantGate.metric,
  };
}
