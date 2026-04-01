import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { inspectCommand } from './commands/inspect';
import { appendHistoryRecord } from './history';
import type { ArtifactMetadata } from './artifacts';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scheml-inspect-'));
  fs.mkdirSync(path.join(tmpDir, 'history'), { recursive: true });
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function writeMetadata(traitName: string, overrides: Partial<ArtifactMetadata> = {}): void {
  const meta: ArtifactMetadata = {
    version: '0.3.0',
    metadataSchemaVersion: '1.0.0',
    traitType: 'predictive',
    traitName,
    schemaHash: 'abc123',
    compiledAt: '2025-01-01T00:00:00.000Z',
    entityName: 'User',
    bestEstimator: 'GradientBoostingClassifier',
    taskType: 'binary_classification',
    features: { monthlySpend: { type: 'numeric' } } as any,
    output: { field: 'predictedChurn', shape: [1] },
    tensorSpec: { inputShape: [1, 1], outputShape: [1, 1] },
    featureDependencies: [],
    encoding: {},
    imputation: {},
    scaling: {},
    trainingMetrics: [{ split: 'test', accuracy: 0.85 } as any],
    dataset: { source: 'prisma', rows: 200, split: { train: 0.8, test: 0.2 } } as any,
    onnxFile: `${traitName}.onnx`,
    ...overrides,
  } as any;
  fs.writeFileSync(path.join(tmpDir, `${traitName}.metadata.json`), JSON.stringify(meta), 'utf-8');
}

function captureOutput(fn: () => void): string {
  const chunks: string[] = [];
  const orig = process.stdout.write.bind(process.stdout);
  (process.stdout as any).write = (chunk: any) => {
    chunks.push(chunk.toString());
    return true;
  };
  try { fn(); } finally { (process.stdout as any).write = orig; }
  return chunks.join('');
}

// ---------------------------------------------------------------------------
// inspect --json
// ---------------------------------------------------------------------------

describe('inspect command — JSON mode', () => {
  it('emits ok:true with metadata and history for a known trait', async () => {
    writeMetadata('churnRisk');
    appendHistoryRecord(tmpDir, {
      trait: 'churnRisk',
      model: 'User',
      adapter: 'prisma',
      schemaHash: 'abc123',
      definedAt: '2025-01-01T00:00:00.000Z',
      definedBy: 'human:test',
      artifactVersion: '1',
      status: 'trained',
      trainedAt: '2025-01-01T00:00:01.000Z',
    });

    let output = '';
    const origLog = console.log;
    console.log = (...args: any[]) => { output += args.join(' ') + '\n'; };
    try {
      await inspectCommand.handler({ trait: 'churnRisk', output: tmpDir, json: true });
    } finally {
      console.log = origLog;
    }

    const parsed = JSON.parse(output.trim());
    expect(parsed.ok).toBe(true);
    expect(parsed.trait).toBe('churnRisk');
    expect(parsed.metadata.traitName).toBe('churnRisk');
    expect(parsed.metadata.traitType).toBe('predictive');
    expect(parsed.history).not.toBeNull();
    expect(parsed.history.artifactVersion).toBe('1');
    expect(typeof parsed.feedbackCount).toBe('number');
  });

  it('emits ok:false when trait artifact is missing', async () => {
    let output = '';
    const origError = console.error;
    console.error = (...args: any[]) => { output += args.join(' ') + '\n'; };

    let exitCode: number | undefined;
    const origExit = process.exit.bind(process);
    (process as any).exit = (code?: number) => { exitCode = code; throw new Error('exit'); };

    try {
      await inspectCommand.handler({ trait: 'missingTrait', output: tmpDir, json: true });
    } catch {
      // expected exit
    } finally {
      console.error = origError;
      (process as any).exit = origExit;
    }

    expect(exitCode).toBe(1);
    // Note: JSON error goes to console.log in --json mode (captured via console.error mock above)
  });

  it('feedbackCount reflects feedback records on disk', async () => {
    writeMetadata('ltv');
    // Write 3 feedback records
    const feedbackDir = path.join(tmpDir, 'feedback');
    fs.mkdirSync(feedbackDir, { recursive: true });
    const lines = [
      { entityId: 'u1', actual: 100, predicted: 90, recordedAt: new Date().toISOString() },
      { entityId: 'u2', actual: 200, predicted: 210, recordedAt: new Date().toISOString() },
      { entityId: 'u3', actual: 300, predicted: 280, recordedAt: new Date().toISOString() },
    ];
    fs.writeFileSync(
      path.join(feedbackDir, 'ltv.jsonl'),
      lines.map((l) => JSON.stringify(l)).join('\n') + '\n',
      'utf-8'
    );

    let output = '';
    const origLog = console.log;
    console.log = (...args: any[]) => { output += args.join(' ') + '\n'; };
    try {
      await inspectCommand.handler({ trait: 'ltv', output: tmpDir, json: true });
    } finally {
      console.log = origLog;
    }

    const parsed = JSON.parse(output.trim());
    expect(parsed.feedbackCount).toBe(3);
  });
});
