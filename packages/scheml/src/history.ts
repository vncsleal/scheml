/**
 * ScheML History — append-only JSONL audit trail for trait definitions,
 * training runs, and drift events.
 *
 * Each trait gets its own file at `.scheml/history/<traitName>.jsonl`.
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
  /** Trait name */
  trait: string;
  /** Entity/model name the trait was trained on */
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
  * Monotonically incrementing training version for this trait.
   * Starts at "1" and increments on each successful train.
   */
  artifactVersion: string;
  /**
   * Quality gate results at training time.
   * Key is the metric name, value is `{ threshold, result }`.
   */
  qualityGates?: Record<string, { threshold: number; result: number }>;
  status: 'defined' | 'trained' | 'drifted' | 'deprecated' | 'materialized';
  /** ISO-8601: when drift was first detected */
  driftDetectedAt?: string;
  /** Field names that changed since the artifact was trained */
  driftFields?: string[];
  /** ISO-8601: when the artifact was explicitly deprecated */
  deprecatedAt?: string;
  /** Human-readable reason supplied when deprecating */
  deprecationReason?: string;
}

// ---------------------------------------------------------------------------
// Lifecycle state machine
// ---------------------------------------------------------------------------

export type HistoryStatus = HistoryRecord['status'];

/**
 * Valid artifact lifecycle transitions.
 *
 * Based on MLflow / BentoML conventions:
 * - `defined`     — trait registered, no artifact yet
 * - `trained`     — artifact exists and is current
 * - `drifted`     — schema changed since training; retraining needed
 * - `materialized`— batch inference written to DB column
 * - `deprecated`  — explicitly retired; no further transitions allowed
 *
 * The `deprecated` state is terminal — matching MLflow's `Archived` stage.
 * SemVer policy: deprecated in minor release, removed in next major.
 */
export const VALID_TRANSITIONS: Readonly<Record<HistoryStatus, readonly HistoryStatus[]>> = {
  defined: ['trained', 'deprecated'],
  trained: ['trained', 'drifted', 'materialized', 'deprecated'],
  drifted: ['trained', 'deprecated'],
  materialized: ['materialized', 'trained', 'deprecated'],
  deprecated: [], // terminal — no further transitions
};

/**
 * Assert that a status transition is valid.
 * Throws a descriptive error if the transition is not in `VALID_TRANSITIONS`.
 */
export function validateStatusTransition(from: HistoryStatus, to: HistoryStatus): void {
  const allowed = VALID_TRANSITIONS[from];
  if (!(allowed as readonly string[]).includes(to)) {
    throw new Error(
      `Invalid artifact lifecycle transition: '${from}' → '${to}'. ` +
        `Valid transitions from '${from}': ${allowed.length ? allowed.join(', ') : '(none — status is terminal).'}`
    );
  }
}

/**
 * Append a history record with transition validation.
 * - If a previous record exists, the `from` state is validated against `VALID_TRANSITIONS`.
 * - If no previous record exists, any status is accepted (initial write).
 */
export function transitionStatus(
  outputDir: string,
  record: HistoryRecord
): void {
  const latest = readLatestHistoryRecord(outputDir, record.trait);
  if (latest) {
    validateStatusTransition(latest.status, record.status);
  }
  appendHistoryRecord(outputDir, record);
}

/**
 * Mark an artifact as deprecated.
 * Writes a `deprecated` history record, preventing further training on this trait
 * without an explicit `scheml train` which resets the lifecycle.
 *
 * @param outputDir  - Path to the `.scheml/` output directory.
 * @param traitName  - Trait to deprecate.
 * @param reason     - Human-readable reason (stored in history for audit trail).
 */
export function deprecateArtifact(
  outputDir: string,
  traitName: string,
  reason?: string
): void {
  const latest = readLatestHistoryRecord(outputDir, traitName);
  if (!latest) {
    throw new Error(`No history found for trait '${traitName}'. Cannot deprecate.`);
  }
  transitionStatus(outputDir, {
    ...latest,
    status: 'deprecated',
    definedAt: new Date().toISOString(),
    deprecatedAt: new Date().toISOString(),
    ...(reason ? { deprecationReason: reason } : {}),
  });
}

// ---------------------------------------------------------------------------
// Author detection
// ---------------------------------------------------------------------------

