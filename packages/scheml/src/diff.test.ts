import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { diffCommand } from './commands/diff';
import { appendHistoryRecord } from './history';

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
    let output = '';
    const origLog = console.log;
    console.log = (...args: any[]) => { output += args.join(' ') + '\n'; };
    try {
      await diffCommand.handler({ trait: 'churnRisk', output: tmpDir, json: true });
    } finally {
      console.log = origLog;
    }

    const parsed = JSON.parse(output.trim());
    expect(parsed.ok).toBe(true);
    expect(parsed.from).toBeNull();
    expect(parsed.to).toBeNull();
    expect(parsed.changes).toEqual([]);
  });

  it('from is null when only one record exists', async () => {
    writeRecord('churnRisk');

    let output = '';
    const origLog = console.log;
    console.log = (...args: any[]) => { output += args.join(' ') + '\n'; };
    try {
      await diffCommand.handler({ trait: 'churnRisk', output: tmpDir, json: true });
    } finally {
      console.log = origLog;
    }

    const parsed = JSON.parse(output.trim());
    expect(parsed.from).toBeNull();
    expect(parsed.to).not.toBeNull();
    expect(parsed.changes).toEqual([]);
  });

  it('detects schemaHash change between two records', async () => {
    writeRecord('churnRisk', { schemaHash: 'hash1', artifactVersion: '1', status: 'trained' });
    writeRecord('churnRisk', { schemaHash: 'hash2', artifactVersion: '2', status: 'drifted' });

    let output = '';
    const origLog = console.log;
    console.log = (...args: any[]) => { output += args.join(' ') + '\n'; };
    try {
      await diffCommand.handler({ trait: 'churnRisk', output: tmpDir, json: true });
    } finally {
      console.log = origLog;
    }

    const parsed = JSON.parse(output.trim());
    expect(parsed.ok).toBe(true);
    expect(parsed.from.artifactVersion).toBe('1');
    expect(parsed.to.artifactVersion).toBe('2');

    const schemaHashChange = parsed.changes.find((c: any) => c.field === 'schemaHash');
    expect(schemaHashChange).toBeDefined();
    expect(schemaHashChange.from).toBe('hash1');
    expect(schemaHashChange.to).toBe('hash2');

    const statusChange = parsed.changes.find((c: any) => c.field === 'status');
    expect(statusChange).toBeDefined();
    expect(statusChange.from).toBe('trained');
    expect(statusChange.to).toBe('drifted');
  });

  it('reports no changes when two records are identical on tracked fields', async () => {
    writeRecord('ltv', { schemaHash: 'same', artifactVersion: '1', status: 'trained' });
    writeRecord('ltv', { schemaHash: 'same', artifactVersion: '1', status: 'trained' });

    let output = '';
    const origLog = console.log;
    console.log = (...args: any[]) => { output += args.join(' ') + '\n'; };
    try {
      await diffCommand.handler({ trait: 'ltv', output: tmpDir, json: true });
    } finally {
      console.log = origLog;
    }

    const parsed = JSON.parse(output.trim());
    expect(parsed.changes).toHaveLength(0);
  });

  it('includes trait name in output', async () => {
    writeRecord('myTrait');

    let output = '';
    const origLog = console.log;
    console.log = (...args: any[]) => { output += args.join(' ') + '\n'; };
    try {
      await diffCommand.handler({ trait: 'myTrait', output: tmpDir, json: true });
    } finally {
      console.log = origLog;
    }

    const parsed = JSON.parse(output.trim());
    expect(parsed.trait).toBe('myTrait');
  });
});
