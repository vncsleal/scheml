/**
 * scheml migrate command
 * Generates Prisma SQL migration for materialized trait columns.
 */

import * as fs from 'fs';
import * as path from 'path';
import { Argv } from 'yargs';
import { createJiti } from 'jiti';
import { pathToFileURL } from 'url';
import chalk from 'chalk';
import { getAdapter } from '../adapters';
import type { AnyTraitDefinition } from '../traitTypes';

function sanitizeTraitName(name: string): string {
  if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
    throw new Error(
      `Trait name "${name}" contains invalid characters. Only letters, digits, underscores, and hyphens are allowed.`
    );
  }
  return name;
}

function isTraitDefinition(value: any): value is AnyTraitDefinition {
  return (
    value &&
    typeof value === 'object' &&
    typeof value.name === 'string' &&
    typeof value.type === 'string' &&
    ['predictive', 'anomaly', 'similarity', 'sequential', 'generative'].includes(value.type)
  );
}

async function loadConfigModule(configPath: string): Promise<Record<string, unknown>> {
  const jiti = createJiti(pathToFileURL(__filename).href, { interopDefault: true });
  return (await jiti.import(configPath)) as Record<string, unknown>;
}

function extractDatasourceProvider(schemaContent: string): string {
  const match = /datasource\s+\w+\s*\{[^}]*provider\s*=\s*"([^"]+)"/s.exec(schemaContent);
  return match ? match[1].toLowerCase() : 'postgresql';
}

function escapeSqlId(name: string): string {
  return name.replace(/"/g, '""');
}

function columnTypeForTraitType(type: AnyTraitDefinition['type'], provider: string): string {
  switch (type) {
    case 'generative':
      return 'TEXT';
    case 'similarity':
      if (provider === 'sqlite') return 'TEXT';
      if (provider === 'mysql') return 'JSON';
      return 'JSONB';
    case 'predictive':
    case 'anomaly':
    case 'sequential':
    default:
      if (provider === 'sqlite') return 'REAL';
      if (provider === 'mysql') return 'DOUBLE';
      return 'DOUBLE PRECISION';
  }
}

function timestampId(date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}`;
}

export const migrateCommand = {
  command: 'migrate',
  description: 'Generate schema migration for materialized trait columns',
  builder: (yargs: Argv) => {
    return yargs
      .option('config', {
        alias: 'c',
        description: 'Path to scheml.config.ts',
        type: 'string',
        default: './scheml.config.ts',
      })
      .option('schema', {
        alias: 's',
        description: 'Path to schema source file (overrides scheml.config.ts schema field)',
        type: 'string',
      })
      .option('trait', {
        description: 'Optional single trait filter',
        type: 'string',
      })
      .option('name', {
        description: 'Migration suffix name',
        type: 'string',
        default: 'scheml_traits',
      })
      .option('migrations-dir', {
        description: 'Path to migrations directory',
        type: 'string',
        default: './prisma/migrations',
      })
      .option('json', {
        description: 'Emit structured JSON',
        type: 'boolean',
        default: false,
      });
  },
  handler: async (argv: any) => {
    const configPath = path.resolve(argv.config);
    const traitFilter = argv.trait ? sanitizeTraitName(argv.trait as string) : undefined;
    const migrationsDir = path.resolve(argv['migrations-dir'] ?? './prisma/migrations');
    const jsonMode = argv.json as boolean;

    const configModule = await loadConfigModule(configPath);
    const configExports =
      configModule.default && typeof configModule.default === 'object'
        ? { ...configModule, ...configModule.default }
        : configModule;

    const configAdapter = (configExports as any).adapter;
    const adapterName = typeof configAdapter === 'string' ? configAdapter : 'prisma';

    // Resolve schema path: CLI flag > config field > error
    const configSchemaField = typeof (configExports as any).schema === 'string'
      ? (configExports as any).schema as string : undefined;
    const rawSchemaArg = argv.schema as string | undefined;
    if (!rawSchemaArg && !configSchemaField) {
      throw new Error(
        'Schema path not configured. Set schema in scheml.config.ts or pass --schema <path>.'
      );
    }
    const schemaPath = path.resolve(rawSchemaArg ?? configSchemaField!);

    const adapter = getAdapter(adapterName);
    const schemaGraph = await adapter.reader.readSchema(schemaPath);

    const allTraits = Object.values(configExports).filter(isTraitDefinition) as AnyTraitDefinition[];
    const traits = traitFilter
      ? allTraits.filter((trait) => trait.name === traitFilter)
      : allTraits;

    if (traitFilter && traits.length === 0) {
      const message = `Trait "${traitFilter}" not found in config`;
      if (jsonMode) {
        process.exitCode = 1;
        process.stdout.write(JSON.stringify({ ok: false, error: message, code: 'TRAIT_NOT_FOUND' }) + '\n');
        return;
      }
      throw new Error(message);
    }

    const statements: string[] = [];
    const skipped: Array<{ trait: string; reason: string }> = [];
    const provider = adapter.dialect ?? extractDatasourceProvider(schemaGraph.rawSource);

    for (const trait of traits) {
      const entityName =
        typeof (trait as any).entity === 'string'
          ? (trait as any).entity
          : null;

      if (!entityName) {
        skipped.push({ trait: trait.name, reason: 'entity name is not a string' });
        continue;
      }

      const entityDef = schemaGraph.entities.get(entityName);
      if (!entityDef) {
        skipped.push({ trait: trait.name, reason: `entity "${entityName}" not found in schema` });
        continue;
      }

      if (entityDef.fields[trait.name]) {
        skipped.push({ trait: trait.name, reason: 'column already exists' });
        continue;
      }

      const sqlType = columnTypeForTraitType(trait.type, provider);
      statements.push(
        `ALTER TABLE "${escapeSqlId(entityName)}" ADD COLUMN "${escapeSqlId(trait.name)}" ${sqlType} NULL;`
      );
    }

    const migrationId = `${timestampId()}_${String(argv.name).replace(/[^\w-]/g, '_').slice(0, 100)}`;
    const migrationDir = path.join(migrationsDir, migrationId);
    const migrationPath = path.join(migrationDir, 'migration.sql');

    let written = false;
    if (statements.length > 0) {
      fs.mkdirSync(migrationDir, { recursive: true });
      fs.writeFileSync(
        migrationPath,
        `${statements.join('\n')}\n`,
        'utf-8'
      );
      written = true;
    }

    const payload = {
      ok: true,
      migrationId,
      written,
      migrationPath: written ? migrationPath : null,
      statementCount: statements.length,
      statements,
      skipped,
    };

    if (jsonMode) {
      process.stdout.write(JSON.stringify(payload) + '\n');
      return;
    }

    if (!written) {
      console.log(chalk.yellow('No migration needed. All trait columns already exist or were skipped.'));
      if (skipped.length) {
        for (const item of skipped) {
          console.log(chalk.dim(`  ${item.trait}: ${item.reason}`));
        }
      }
      return;
    }

    console.log(chalk.green('\n[OK] Migration generated'));
    console.log(chalk.dim(`Path: ${migrationPath}`));
    console.log(chalk.dim(`Statements: ${statements.length}`));
    if (skipped.length) {
      console.log(chalk.yellow('\nSkipped:'));
      for (const item of skipped) {
        console.log(chalk.dim(`  ${item.trait}: ${item.reason}`));
      }
    }
  },
};
