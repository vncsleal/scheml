/**
 * scheml migrate command
 * Generates SQL migration files for materialized trait columns.
 */

import * as fs from 'fs';
import * as path from 'path';
import { Argv } from 'yargs';
import chalk from 'chalk';
import type { ScheMLAdapter, SchemaGraph } from '../adapters/interface';
import {
  requireTraitEntityName,
  resolveConfiguredAdapter,
  resolveSchemaPath,
} from '../adapterResolution';
import type { AnyTraitDefinition } from '../traitTypes';
import { extractTraitDefinitions, loadConfigModule, normalizeConfigExports } from './configHelpers';

interface MigrateArgs {
  config?: string;
  schema?: string;
  trait?: string;
  name?: string;
  dialect?: string;
  json?: boolean;
  'migrations-dir'?: string;
}

function sanitizeTraitName(name: string): string {
  if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
    throw new Error(
      `Trait name "${name}" contains invalid characters. Only letters, digits, underscores, and hyphens are allowed.`
    );
  }
  return name;
}

function extractDatasourceProvider(schemaContent: string): string {
  const match = /datasource\s+\w+\s*\{[^}]*provider\s*=\s*"([^"]+)"/s.exec(schemaContent);
  return match ? match[1].toLowerCase() : 'postgresql';
}

function resolveDefaultMigrationsDir(adapterName: string, schemaPath?: string): string {
  if (adapterName === 'zod') {
    throw new Error('Adapter "zod" does not support schema migrations. Use a database-backed adapter instead.');
  }

  if (!schemaPath) {
    throw new Error(
      'Migrations directory cannot be inferred without a schema path. ' +
      'Pass --migrations-dir <path> or set schema in scheml.config.ts.'
    );
  }

  return path.join(path.dirname(schemaPath), 'migrations');
}

function resolveDialect(
  requestedDialect: string | undefined,
  adapter: ScheMLAdapter,
  adapterName: string,
  schemaGraph: SchemaGraph,
): string {
  if (requestedDialect) {
    return requestedDialect.toLowerCase();
  }

  if (adapter.dialect) {
    return adapter.dialect.toLowerCase();
  }

  if (adapterName === 'prisma' && schemaGraph.rawSource) {
    return extractDatasourceProvider(schemaGraph.rawSource);
  }

  return 'postgresql';
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
    case 'temporal':
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
      .option('dialect', {
        description: 'SQL dialect override (postgresql | mysql | sqlite)',
        type: 'string',
      })
      .option('migrations-dir', {
        description: 'Path to migrations directory',
        type: 'string',
      })
      .option('json', {
        description: 'Emit structured JSON',
        type: 'boolean',
        default: false,
      });
  },
  handler: async (argv: MigrateArgs) => {
    const configPath = path.resolve(argv.config ?? './scheml.config.ts');
    const traitFilter = argv.trait ? sanitizeTraitName(argv.trait) : undefined;
    const rawMigrationsDir = argv['migrations-dir'];
    const rawDialect = typeof argv.dialect === 'string' ? argv.dialect : undefined;
    const jsonMode = argv.json ?? false;

    const configModule = await loadConfigModule(configPath);
    const configExports = normalizeConfigExports(configModule);

    // Resolve schema path: CLI flag > config field
    const configSchemaField = typeof configExports.schema === 'string'
      ? configExports.schema
      : undefined;
    const schemaSource = resolveSchemaPath(configSchemaField, argv.schema);
    const schemaPath = schemaSource ? path.resolve(schemaSource) : undefined;

    const adapter = resolveConfiguredAdapter(configExports.adapter);
    const adapterName = adapter.name;
    const schemaGraph = await adapter.reader.readSchema(schemaPath ?? '');
    if ((adapterName === 'drizzle' || adapterName === 'typeorm') && schemaGraph.entities.size === 0) {
      throw new Error(
        `Adapter "${adapterName}" produced an empty schema graph. ` +
        'Pass a configured adapter instance in scheml.config.ts or verify the schema module exports loadable schema objects.'
      );
    }
    const migrationsDir = path.resolve(
      rawMigrationsDir
        ?? resolveDefaultMigrationsDir(adapterName, schemaPath)
    );

    const allTraits = extractTraitDefinitions(configExports);
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
    const provider = resolveDialect(rawDialect, adapter, adapterName, schemaGraph);

    for (const trait of traits) {
      const entityName = requireTraitEntityName(trait, adapterName);

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
      adapter: adapterName,
      dialect: provider,
      migrationsDir,
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
