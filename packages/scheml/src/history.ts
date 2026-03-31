/**
 * ScheML History — append-only JSONL audit trail for signal definitions,
 * training runs, and drift events.
 *
 * Each signal gets its own file at `.scheml/history/<signalName>.jsonl`.
 * Records are newline-delimited JSON, one object per line, append-only.
 * This makes the file safe to tail, diff, and commit to version control.
 */

import * as fs from 'fs';
import * as path from 'path';
import { spawnSync } from 'child_process';

// ---------------------------------------------------------------------------
// Record schema
// ---------------------------------------------------------------------------

export interface HistoryRecord {
  /** Signal (trait) name */
  signal: string;
  /** Entity/model name the signal was trained on */
  model: string;
  /** Adapter used at training time */
  adapter: string;
  /** Adapter-agnostic entity schema hash at training time */
  schemaHash: string;
  /** ISO-8601: when the history record was written */
  definedAt: string;
  /**
   * Who created this record.
   * Format: `"agent:<name>"` | `"human:<gituser>"` | `"unknown"`
   * Agents should set the `SCHEML_AUTHOR=agent:<name>` env var.
   */
  definedBy: string;
  /** ISO-8601: when the artifact was trained (omitted for 'defined' status) */
  trainedAt?: string;
  /**
   * Monotonically incrementing training version for this signal.
   * Starts at "1" and increments on each successful train.
   */
  artifactVersion: string;
  /**
   * Quality gate results at training time.
   * Key is the metric name, value is `{ threshold, result }`.
   */
  qualityGates?: Record<string, { threshold: number; result: number }>;
  status: 'defined' | 'trained' | 'drifted' | 'deprecated';
  /** ISO-8601: when drift was first detected */
  driftDetectedAt?: string;
  /** Field names that changed since the artifact was trained */
  driftFields?: string[];
}

// ---------------------------------------------------------------------------
// Author detection
// ---------------------------------------------------------------------------

/**
 * Detect who is running the current command.
 *
 * Priority:
 * 1. `SCHEML_AUTHOR` env var (agents should set `SCHEML_AUTHOR=agent:<name>`)
 * 2. `GITHUB_WORKFLOW` env var → `agent:<workflow>`
 * 3. `GITHUB_ACTOR` + `CI` env var → `human:<actor>`
 * 4. `git config user.name` → `human:<name>`
 * 5. `"unknown"`
 */
export function detectAuthor(): string {
  if (process.env.SCHEML_AUTHOR) {
    return process.env.SCHEML_AUTHOR;
  }
  if (process.env.GITHUB_WORKFLOW) {
    return `agent:${process.env.GITHUB_WORKFLOW}`;
  }
  if (process.env.GITHUB_ACTOR && process.env.CI) {
    return `human:${process.env.GITHUB_ACTOR}`;
  }
  try {
    const result = spawnSync('git', ['config', 'user.name'], { encoding: 'utf-8' });
    if (result.status === 0 && result.stdout.trim()) {
      return `human:${result.stdout.trim()}`;
    }
  } catch {
    // git not available — fall through
  }
  return 'unknown';
}

// ---------------------------------------------------------------------------
// File path helpers
// ---------------------------------------------------------------------------

export function historyDir(outputDir: string): string {
  return path.join(outputDir, 'history');
}

export function historyFilePath(outputDir: string, signalName: string): string {
  return path.join(outputDir, 'history', `${signalName}.jsonl`);
}

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

/**
 * Read all history records for a signal from disk.
 * Returns an empty array if the file does not exist.
 */
export function readHistoryRecords(outputDir: string, signalName: string): HistoryRecord[] {
  const filePath = historyFilePath(outputDir, signalName);
  if (!fs.existsSync(filePath)) return [];
  return fs
    .readFileSync(filePath, 'utf-8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as HistoryRecord);
}

/**
 * Read only the most recent history record for a signal.
 * Returns `null` if no history exists.
 */
export function readLatestHistoryRecord(
  outputDir: string,
  signalName: string
): HistoryRecord | null {
  const records = readHistoryRecords(outputDir, signalName);
  return records.length > 0 ? records[records.length - 1] : null;
}

// ---------------------------------------------------------------------------
// Write
// ---------------------------------------------------------------------------

/**
 * Append a history record to the signal's JSONL file.
 * Creates the `history/` directory if it does not exist.
 */
export function appendHistoryRecord(outputDir: string, record: HistoryRecord): void {
  const dir = historyDir(outputDir);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const filePath = historyFilePath(outputDir, record.signal);
  fs.appendFileSync(filePath, JSON.stringify(record) + '\n', 'utf-8');
}

// ---------------------------------------------------------------------------
// Version helpers
// ---------------------------------------------------------------------------

/**
 * Return the next artifact version string for a signal.
 * Counts existing 'trained' records and returns `String(count + 1)`.
 */
export function nextArtifactVersion(outputDir: string, signalName: string): string {
  const records = readHistoryRecords(outputDir, signalName);
  const trainedCount = records.filter((r) => r.status === 'trained').length;
  return String(trainedCount + 1);
}
