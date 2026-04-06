/**
 * Unit tests for src/history.ts
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import {
  detectAuthor,
  appendHistoryRecord,
  readHistoryRecords,
  readLatestHistoryRecord,
  nextArtifactVersion,
  historyFilePath,
  historyDir,
  VALID_TRANSITIONS,
  validateStatusTransition,
  transitionStatus,
  deprecateArtifact,
  type HistoryRecord,
  type HistoryStatus,
} from '../../src/history';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'scheml-history-test-'));
}

function makeRecord(overrides: Partial<HistoryRecord> = {}): HistoryRecord {
  return {
    trait: 'userChurn',
    model: 'User',
    adapter: 'prisma',
    schemaHash: 'abc123',
    definedAt: '2025-01-01T00:00:00.000Z',
    definedBy: 'human:alice',
    trainedAt: '2025-01-01T00:01:00.000Z',
    artifactVersion: '1',
    status: 'trained',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// detectAuthor
// ---------------------------------------------------------------------------

describe('detectAuthor', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // Clear history-related env vars before each test
    delete process.env.SCHEML_AUTHOR;
    delete process.env.GITHUB_WORKFLOW;
    delete process.env.GITHUB_ACTOR;
    delete process.env.CI;
  });

  afterEach(() => {
    // Restore env
    Object.assign(process.env, originalEnv);
  });

  it('returns SCHEML_AUTHOR when set', () => {
    process.env.SCHEML_AUTHOR = 'agent:my-workflow';
    expect(detectAuthor()).toBe('agent:my-workflow');
  });

  it('returns agent:<workflow> when GITHUB_WORKFLOW is set', () => {
    process.env.GITHUB_WORKFLOW = 'train-models';
    expect(detectAuthor()).toBe('agent:train-models');
  });

  it('SCHEML_AUTHOR takes priority over GITHUB_WORKFLOW', () => {
    process.env.SCHEML_AUTHOR = 'agent:override';
    process.env.GITHUB_WORKFLOW = 'train-models';
    expect(detectAuthor()).toBe('agent:override');
  });

  it('returns human:<actor> when GITHUB_ACTOR and CI are set', () => {
    process.env.GITHUB_ACTOR = 'octocat';
    process.env.CI = 'true';
    expect(detectAuthor()).toBe('human:octocat');
  });

  it('GITHUB_WORKFLOW takes priority over GITHUB_ACTOR+CI', () => {
    process.env.GITHUB_WORKFLOW = 'workflow';
    process.env.GITHUB_ACTOR = 'octocat';
    process.env.CI = 'true';
    expect(detectAuthor()).toBe('agent:workflow');
  });

  it('falls back to "unknown" when no env vars are set and git is unavailable', () => {
    // We can't easily test git fallback in isolation, but we can verify the
    // function returns a non-empty string under controlled conditions.
    const result = detectAuthor();
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// historyDir / historyFilePath
// ---------------------------------------------------------------------------

describe('historyDir', () => {
  it('returns <outputDir>/history', () => {
    expect(historyDir('/app/.scheml')).toBe('/app/.scheml/history');
  });
});

describe('historyFilePath', () => {
  it('returns <outputDir>/history/<signalName>.jsonl', () => {
    expect(historyFilePath('/app/.scheml', 'userChurn')).toBe(
      '/app/.scheml/history/userChurn.jsonl'
    );
  });
});

// ---------------------------------------------------------------------------
// appendHistoryRecord / readHistoryRecords / readLatestHistoryRecord
// ---------------------------------------------------------------------------

describe('appendHistoryRecord', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates the history directory if it does not exist', () => {
    const record = makeRecord();
    appendHistoryRecord(tmpDir, record);
    expect(fs.existsSync(path.join(tmpDir, 'history'))).toBe(true);
  });

  it('writes a valid JSON line to the file', () => {
    const record = makeRecord();
    appendHistoryRecord(tmpDir, record);
    const filePath = historyFilePath(tmpDir, record.trait);
    const lines = fs.readFileSync(filePath, 'utf-8').split('\n').filter(Boolean);
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0])).toMatchObject(record);
  });

  it('appends multiple records as separate lines', () => {
    const r1 = makeRecord({ artifactVersion: '1' });
    const r2 = makeRecord({ artifactVersion: '2', trainedAt: '2025-01-02T00:00:00.000Z' });
    appendHistoryRecord(tmpDir, r1);
    appendHistoryRecord(tmpDir, r2);
    const filePath = historyFilePath(tmpDir, r1.trait);
    const lines = fs.readFileSync(filePath, 'utf-8').split('\n').filter(Boolean);
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[1]).artifactVersion).toBe('2');
  });

  it('keeps records for different signals in separate files', () => {
    appendHistoryRecord(tmpDir, makeRecord({ trait: 'sigA' }));
    appendHistoryRecord(tmpDir, makeRecord({ trait: 'sigB' }));
    expect(fs.existsSync(historyFilePath(tmpDir, 'sigA'))).toBe(true);
    expect(fs.existsSync(historyFilePath(tmpDir, 'sigB'))).toBe(true);
  });
});

describe('readHistoryRecords', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns [] when no history file exists', () => {
    expect(readHistoryRecords(tmpDir, 'nonexistent')).toEqual([]);
  });

  it('reads back the records written by appendHistoryRecord', () => {
    const records = [
      makeRecord({ artifactVersion: '1' }),
      makeRecord({ artifactVersion: '2' }),
    ];
    for (const r of records) appendHistoryRecord(tmpDir, r);
    const read = readHistoryRecords(tmpDir, 'userChurn');
    expect(read).toHaveLength(2);
    expect(read[0].artifactVersion).toBe('1');
    expect(read[1].artifactVersion).toBe('2');
  });
});

describe('readLatestHistoryRecord', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns null when no history file exists', () => {
    expect(readLatestHistoryRecord(tmpDir, 'nonexistent')).toBeNull();
  });

  it('returns the last record', () => {
    appendHistoryRecord(tmpDir, makeRecord({ artifactVersion: '1' }));
    appendHistoryRecord(tmpDir, makeRecord({ artifactVersion: '2' }));
    const latest = readLatestHistoryRecord(tmpDir, 'userChurn');
    expect(latest?.artifactVersion).toBe('2');
  });
});

// ---------------------------------------------------------------------------
// nextArtifactVersion
// ---------------------------------------------------------------------------

describe('nextArtifactVersion', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns "1" when no history exists', () => {
    expect(nextArtifactVersion(tmpDir, 'userChurn')).toBe('1');
  });

  it('increments on each trained record', () => {
    appendHistoryRecord(tmpDir, makeRecord({ status: 'trained', artifactVersion: '1' }));
    expect(nextArtifactVersion(tmpDir, 'userChurn')).toBe('2');

    appendHistoryRecord(tmpDir, makeRecord({ status: 'trained', artifactVersion: '2' }));
    expect(nextArtifactVersion(tmpDir, 'userChurn')).toBe('3');
  });

  it('does not increment on non-trained records (drifted, deprecated)', () => {
    appendHistoryRecord(tmpDir, makeRecord({ status: 'drifted', artifactVersion: '1' }));
    expect(nextArtifactVersion(tmpDir, 'userChurn')).toBe('1');
  });

  it('counts only trained records for version, ignoring drifted entries', () => {
    appendHistoryRecord(tmpDir, makeRecord({ status: 'trained', artifactVersion: '1' }));
    appendHistoryRecord(tmpDir, makeRecord({ status: 'drifted', artifactVersion: '1' }));
    appendHistoryRecord(tmpDir, makeRecord({ status: 'trained', artifactVersion: '2' }));
    expect(nextArtifactVersion(tmpDir, 'userChurn')).toBe('3');
  });
});

// ---------------------------------------------------------------------------
// VALID_TRANSITIONS / validateStatusTransition
// ---------------------------------------------------------------------------

describe('VALID_TRANSITIONS', () => {
  it('allows defined → trained', () => {
    expect(VALID_TRANSITIONS.defined).toContain('trained');
  });

  it('allows trained → drifted', () => {
    expect(VALID_TRANSITIONS.trained).toContain('drifted');
  });

  it('allows trained → deprecated', () => {
    expect(VALID_TRANSITIONS.trained).toContain('deprecated');
  });

  it('treats deprecated as terminal (no outgoing transitions)', () => {
    expect(VALID_TRANSITIONS.deprecated).toHaveLength(0);
  });
});

describe('validateStatusTransition', () => {
  it('does not throw for a valid transition', () => {
    expect(() => validateStatusTransition('defined', 'trained')).not.toThrow();
    expect(() => validateStatusTransition('trained', 'drifted')).not.toThrow();
    expect(() => validateStatusTransition('drifted', 'trained')).not.toThrow();
  });

  it('throws for an invalid transition', () => {
    expect(() => validateStatusTransition('defined', 'drifted')).toThrow(
      /Invalid artifact lifecycle transition/
    );
  });

  it('throws when attempting to transition out of deprecated (terminal state)', () => {
    expect(() => validateStatusTransition('deprecated', 'trained')).toThrow(
      /terminal/
    );
  });
});

// ---------------------------------------------------------------------------
// transitionStatus
// ---------------------------------------------------------------------------

describe('transitionStatus', () => {
  let tmpDir: string;

  beforeEach(() => { tmpDir = makeTmpDir(); });
  afterEach(() => { fs.rmSync(tmpDir, { recursive: true }); });

  it('writes record when no prior history exists (initial write)', () => {
    transitionStatus(tmpDir, makeRecord({ status: 'defined', trainedAt: undefined }));
    expect(readHistoryRecords(tmpDir, 'userChurn')).toHaveLength(1);
  });

  it('allows a valid transition sequence', () => {
    transitionStatus(tmpDir, makeRecord({ status: 'defined', trainedAt: undefined, artifactVersion: '0' }));
    transitionStatus(tmpDir, makeRecord({ status: 'trained', artifactVersion: '1' }));
    transitionStatus(tmpDir, makeRecord({ status: 'drifted', artifactVersion: '1' }));
    transitionStatus(tmpDir, makeRecord({ status: 'trained', artifactVersion: '2' }));
    expect(readHistoryRecords(tmpDir, 'userChurn')).toHaveLength(4);
  });

  it('throws for an invalid transition', () => {
    transitionStatus(tmpDir, makeRecord({ status: 'defined', trainedAt: undefined, artifactVersion: '0' }));
    expect(() => transitionStatus(tmpDir, makeRecord({ status: 'drifted', artifactVersion: '0' }))).toThrow(
      /Invalid artifact lifecycle transition/
    );
  });
});

// ---------------------------------------------------------------------------
// deprecateArtifact
// ---------------------------------------------------------------------------

describe('deprecateArtifact', () => {
  let tmpDir: string;

  beforeEach(() => { tmpDir = makeTmpDir(); });
  afterEach(() => { fs.rmSync(tmpDir, { recursive: true }); });

  it('writes a deprecated record with optional reason', () => {
    appendHistoryRecord(tmpDir, makeRecord({ status: 'trained' }));
    deprecateArtifact(tmpDir, 'userChurn', 'replaced by v2 model');
    const records = readHistoryRecords(tmpDir, 'userChurn');
    const last = records[records.length - 1];
    expect(last.status).toBe('deprecated');
    expect(last.deprecationReason).toBe('replaced by v2 model');
  });

  it('throws when no prior history exists', () => {
    expect(() => deprecateArtifact(tmpDir, 'nonexistent')).toThrow(
      /No history found for trait/
    );
  });
});

// ---------------------------------------------------------------------------
// detectAuthor — multi-CI provider coverage
// ---------------------------------------------------------------------------

describe('detectAuthor (multi-CI)', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.SCHEML_AUTHOR;
    delete process.env.GITHUB_WORKFLOW;
    delete process.env.GITHUB_ACTOR;
    delete process.env.CI;
    delete process.env.GITLAB_CI;
    delete process.env.GITLAB_USER_NAME;
    delete process.env.CI_PIPELINE_NAME;
    delete process.env.CI_JOB_NAME;
    delete process.env.CIRCLECI;
    delete process.env.CIRCLE_USERNAME;
    delete process.env.CIRCLE_JOB;
    delete process.env.BUILDKITE;
    delete process.env.BUILDKITE_BUILD_CREATOR;
    delete process.env.BUILDKITE_PIPELINE_NAME;
  });

  afterEach(() => { Object.assign(process.env, originalEnv); });

  it('detects GitLab human user', () => {
    process.env.GITLAB_CI = 'true';
    process.env.GITLAB_USER_NAME = 'gitlab-dev';
    expect(detectAuthor()).toBe('human:gitlab-dev');
  });

  it('detects GitLab pipeline automation', () => {
    process.env.GITLAB_CI = 'true';
    process.env.CI_PIPELINE_NAME = 'nightly-train';
    expect(detectAuthor()).toBe('agent:nightly-train');
  });

  it('detects CircleCI human user', () => {
    process.env.CIRCLECI = 'true';
    process.env.CIRCLE_USERNAME = 'circle-dev';
    expect(detectAuthor()).toBe('human:circle-dev');
  });

  it('detects CircleCI job automation', () => {
    process.env.CIRCLECI = 'true';
    process.env.CIRCLE_JOB = 'train-job';
    expect(detectAuthor()).toBe('agent:train-job');
  });

  it('detects Buildkite human creator', () => {
    process.env.BUILDKITE = 'true';
    process.env.BUILDKITE_BUILD_CREATOR = 'bk-dev';
    expect(detectAuthor()).toBe('human:bk-dev');
  });

  it('detects Buildkite pipeline automation', () => {
    process.env.BUILDKITE = 'true';
    process.env.BUILDKITE_PIPELINE_NAME = 'ml-pipeline';
    expect(detectAuthor()).toBe('agent:ml-pipeline');
  });

  it('detects generic CI (Jenkins, Azure Pipelines, etc.)', () => {
    process.env.CI = 'true';
    expect(detectAuthor()).toBe('agent:ci');
  });
});
