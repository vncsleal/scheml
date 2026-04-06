import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { diffCommand } from '../../src/commands/diff';
import { appendHistoryRecord } from '../../src/history';

type DiffJsonOutput = {
  ok: boolean;
  trait: string;
  from: { artifactVersion: string } | null;
  to: { artifactVersion: string } | null;
  changes: Array<{ field: string; from: unknown; to: unknown }>;
};

function withCapturedStdout<T>(fn: () => Promise<T>): Promise<string> {
  let output = '';
  const origWrite = process.stdout.write.bind(process.stdout);
  const interceptWrite: typeof process.stdout.write = ((chunk: string | Uint8Array) => {
    output += chunk.toString();
    return true;
  }) as typeof process.stdout.write;
  process.stdout.write = interceptWrite;
  return fn().then(
    () => output,
    (error) => {
      throw error;
    }
  ).finally(() => {
    process.stdout.write = origWrite;
  });
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scheml-diff-'));
  fs.mkdirSync(path.join(tmpDir, 'history'), { recursive: true });
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function writeRecord(
  trait: string,
  overrides: Partial<Parameters<typeof appendHistoryRecord>[1]> = {}
) {
  appendHistoryRecord(tmpDir, {
    trait,
    model: 'User',
    adapter: 'prisma',
    schemaHash: 'abc123',
    definedAt: new Date().toISOString(),
    definedBy: 'human:test',
    artifactVersion: '1',
    status: 'trained',
    ...overrides,
  });
}

// ---------------------------------------------------------------------------
// diff --json
// ---------------------------------------------------------------------------

describe('diff command — JSON mode', () => {
  it('returns ok:true with null from/to when no history exists', async () => {
    const output = await withCapturedStdout(() => diffCommand.handler({ trait: 'churnRisk', output: tmpDir, json: true }));

    const parsed = JSON.parse(output.trim()) as DiffJsonOutput;
    expect(parsed.ok).toBe(true);
    expect(parsed.from).toBeNull();
    expect(parsed.to).toBeNull();
    expect(parsed.changes).toEqual([]);
  });

  it('from is null when only one record exists', async () => {
    writeRecord('churnRisk');

    const output = await withCapturedStdout(() => diffCommand.handler({ trait: 'churnRisk', output: tmpDir, json: true }));

    const parsed = JSON.parse(output.trim()) as DiffJsonOutput;
    expect(parsed.from).toBeNull();
    expect(parsed.to).not.toBeNull();
    expect(parsed.changes).toEqual([]);
  });

  it('detects schemaHash change between two records', async () => {
    writeRecord('churnRisk', { schemaHash: 'hash1', artifactVersion: '1', status: 'trained' });
    writeRecord('churnRisk', { schemaHash: 'hash2', artifactVersion: '2', status: 'drifted' });

    const output = await withCapturedStdout(() => diffCommand.handler({ trait: 'churnRisk', output: tmpDir, json: true }));

    const parsed = JSON.parse(output.trim()) as DiffJsonOutput;
    expect(parsed.ok).toBe(true);
    expect(parsed.from.artifactVersion).toBe('1');
    expect(parsed.to.artifactVersion).toBe('2');

    const schemaHashChange = parsed.changes.find((change) => change.field === 'schemaHash');
    expect(schemaHashChange).toBeDefined();
    expect(schemaHashChange.from).toBe('hash1');
    expect(schemaHashChange.to).toBe('hash2');

    const statusChange = parsed.changes.find((change) => change.field === 'status');
    expect(statusChange).toBeDefined();
    expect(statusChange.from).toBe('trained');
    expect(statusChange.to).toBe('drifted');
  });

  it('reports no changes when two records are identical on tracked fields', async () => {
    writeRecord('ltv', { schemaHash: 'same', artifactVersion: '1', status: 'trained' });
    writeRecord('ltv', { schemaHash: 'same', artifactVersion: '1', status: 'trained' });

    const output = await withCapturedStdout(() => diffCommand.handler({ trait: 'ltv', output: tmpDir, json: true }));

    const parsed = JSON.parse(output.trim()) as DiffJsonOutput;
    expect(parsed.changes).toHaveLength(0);
  });

  it('includes trait name in output', async () => {
    writeRecord('myTrait');

    const output = await withCapturedStdout(() => diffCommand.handler({ trait: 'myTrait', output: tmpDir, json: true }));

    const parsed = JSON.parse(output.trim()) as DiffJsonOutput;
    expect(parsed.trait).toBe('myTrait');
  });
});