/**
 * Detect who is running the current command.
 *
 * CI-agnostic: checks `SCHEML_AUTHOR` first (universal override), then
 * provider-specific vars in priority order, then falls back to git config.
 *
 * Priority:
 * 1. `SCHEML_AUTHOR` env var — universal override; agents set `SCHEML_AUTHOR=agent:<name>`
 * 2. GitHub Actions — `GITHUB_WORKFLOW` (automation) / `GITHUB_ACTOR` (human)
 * 3. GitLab CI — `CI_PIPELINE_NAME` or `GITLAB_USER_NAME`
 * 4. CircleCI — `CIRCLE_JOB` (automation) / `CIRCLE_USERNAME` (human)
 * 5. Buildkite — `BUILDKITE_PIPELINE_NAME` (automation) / `BUILDKITE_BUILD_CREATOR` (human)
 * 6. Generic CI — `CI` env var present (Jenkins, Azure Pipelines, TeamCity, etc.)
 * 7. `git config user.name` — local human developer
 * 8. `"unknown"`
 */
export function detectAuthor(): string {
  const sanitize = (v: string) => v.replace(/[\r\n"]/g, '').slice(0, 200) || 'unknown';

  // 1. Universal override — CI-agnostic; highest priority.
  if (process.env.SCHEML_AUTHOR) {
    return sanitize(process.env.SCHEML_AUTHOR);
  }

  // 2. GitHub Actions
  if (process.env.GITHUB_WORKFLOW) {
    return `agent:${sanitize(process.env.GITHUB_WORKFLOW)}`;
  }
  if (process.env.GITHUB_ACTOR && process.env.CI) {
    return `human:${sanitize(process.env.GITHUB_ACTOR)}`;
  }

  // 3. GitLab CI
  if (process.env.GITLAB_CI) {
    if (process.env.GITLAB_USER_NAME) {
      return `human:${sanitize(process.env.GITLAB_USER_NAME)}`;
    }
    const pipelineName = process.env.CI_PIPELINE_NAME ?? process.env.CI_JOB_NAME ?? 'gitlab';
    return `agent:${sanitize(pipelineName)}`;
  }

  // 4. CircleCI
  if (process.env.CIRCLECI) {
    if (process.env.CIRCLE_USERNAME) {
      return `human:${sanitize(process.env.CIRCLE_USERNAME)}`;
    }
    return `agent:${sanitize(process.env.CIRCLE_JOB ?? 'circleci')}`;
  }

  // 5. Buildkite
  if (process.env.BUILDKITE) {
    if (process.env.BUILDKITE_BUILD_CREATOR) {
      return `human:${sanitize(process.env.BUILDKITE_BUILD_CREATOR)}`;
    }
    return `agent:${sanitize(process.env.BUILDKITE_PIPELINE_NAME ?? 'buildkite')}`;
  }

  // 6. Generic CI (Jenkins, Azure Pipelines, TeamCity, Drone, etc.)
  if (process.env.CI) {
    return 'agent:ci';
  }

  // 7. Local developer — git config
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

export function historyFilePath(outputDir: string, traitName: string): string {
  return path.join(outputDir, 'history', `${traitName}.jsonl`);
}

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

/**
 * Read all history records for a trait from disk.
 * Returns an empty array if the file does not exist.
 */
export function readHistoryRecords(outputDir: string, traitName: string): HistoryRecord[] {
  const filePath = historyFilePath(outputDir, traitName);
  if (!fs.existsSync(filePath)) return [];
  return fs
    .readFileSync(filePath, 'utf-8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as HistoryRecord);
}

/**
 * Read only the most recent history record for a trait.
 * Returns `null` if no history exists.
 */
export function readLatestHistoryRecord(
  outputDir: string,
  traitName: string
): HistoryRecord | null {
  const records = readHistoryRecords(outputDir, traitName);
  return records.length > 0 ? records[records.length - 1] : null;
}

// ---------------------------------------------------------------------------
// Write
// ---------------------------------------------------------------------------

/**
 * Append a history record to the trait's JSONL file.
 * Creates the `history/` directory if it does not exist.
 */
export function appendHistoryRecord(outputDir: string, record: HistoryRecord): void {
  const dir = historyDir(outputDir);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const filePath = historyFilePath(outputDir, record.trait);
  fs.appendFileSync(filePath, JSON.stringify(record) + '\n', 'utf-8');
}

// ---------------------------------------------------------------------------
// Version helpers
// ---------------------------------------------------------------------------

/**
 * Return the next artifact version string for a trait.
 * Counts existing 'trained' records and returns `String(count + 1)`.
 */
export function nextArtifactVersion(outputDir: string, traitName: string): string {
  const records = readHistoryRecords(outputDir, traitName);
  const trainedCount = records.filter((r) => r.status === 'trained').length;
  return String(trainedCount + 1);
}
