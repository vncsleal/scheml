import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  feedbackDir,
  feedbackFilePath,
  readFeedbackRecords,
  checkFeedbackDecay,
  type FeedbackRecord,
} from '../../src/feedback';
import type { QualityGate } from '../../src/types';

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scheml-feedback-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function writeFeedbackRecords(traitName: string, records: Omit<FeedbackRecord, 'recordedAt'>[]): void {
  const dir = feedbackDir(tmpDir);
  fs.mkdirSync(dir, { recursive: true });
  const lines = records.map((r) => JSON.stringify({ ...r, recordedAt: new Date().toISOString() }));
  fs.writeFileSync(feedbackFilePath(tmpDir, traitName), lines.join('\n') + '\n', 'utf-8');
}

// ---------------------------------------------------------------------------
// feedbackFilePath
// ---------------------------------------------------------------------------

describe('feedbackFilePath', () => {
  it('returns path under feedback/ subdirectory', () => {
    const p = feedbackFilePath('/project/.scheml', 'churnRisk');
    expect(p).toBe(path.join('/project/.scheml', 'feedback', 'churnRisk.jsonl'));
  });

  it('normalizes unsafe trait names before building the path', () => {
    const p = feedbackFilePath('/project/.scheml', '../churn risk');
    expect(p).toBe(path.join('/project/.scheml', 'feedback', 'churn_risk.jsonl'));
  });
});

// ---------------------------------------------------------------------------
// readFeedbackRecords
// ---------------------------------------------------------------------------

describe('readFeedbackRecords', () => {
  it('returns empty array when file does not exist', () => {
    expect(readFeedbackRecords(tmpDir, 'nope')).toEqual([]);
  });

  it('reads and parses all JSONL records', () => {
    writeFeedbackRecords('churnRisk', [
      { entityId: 'u1', actual: true, predicted: 0.9 },
      { entityId: 'u2', actual: false, predicted: 0.2 },
    ]);
    const records = readFeedbackRecords(tmpDir, 'churnRisk');
    expect(records).toHaveLength(2);
    expect(records[0].entityId).toBe('u1');
    expect(records[0].actual).toBe(true);
    expect(records[0].predicted).toBe(0.9);
  });

  it('handles records without predicted field', () => {
    writeFeedbackRecords('ltv', [
      { entityId: 'u1', actual: 42 },
    ]);
    const records = readFeedbackRecords(tmpDir, 'ltv');
    expect(records[0].predicted).toBeUndefined();
  });

  it('reads records back through the normalized feedback path', () => {
    writeFeedbackRecords('../churn risk', [
      { entityId: 'u1', actual: true, predicted: 0.9 },
    ]);

    const records = readFeedbackRecords(tmpDir, '../churn risk');
    expect(records).toHaveLength(1);
    expect(records[0].entityId).toBe('u1');
  });
});

// ---------------------------------------------------------------------------
// checkFeedbackDecay
// ---------------------------------------------------------------------------

describe('checkFeedbackDecay', () => {
  it('returns null when no feedback file exists', () => {
    expect(checkFeedbackDecay(tmpDir, 'missing')).toBeNull();
  });

  it('returns null when fewer than 5 paired records', () => {
    writeFeedbackRecords('churnRisk', [
      { entityId: 'u1', actual: true, predicted: 0.9 },
      { entityId: 'u2', actual: false, predicted: 0.1 },
    ]);
    const gates: QualityGate[] = [{ metric: 'accuracy', threshold: 0.85, comparison: 'gte' }];
    expect(checkFeedbackDecay(tmpDir, 'churnRisk', gates)).toBeNull();
  });

  it('returns null when no relevant quality gate provided', () => {
    writeFeedbackRecords('churnRisk', Array.from({ length: 10 }, (_, i) => ({
      entityId: `u${i}`,
      actual: true,
      predicted: 0.9,
    })));
    expect(checkFeedbackDecay(tmpDir, 'churnRisk', [])).toBeNull();
  });

  it('detects accuracy above threshold → belowThreshold = false', () => {
    const records = Array.from({ length: 10 }, (_, i) => ({
      entityId: `u${i}`,
      actual: i < 9, // 9 positive, 1 negative
      predicted: i < 9 ? 0.9 : 0.1, // perfect predictions
    }));
    writeFeedbackRecords('churnRisk', records);

    const gates: QualityGate[] = [{ metric: 'accuracy', threshold: 0.85, comparison: 'gte' }];
    const result = checkFeedbackDecay(tmpDir, 'churnRisk', gates);

    expect(result).not.toBeNull();
    expect(result!.belowThreshold).toBe(false);
    expect(result!.accuracy).toBeCloseTo(1.0, 2);
    expect(result!.pairedCount).toBe(10);
    expect(result!.metric).toBe('accuracy');
    expect(result!.threshold).toBe(0.85);
  });

  it('detects accuracy below threshold → belowThreshold = true', () => {
    const records = Array.from({ length: 10 }, (_, i) => ({
      entityId: `u${i}`,
      actual: true,
      predicted: i < 5 ? 0.9 : 0.1, // 5/10 correct = 0.5 accuracy
    }));
    writeFeedbackRecords('churnRisk', records);

    const gates: QualityGate[] = [{ metric: 'f1', threshold: 0.85, comparison: 'gte' }];
    const result = checkFeedbackDecay(tmpDir, 'churnRisk', gates);

    expect(result).not.toBeNull();
    expect(result!.belowThreshold).toBe(true);
    expect(result!.accuracy).toBeDefined();
    expect(result!.accuracy).toBeLessThan(0.85);
  });

  it('computes RMSE for regression gates', () => {
    const records = Array.from({ length: 10 }, (_, i) => ({
      entityId: `u${i}`,
      actual: i * 100,
      predicted: i * 100 + 10, // constant +10 error → RMSE = 10
    }));
    writeFeedbackRecords('ltv', records);

    const gates: QualityGate[] = [{ metric: 'rmse', threshold: 50, comparison: 'lte' }];
    const result = checkFeedbackDecay(tmpDir, 'ltv', gates);

    expect(result).not.toBeNull();
    expect(result!.rmse).toBeCloseTo(10, 1);
    expect(result!.belowThreshold).toBe(false); // 10 <= 50, gate passes
    expect(result!.metric).toBe('rmse');
  });

  it('flags RMSE exceeding threshold as belowThreshold = true', () => {
    const records = Array.from({ length: 10 }, (_, i) => ({
      entityId: `u${i}`,
      actual: 0,
      predicted: 200, // RMSE = 200
    }));
    writeFeedbackRecords('ltv', records);

    const gates: QualityGate[] = [{ metric: 'rmse', threshold: 50, comparison: 'lte' }];
    const result = checkFeedbackDecay(tmpDir, 'ltv', gates);

    expect(result).not.toBeNull();
    expect(result!.rmse).toBeCloseTo(200, 0);
    expect(result!.belowThreshold).toBe(true);
  });

  it('reports sampleSize including unpaired records', () => {
    writeFeedbackRecords('churnRisk', [
      ...Array.from({ length: 10 }, (_, i) => ({
        entityId: `u${i}`,
        actual: true,
        predicted: 0.9,
      })),
      { entityId: 'u10', actual: true }, // unpaired
      { entityId: 'u11', actual: false }, // unpaired
    ]);

    const gates: QualityGate[] = [{ metric: 'accuracy', threshold: 0.5, comparison: 'gte' }];
    const result = checkFeedbackDecay(tmpDir, 'churnRisk', gates);

    expect(result!.sampleSize).toBe(12);
    expect(result!.pairedCount).toBe(10);
  });
});
