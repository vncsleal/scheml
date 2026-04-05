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
  /** Root mean squared error, if applicable.
   * Also holds the computed value for MSE and MAE metrics — check the `metric`
   * field to determine which regression metric this value represents. */
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

/** Compute mean absolute error. */
function computeMAE(pairs: Pair[]): number {
  if (!pairs.length) return 0;
  const sum = pairs.reduce((acc, r) => acc + Math.abs(Number(r.actual) - Number(r.predicted)), 0);
  return sum / pairs.length;
}

/** Compute mean squared error. */
function computeMSE(pairs: Pair[]): number {
  if (!pairs.length) return 0;
  const sum = pairs.reduce((acc, r) => acc + (Number(r.actual) - Number(r.predicted)) ** 2, 0);
  return sum / pairs.length;
}

/** Compute R-squared (coefficient of determination). */
function computeR2(pairs: Pair[]): number {
  if (!pairs.length) return 0;
  const actualMean = pairs.reduce((s, r) => s + Number(r.actual), 0) / pairs.length;
  const ssTot = pairs.reduce((s, r) => s + (Number(r.actual) - actualMean) ** 2, 0);
  if (ssTot === 0) return 1;
  const ssRes = pairs.reduce((s, r) => s + (Number(r.actual) - Number(r.predicted)) ** 2, 0);
  return 1 - ssRes / ssTot;
}

/** Compute precision, recall, and F1 for binary classification (positive threshold: 0.5). */
function computePrecisionRecallF1(pairs: Pair[]): { precision: number; recall: number; f1: number } {
  let tp = 0, fp = 0, fn = 0;
  for (const r of pairs) {
    const actual = r.actual === true || r.actual === 1 || r.actual === '1';
    const predicted =
      typeof r.predicted === 'number'
        ? r.predicted >= 0.5
        : r.predicted === true || r.predicted === 1 || r.predicted === '1';
    if (actual && predicted) tp++;
    else if (!actual && predicted) fp++;
    else if (actual && !predicted) fn++;
  }
  const precision = tp + fp === 0 ? 0 : tp / (tp + fp);
  const recall = tp + fn === 0 ? 0 : tp / (tp + fn);
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
  return { precision, recall, f1 };
}

// ---------------------------------------------------------------------------
// Gate helpers
// ---------------------------------------------------------------------------

const SUPPORTED_METRICS = new Set([
  'accuracy', 'f1', 'precision', 'recall',
  'rmse', 'mse', 'mae', 'r2',
]);

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
  const relevantGate = gates.find((g) => SUPPORTED_METRICS.has(g.metric)) ?? null;

  if (!relevantGate) return null;

  let accuracy: number | undefined;
  let rmse: number | undefined;
  let metricValue: number;

  switch (relevantGate.metric) {
    case 'accuracy':
      accuracy = computeBinaryAccuracy(paired);
      metricValue = accuracy;
      break;
    case 'precision': {
      accuracy = computePrecisionRecallF1(paired).precision;
      metricValue = accuracy;
      break;
    }
    case 'recall': {
      accuracy = computePrecisionRecallF1(paired).recall;
      metricValue = accuracy;
      break;
    }
    case 'f1': {
      accuracy = computePrecisionRecallF1(paired).f1;
      metricValue = accuracy;
      break;
    }
    case 'rmse':
      rmse = computeRMSE(paired);
      metricValue = rmse;
      break;
    case 'mse':
      rmse = computeMSE(paired);
      metricValue = rmse;
      break;
    case 'mae':
      rmse = computeMAE(paired);
      metricValue = rmse;
      break;
    case 'r2':
      accuracy = computeR2(paired);
      metricValue = accuracy;
      break;
    default:
      return null;
  }

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
