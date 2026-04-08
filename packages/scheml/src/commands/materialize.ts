/**
 * scheml materialize command
 * Runs batch inference and writes trait values into a DB column.
 */

import * as fs from 'fs';
import * as path from 'path';
import { Argv } from 'yargs';
import chalk from 'chalk';
import ora from 'ora';
import {
  PredictionSession,
} from '..';
import {
  requireTraitEntityName,
  resolveConfiguredAdapter,
  resolveSchemaPath,
} from '../adapterResolution';
import { metadataFileName, parseArtifactMetadata } from '../artifacts';
import { appendHistoryRecord, detectAuthor, readLatestHistoryRecord } from '../history';
import { getMaterializedColumnName } from '../materialization';
import type { AnyTraitDefinition } from '../traitTypes';
import {
  loadConfigModule,
  normalizeConfigExports,
  resolveTraitDefinitions,
  selectTraitDefinitions,
} from './configHelpers';

type MaterializableTraitLike = AnyTraitDefinition & {
  type: 'predictive' | 'anomaly';
  name: string;
};

type PredictiveTraitLike = MaterializableTraitLike & {
  type: 'predictive';
  features: string[];
};

type AnomalyTraitLike = MaterializableTraitLike & {
  type: 'anomaly';
  baseline: string[];
};

type MaterializeArgs = {
  config?: string;
  schema?: string;
  output?: string;
  trait?: string;
  'batch-size'?: number;
  json?: boolean;
};
function isMaterializableTrait(value: AnyTraitDefinition): value is MaterializableTraitLike {
  return value.type === 'predictive' || value.type === 'anomaly';
}

function buildFeatureResolvers(features: string[]): Record<string, (entity: Record<string, unknown>) => unknown> {
  const resolvers: Record<string, (entity: Record<string, unknown>) => unknown> = {};
  for (const feature of features) {
    resolvers[feature] = (entity: Record<string, unknown>) => entity[feature];
  }
  return resolvers;
}

