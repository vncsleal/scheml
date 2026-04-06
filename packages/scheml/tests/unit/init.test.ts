import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { initCommand } from '../../src/commands/init';

type LogArgs = unknown[];

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scheml-init-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// init --json
// ---------------------------------------------------------------------------

describe('init command — JSON mode', () => {
  it('creates scheml.config.ts and .scheml/ on a fresh directory', async () => {
    let output = '';
    const origLog = console.log;
    console.log = (...args: LogArgs) => { output += args.map(String).join(' ') + '\n'; };
    try {
      await initCommand.handler({ adapter: 'prisma', output: tmpDir, json: true });
    } finally {
      console.log = origLog;
    }

    const parsed = JSON.parse(output.trim());
    expect(parsed.ok).toBe(true);
    expect(parsed.created.some((f: string) => f.endsWith('scheml.config.ts'))).toBe(true);
    expect(parsed.created.some((f: string) => f.endsWith('.scheml/'))).toBe(true);
    expect(parsed.skipped).toHaveLength(0);
  });

  it('writes a valid scheml.config.ts with defineTrait and defineConfig', async () => {
    const origLog = console.log;
    console.log = () => {};
    try {
      await initCommand.handler({ adapter: 'prisma', output: tmpDir, json: true });
    } finally {
      console.log = origLog;
    }

    const configPath = path.join(tmpDir, 'scheml.config.ts');
    expect(fs.existsSync(configPath)).toBe(true);
    const content = fs.readFileSync(configPath, 'utf-8');
    expect(content).toContain('defineTrait');
    expect(content).toContain('defineConfig');
    expect(content).toContain('@vncsleal/scheml');
  });

  it('creates .scheml/ directory', async () => {
    const origLog = console.log;
    console.log = () => {};
    try {
      await initCommand.handler({ adapter: 'prisma', output: tmpDir, json: true });
    } finally {
      console.log = origLog;
    }

    expect(fs.existsSync(path.join(tmpDir, '.scheml'))).toBe(true);
    expect(fs.statSync(path.join(tmpDir, '.scheml')).isDirectory()).toBe(true);
  });

  it('reports skipped when config already exists (idempotent)', async () => {
    // Create config first
    fs.writeFileSync(path.join(tmpDir, 'scheml.config.ts'), '// existing', 'utf-8');

    let output = '';
    const origLog = console.log;
    console.log = (...args: LogArgs) => { output += args.map(String).join(' ') + '\n'; };
    try {
      await initCommand.handler({ adapter: 'prisma', output: tmpDir, json: true });
    } finally {
      console.log = origLog;
    }

    const parsed = JSON.parse(output.trim());
    expect(parsed.ok).toBe(true);
    expect(parsed.skipped.some((f: string) => f.endsWith('scheml.config.ts'))).toBe(true);
    // Existing content should be preserved
    expect(fs.readFileSync(path.join(tmpDir, 'scheml.config.ts'), 'utf-8')).toBe('// existing');
  });

  it('includes adapter name in generated config', async () => {
    const origLog = console.log;
    console.log = () => {};
    try {
      await initCommand.handler({ adapter: 'drizzle', output: tmpDir, json: true });
    } finally {
      console.log = origLog;
    }

    const content = fs.readFileSync(path.join(tmpDir, 'scheml.config.ts'), 'utf-8');
    expect(content).toContain("'drizzle'");
  });
});
