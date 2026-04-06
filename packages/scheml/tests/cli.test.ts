import { beforeAll, describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createTempProject } from './support/project';

const PACKAGE_ROOT = path.resolve(__dirname, '..');
const CLI = path.join(PACKAGE_ROOT, 'dist', 'bin.js');

function run(args: string[], cwd: string) {
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, NODE_ENV: 'test' },
    timeout: 10_000,
  });
}

describe('scheml CLI integration', () => {
  beforeAll(() => {
    const result = spawnSync('pnpm', ['build'], {
      cwd: PACKAGE_ROOT,
      encoding: 'utf8',
      env: { ...process.env, NODE_ENV: 'test' },
      timeout: 30_000,
    });

    expect(result.status).toBe(0);
  });

  it('check succeeds with default paths in a generated project', async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'scheml-cli-check-'));
    try {
      await createTempProject(tempRoot);
      const { status } = run(['check'], tempRoot);
      expect(status).toBe(0);
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('check --json returns ok:false when schema drift is present', async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'scheml-cli-drift-'));
    try {
      await createTempProject(tempRoot);
      const driftedSchema = path.join(tempRoot, 'prisma', 'schema.drift.prisma');
      const currentSchema = fs.readFileSync(path.join(tempRoot, 'prisma', 'schema.prisma'), 'utf-8');
      fs.writeFileSync(driftedSchema, currentSchema.replace('  recentMaxViews   Float\n', ''), 'utf-8');

      const { status, stdout } = run(['check', '--schema', driftedSchema, '--json'], tempRoot);
      const payload = JSON.parse(stdout.trim());

      expect(status).not.toBe(0);
      expect(payload.ok).toBe(false);
      expect(payload.drift).toHaveLength(1);
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('status --json lists a predictive artifact', async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'scheml-cli-status-'));
    try {
      await createTempProject(tempRoot);
      const { status, stdout } = run(['status', '--json'], tempRoot);
      const payload = JSON.parse(stdout.trim());

      expect(status).toBe(0);
      expect(payload.summary.total).toBe(1);
      expect(payload.traits[0]).toMatchObject({ trait: 'productSales', kind: 'predictive' });
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('inspect --json returns metadata for a predictive artifact', async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'scheml-cli-inspect-'));
    try {
      await createTempProject(tempRoot);
      const { status, stdout } = run(['inspect', 'productSales', '--json'], tempRoot);
      const payload = JSON.parse(stdout.trim());

      expect(status).toBe(0);
      expect(payload.ok).toBe(true);
      expect(payload.metadata.traitName).toBe('productSales');
      expect(payload.metadata.schemaHash).toMatch(/^[a-f0-9]{64}$/);
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('diff --json compares the latest history records', async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'scheml-cli-diff-'));
    try {
      await createTempProject(tempRoot);
      const historyPath = path.join(tempRoot, '.scheml', 'history', 'productSales.jsonl');
      fs.appendFileSync(
        historyPath,
        JSON.stringify({
          trait: 'productSales',
          model: 'Product',
          adapter: 'prisma',
          schemaHash: 'drifted-hash',
          definedAt: '2026-04-06T00:10:00.000Z',
          definedBy: 'agent:copilot',
          trainedAt: '2026-04-06T00:12:00.000Z',
          artifactVersion: '2',
          status: 'trained',
        }) + '\n',
        'utf-8'
      );

      const { status, stdout } = run(['diff', 'productSales', '--json'], tempRoot);
      const payload = JSON.parse(stdout.trim());

      expect(status).toBe(0);
      expect(payload.ok).toBe(true);
      expect(payload.changes.some((change: { field: string }) => change.field === 'schemaHash')).toBe(true);
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('audit --json summarizes history totals', async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'scheml-cli-audit-'));
    try {
      await createTempProject(tempRoot);
      const { status, stdout } = run(['audit', '--json'], tempRoot);
      const payload = JSON.parse(stdout.trim());

      expect(status).toBe(0);
      expect(payload.ok).toBe(true);
      expect(payload.traitCount).toBe(1);
      expect(payload.totals.trained).toBeGreaterThanOrEqual(1);
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('migrate --json writes to the default migrations directory beside the schema', async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'scheml-cli-migrate-'));
    try {
      await createTempProject(tempRoot);
      const schemaPath = path.join(tempRoot, 'prisma', 'schema.prisma');
      const schema = fs.readFileSync(schemaPath, 'utf-8');
      fs.writeFileSync(schemaPath, schema.replace('  predictedSales   Float?\n', ''), 'utf-8');

      const { status, stdout } = run(['migrate', '--json'], tempRoot);
      const payload = JSON.parse(stdout.trim());

      expect(status).toBe(0);
      expect(payload.ok).toBe(true);
      expect(payload.adapter).toBe('prisma');
      expect(payload.dialect).toBe('sqlite');
      expect(payload.written).toBe(true);
      expect(payload.migrationsDir).toContain(path.join('prisma', 'migrations'));
      expect(payload.migrationPath).toContain(path.join('prisma', 'migrations'));
      expect(fs.existsSync(payload.migrationPath)).toBe(true);
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('init --json scaffolds a config and artifacts directory', () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'scheml-cli-init-'));
    try {
      const { status, stdout } = run(['init', '--output', tempRoot, '--json'], PACKAGE_ROOT);
      const payload = JSON.parse(stdout.trim());

      expect(status).toBe(0);
      expect(payload.ok).toBe(true);
      expect(fs.existsSync(path.join(tempRoot, 'scheml.config.ts'))).toBe(true);
      expect(fs.existsSync(path.join(tempRoot, '.scheml'))).toBe(true);
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});