export const materializeCommand = {
  command: 'materialize',
  description: 'Batch inference and write trait predictions to DB column',
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
      .option('output', {
        alias: 'o',
        description: 'Output directory for artifacts',
        type: 'string',
        default: './.scheml',
      })
      .option('trait', {
        description: 'Trait name to materialize',
        type: 'string',
        demandOption: true,
      })
      .option('batch-size', {
        description: 'Batch size for prediction and writes',
        type: 'number',
        default: 200,
      })
      .option('json', {
        description: 'Emit structured JSON',
        type: 'boolean',
        default: false,
      });
  },
  handler: async (argv: MaterializeArgs) => {
    const spinner = ora();
    const jsonMode = argv.json ?? false;
    let predictionSession: PredictionSession | undefined;
    let extractorDisconnect: (() => Promise<void>) | undefined;
    let materializeError: Error | undefined;
    let cleanupError: Error | undefined;

    if (typeof argv.trait !== 'string' || argv.trait.length === 0) {
      throw new Error('Trait name is required. Usage: scheml materialize --trait <name>');
    }

    const traitName = argv.trait;
    const configPath = path.resolve(argv.config ?? './scheml.config.ts');
    const outputDir = path.resolve(argv.output ?? './.scheml');
    const batchSize = Number(argv['batch-size'] ?? 200);

    try {
      if (!jsonMode) spinner.start('Loading config...');
      const configModule = await loadConfigModule(configPath);
      const configExports = normalizeConfigExports(configModule);
      const traits = resolveTraitDefinitions(configExports);
      const [trait] = selectTraitDefinitions(traits, traitName);
      if (!isMaterializableTrait(trait)) {
        throw new Error(
          `Trait "${traitName}" has type "${trait.type}". Materialize currently supports predictive and anomaly traits only.`
        );
      }
      if (!jsonMode) spinner.succeed('Config loaded');

      // Resolve adapter from config
      const configAdapter = configExports.adapter;
      const schemaSource = resolveSchemaPath(configExports.schema, argv.schema);
      if (!schemaSource && typeof configAdapter === 'string') {
        throw new Error(
          'Schema path not configured. Set schema in scheml.config.ts or pass --schema <path>.'
        );
      }
      const schemaPath = schemaSource ? path.resolve(schemaSource) : undefined;

      const adapter = resolveConfiguredAdapter(configAdapter);
      const adapterName = adapter.name;
      if (!adapter.extractor) {
        throw new Error(`Adapter "${adapterName}" does not support data extraction`);
      }
      extractorDisconnect = adapter.extractor.disconnect?.bind(adapter.extractor);

      const metadataPath = path.join(outputDir, metadataFileName(trait.name));
      if (!fs.existsSync(metadataPath)) {
        throw new Error(`Artifact metadata not found for trait "${trait.name}" in ${outputDir}`);
      }
      const entityName = requireTraitEntityName(trait, adapterName);

      if (!jsonMode) spinner.start('Initializing inference session...');
      predictionSession = new PredictionSession();
      await predictionSession.loadTrait(trait.name, { artifactsDir: outputDir, schemaPath, adapter });
      if (!jsonMode) spinner.succeed('Inference session ready');

      if (!jsonMode) spinner.start(`Extracting rows via ${adapterName}...`);
      const rows = await adapter.extractor.extract(entityName, { orderBy: 'id' });
      if (!rows.length) {
        throw new Error(`No rows found for entity "${entityName}"`);
      }
      if (!jsonMode) spinner.succeed(`Loaded ${rows.length} rows`);

      if (!jsonMode) spinner.start('Running inference + writing batches...');
      const featureNames = trait.type === 'predictive'
        ? (trait as PredictiveTraitLike).features
        : (trait as AnomalyTraitLike).baseline;
      const resolvers = buildFeatureResolvers(featureNames);
      const materializedColumn = getMaterializedColumnName(trait);

      let written = 0;
      for (let i = 0; i < rows.length; i += batchSize) {
        const batch = rows.slice(i, i + batchSize);
        const predictions = await predictionSession.predictBatch(trait.name, batch, resolvers);
        const results = predictions.results.map((prediction, index) => {
          const row = batch[index] as Record<string, unknown>;
          const entityId = row['id'] ?? row['_id'];
          if (entityId == null) {
            throw new Error(
              `Row at index ${i + index} has no 'id' or '_id' field. ` +
              `Ensure entity "${entityName}" exposes a primary key named 'id'.`
            );
          }
          return { entityId, prediction: prediction.prediction };
        });
        await adapter.extractor.write?.(entityName, results, materializedColumn);
        written += results.length;
      }

      const latest = readLatestHistoryRecord(outputDir, trait.name);
      appendHistoryRecord(outputDir, {
        trait: trait.name,
        model: entityName,
        adapter: adapterName,
        schemaHash: parseArtifactMetadata(JSON.parse(fs.readFileSync(metadataPath, 'utf-8')))?.schemaHash ?? 'unknown',
        definedAt: new Date().toISOString(),
        definedBy: detectAuthor(),
        trainedAt: latest?.trainedAt,
        artifactVersion: latest?.artifactVersion ?? '0',
        status: 'materialized',
      });

      if (jsonMode) {
        process.stdout.write(
          JSON.stringify({
            ok: true,
            trait: trait.name,
            entity: entityName,
            rowsProcessed: rows.length,
            rowsWritten: written,
            column: materializedColumn,
          }) + '\n'
        );
        return;
      }

      spinner.succeed(`Materialized ${written} rows for trait ${chalk.bold(trait.name)}`);
      console.log(chalk.green('\n[OK] Materialization complete.'));
      console.log(chalk.dim(`Column: ${materializedColumn}`));
      console.log(chalk.dim(`Rows written: ${written}`));
    } catch (error) {
      materializeError = error as Error;
      if (jsonMode) {
        process.exitCode = 1;
        process.stdout.write(
          JSON.stringify({ ok: false, error: (error as Error).message, code: 'MATERIALIZE_FAILED' }) +
            '\n'
        );
        return;
      }
      spinner.fail((error as Error).message);
      throw error;
    } finally {
      const cleanupFailures: string[] = [];

      if (predictionSession) {
        try {
          await predictionSession.disposeAll();
        } catch (error) {
          cleanupFailures.push(`prediction session cleanup failed: ${(error as Error).message}`);
        }
      }

      if (extractorDisconnect) {
        try {
          await extractorDisconnect();
        } catch (error) {
          cleanupFailures.push(`adapter disconnect failed: ${(error as Error).message}`);
        }
      }

      if (cleanupFailures.length > 0) {
          const err = new Error(
            `Materialize cleanup failed: ${cleanupFailures.join('; ')}`
          );
          if (materializeError) {
            if (jsonMode) {
              process.stderr.write(`${err.message}\n`);
            } else {
              spinner.warn(err.message);
            }
          } else {
            cleanupError = err;
          }
        }
      }
      if (cleanupError) throw cleanupError;
    },  };