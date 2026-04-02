/**
 * scheml materialize command
 * Runs batch inference and writes trait values into a DB column.
 */

import * as fs from 'fs';
import * as path from 'path';
import { Argv } from 'yargs';
import { createJiti } from 'jiti';
import { pathToFileURL } from 'url';
import chalk from 'chalk';
import ora from 'ora';
import {
  type ModelDefinition,
  PredictionSession,
} from '..';
import { computeSchemaHashForMetadata } from '../contracts';
import { PrismaDataExtractor } from '../adapters/prisma';
import { appendHistoryRecord, detectAuthor, readLatestHistoryRecord } from '../history';
import type { AnyTraitDefinition } from '../traitTypes';

type PredictiveTraitLike = AnyTraitDefinition & {
  type: 'predictive';
  entity: string;
  name: string;
  features: string[];
};

function isTraitDefinition(value: any): value is AnyTraitDefinition {
  return (
    value &&
    typeof value === 'object' &&
    typeof value.name === 'string' &&
    typeof value.type === 'string' &&
    ['predictive', 'anomaly', 'similarity', 'sequential', 'generative'].includes(value.type)
  );
}

function isPredictiveTrait(value: AnyTraitDefinition): value is PredictiveTraitLike {
  return value.type === 'predictive';
}

function toCamelCase(name: string): string {
  return name ? name[0].toLowerCase() + name.slice(1) : name;
}

async function loadConfigModule(configPath: string): Promise<Record<string, unknown>> {
  const jiti = createJiti(pathToFileURL(__filename).href, { interopDefault: true });
  return (await jiti.import(configPath)) as Record<string, unknown>;
}

function buildFeatureResolvers(features: string[]): Record<string, (e: any) => any> {
  const resolvers: Record<string, (e: any) => any> = {};
  for (const feature of features) {
    resolvers[feature] = (entity: any) => entity[feature];
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
        description: 'Path to Prisma schema',
        type: 'string',
        default: './prisma/schema.prisma',
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
  handler: async (argv: any) => {
    const spinner = ora();
    const jsonMode = argv.json as boolean;

    const traitName = argv.trait as string;
    const configPath = path.resolve(argv.config);
    const schemaPath = path.resolve(argv.schema);
    const outputDir = path.resolve(argv.output);
    const batchSize = Number(argv['batch-size'] ?? 200);

    try {
      if (!jsonMode) spinner.start('Loading config...');
      const configModule = await loadConfigModule(configPath);
      const configExports =
        configModule.default && typeof configModule.default === 'object'
          ? { ...configModule, ...configModule.default }
          : configModule;
      const traits = Object.values(configExports).filter(isTraitDefinition) as AnyTraitDefinition[];
      const trait = traits.find((item) => item.name === traitName);
      if (!trait) {
        throw new Error(`Trait "${traitName}" not found in config`);
      }
      if (!isPredictiveTrait(trait)) {
        throw new Error(
          `Trait "${traitName}" has type "${trait.type}". Materialize currently supports predictive traits only.`
        );
      }
      if (!jsonMode) spinner.succeed('Config loaded');

      const metadataPath = path.join(outputDir, `${trait.name}.metadata.json`);
      const onnxPath = path.join(outputDir, `${trait.name}.onnx`);
      if (!fs.existsSync(metadataPath) || !fs.existsSync(onnxPath)) {
        throw new Error(`Artifact files not found for trait "${trait.name}" in ${outputDir}`);
      }

      const schemaContent = fs.readFileSync(schemaPath, 'utf-8');
      const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf-8'));
      const entityName =
        typeof (trait as any).entity === 'string'
          ? (trait as any).entity
          : String((trait as any).entity);
      const schemaHash = computeSchemaHashForMetadata(schemaContent, metadata);

      if (!jsonMode) spinner.start('Initializing inference session...');
      const session = new PredictionSession();
      await session.initializeModel(metadataPath, onnxPath, schemaHash);
      if (!jsonMode) spinner.succeed('Inference session ready');

      if (!jsonMode) spinner.start('Extracting rows via Prisma...');
      const extractor = new PrismaDataExtractor(process.cwd());
      const rows = await extractor.extract(entityName, { orderBy: 'id' });
      if (!rows.length) {
        throw new Error(`No rows found for entity "${entityName}"`);
      }
      if (!jsonMode) spinner.succeed(`Loaded ${rows.length} rows`);

      if (!jsonMode) spinner.start('Running inference + writing batches...');
      const resolvers = buildFeatureResolvers(trait.features as string[]);
      const outputField = trait.output.field;
      const modelDef: ModelDefinition<any> = {
        name: trait.name,
        modelName: entityName,
        output: {
          field: outputField,
          taskType: (metadata as any).taskType ?? 'regression',
          resolver: () => 0,
        },
        features: resolvers,
      };

      let written = 0;
      for (let i = 0; i < rows.length; i += batchSize) {
        const batch = rows.slice(i, i + batchSize);
        const predictions = await session.predictBatch(modelDef, batch);
        const results = predictions.results.map((prediction, index) => ({
          entityId: (batch[index] as any).id,
          prediction: prediction.prediction,
        }));
        await extractor.write?.(entityName, results, outputField);
        written += results.length;
      }

      const latest = readLatestHistoryRecord(outputDir, trait.name);
      appendHistoryRecord(outputDir, {
        trait: trait.name,
        model: entityName,
        adapter: 'prisma',
        schemaHash,
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
            column: outputField,
          }) + '\n'
        );
        return;
      }

      spinner.succeed(`Materialized ${written} rows for trait ${chalk.bold(trait.name)}`);
      console.log(chalk.green('\n[OK] Materialization complete.'));
      console.log(chalk.dim(`Column: ${trait.name}`));
      console.log(chalk.dim(`Rows written: ${written}`));
    } catch (error) {
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
    }
  },
};
