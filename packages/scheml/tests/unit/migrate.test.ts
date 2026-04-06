import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { migrateCommand } from '../../src/commands/migrate';

const PACKAGE_SRC_ENTRY = path.resolve(__dirname, '../../src/index');

function captureStdout(): { output: () => string; restore: () => void } {
  let buffer = '';
  const originalWrite = process.stdout.write.bind(process.stdout);

  process.stdout.write = ((chunk: string | Uint8Array) => {
    buffer += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf-8');
    return true;
  }) as typeof process.stdout.write;

  return {
    output: () => buffer,
    restore: () => {
      process.stdout.write = originalWrite;
    },
  };
}

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scheml-migrate-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('migrate command', () => {
  it('supports adapter instances without a schema path when migrations-dir is provided', async () => {
    const configPath = path.join(tmpDir, 'scheml.config.ts');
    const migrationsDir = path.join(tmpDir, 'migrations');
    fs.writeFileSync(
      configPath,
      `import { defineConfig, defineTrait } from ${JSON.stringify(PACKAGE_SRC_ENTRY)};

const customAdapter = {
  name: 'custom-sql',
  dialect: 'sqlite',
  reader: {
    async readSchema() {
      return {
        entities: new Map([
          ['User', {
            name: 'User',
            fields: {
              id: { name: 'id', scalarType: 'string', nullable: false, isEnum: false },
            },
          }],
        ]),
        rawSource: '',
      };
    },
    hashModel() {
      return 'hash';
    },
  },
};

const churnRisk = defineTrait('User', {
  type: 'predictive',
  name: 'churnRisk',
  target: 'active',
  features: ['age'],
  output: { field: 'predictedChurn', taskType: 'regression' },
});

export default defineConfig({
  adapter: customAdapter,
  traits: [churnRisk],
});
`,
      'utf-8'
    );

    const captured = captureStdout();
    try {
      await migrateCommand.handler({
        config: configPath,
        json: true,
        'migrations-dir': migrationsDir,
      });
    } finally {
      captured.restore();
    }

    const payload = JSON.parse(captured.output().trim());
    expect(payload.ok).toBe(true);
    expect(payload.adapter).toBe('custom-sql');
    expect(payload.dialect).toBe('sqlite');
    expect(payload.written).toBe(true);
    expect(payload.migrationPath).toContain(path.join('migrations', payload.migrationId, 'migration.sql'));
    expect(fs.existsSync(payload.migrationPath)).toBe(true);
    expect(fs.readFileSync(payload.migrationPath, 'utf-8')).toContain('ALTER TABLE "User" ADD COLUMN "churnRisk" REAL NULL;');
  });

  it('rejects zod because it does not support database migrations', async () => {
    const configPath = path.join(tmpDir, 'scheml.config.ts');
    const schemaPath = path.join(tmpDir, 'schema.ts');
    fs.writeFileSync(schemaPath, 'export const schema = {};\n', 'utf-8');
    fs.writeFileSync(
      configPath,
      `import { defineConfig, defineTrait } from ${JSON.stringify(PACKAGE_SRC_ENTRY)};

const churnRisk = defineTrait('User', {
  type: 'predictive',
  name: 'churnRisk',
  target: 'active',
  features: ['age'],
  output: { field: 'predictedChurn', taskType: 'regression' },
});

export default defineConfig({
  adapter: 'zod',
  schema: './schema.ts',
  traits: [churnRisk],
});
`,
      'utf-8'
    );

    await expect(
      migrateCommand.handler({
        config: configPath,
        json: true,
      })
    ).rejects.toThrow('Adapter "zod" does not support schema migrations.');
  });
});