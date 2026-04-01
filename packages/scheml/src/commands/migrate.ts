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
import { parseModelSchema } from '../schema';
import type { AnyTraitDefinition } from '../traitTypes';

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

function columnTypeForTraitType(type: AnyTraitDefinition['type']): string {
  switch (type) {
    case 'generative':
      return 'TEXT';
    case 'similarity':
      return 'JSONB';
    case 'predictive':
    case 'anomaly':
    case 'sequential':
    default:
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
        description: 'Path to Prisma schema',
        type: 'string',
        default: './prisma/schema.prisma',
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
      .option('json', {
        description: 'Emit structured JSON',
        type: 'boolean',
        default: false,
      });
  },
  handler: async (argv: any) => {
    const configPath = path.resolve(argv.config);
    const schemaPath = path.resolve(argv.schema);
    const traitFilter = argv.trait as string | undefined;
    const jsonMode = argv.json as boolean;

    const schemaContent = fs.readFileSync(schemaPath, 'utf-8');
    const configModule = await loadConfigModule(configPath);
    const configExports =
      configModule.default && typeof configModule.default === 'object'
        ? { ...configModule, ...configModule.default }
        : configModule;

    const allTraits = Object.values(configExports).filter(isTraitDefinition) as AnyTraitDefinition[];
    const traits = traitFilter
      ? allTraits.filter((trait) => trait.name === traitFilter)
      : allTraits;

    if (traitFilter && traits.length === 0) {
      const message = `Trait "${traitFilter}" not found in config`;
      if (jsonMode) {
        process.stdout.write(JSON.stringify({ ok: false, error: message, code: 'TRAIT_NOT_FOUND' }) + '\n');
        return;
      }
      throw new Error(message);
    }

    const statements: string[] = [];
    const skipped: Array<{ trait: string; reason: string }> = [];

    for (const trait of traits) {
      const entityName =
        typeof (trait as any).entity === 'string'
          ? (trait as any).entity
          : null;

      if (!entityName) {
        skipped.push({ trait: trait.name, reason: 'non-prisma entity reference' });
        continue;
      }

      const fields = parseModelSchema(schemaContent, entityName);
      if (!Object.keys(fields).length) {
        skipped.push({ trait: trait.name, reason: `entity "${entityName}" not found in schema` });
        continue;
      }

      if (fields[trait.name]) {
        skipped.push({ trait: trait.name, reason: 'column already exists' });
        continue;
      }

      const sqlType = columnTypeForTraitType(trait.type);
      statements.push(
        `ALTER TABLE "${entityName}" ADD COLUMN "${trait.name}" ${sqlType} NULL;`
      );
    }

    const migrationId = `${timestampId()}_${String(argv.name)}`;
    const migrationDir = path.resolve(process.cwd(), 'prisma', 'migrations', migrationId);
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
