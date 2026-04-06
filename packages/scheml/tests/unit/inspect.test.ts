import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { inspectCommand } from '../../src/commands/inspect';
import { appendHistoryRecord } from '../../src/history';
import type { ArtifactMetadata } from '../../src/artifacts';

type InspectJsonOutput = {
  ok: boolean;
  trait: string;
  metadata: { traitName: string; traitType: string };
  history: { artifactVersion: string } | null;
  feedbackCount: number;
};

type WritableLike = typeof process.stdout.write;
type ExitLike = typeof process.exit;

function withCapturedStdout<T>(fn: () => Promise<T>): Promise<string> {
  let output = '';
  const origWrite = process.stdout.write.bind(process.stdout);
  const interceptWrite: WritableLike = ((chunk: string | Uint8Array) => {
    output += chunk.toString();
    return true;
  }) as WritableLike;
  process.stdout.write = interceptWrite;
  return fn().then(() => output).finally(() => {
    process.stdout.write = origWrite;
  });
}

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
  const meta: Record<string, unknown> = {
    version: '0.3.0',
    metadataSchemaVersion: '1.0.0',
    traitType: 'predictive',
    artifactFormat: 'onnx',
    traitName,
    schemaHash: 'abc123',
    compiledAt: '2025-01-01T00:00:00.000Z',
    entityName: 'User',
    bestEstimator: 'GradientBoostingClassifier',
    taskType: 'binary_classification',
    features: { monthlySpend: { type: 'numeric' } },
    output: { field: 'predictedChurn', shape: [1] },
    tensorSpec: { inputShape: [1, 1], outputShape: [1, 1] },
    featureDependencies: [],
    encoding: {},
    imputation: {},
    scaling: {},
    trainingMetrics: [{ split: 'test', accuracy: 0.85 }],
    dataset: { source: 'prisma', rows: 200, split: { train: 0.8, test: 0.2 } },
    onnxFile: `${traitName}.onnx`,
    ...overrides,
  };
  fs.writeFileSync(path.join(tmpDir, `${traitName}.metadata.json`), JSON.stringify(meta), 'utf-8');
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

    const output = await withCapturedStdout(() => inspectCommand.handler({ trait: 'churnRisk', output: tmpDir, json: true }));

    const parsed = JSON.parse(output.trim()) as InspectJsonOutput;
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
    console.error = (...args: unknown[]) => { output += args.map(String).join(' ') + '\n'; };

    let exitCode: number | undefined;
    const origExit = process.exit.bind(process);
    const interceptExit: ExitLike = ((code?: string | number | null) => {
      exitCode = typeof code === 'number' ? code : code == null ? undefined : Number(code);
      throw new Error('exit');
    }) as ExitLike;
    process.exit = interceptExit;

    try {
      await inspectCommand.handler({ trait: 'missingTrait', output: tmpDir, json: true });
    } catch {
      // expected exit
    } finally {
      console.error = origError;
      process.exit = origExit;
    }

    expect(exitCode).toBe(1);
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

    const output = await withCapturedStdout(() => inspectCommand.handler({ trait: 'ltv', output: tmpDir, json: true }));

    const parsed = JSON.parse(output.trim()) as InspectJsonOutput;
    expect(parsed.feedbackCount).toBe(3);
  });
});
