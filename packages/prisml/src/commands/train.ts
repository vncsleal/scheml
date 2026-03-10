/**
 * prisml train command
 * Acts as compiler driver:
 * 1. Load model definitions
 * 2. Validate Prisma schemas and feature declarations
 * 3. Resolve defaults deterministically
 * 4. Extract historical data via Prisma
 * 5. Convert entities to feature vectors
 * 6. Materialize dataset
 * 7. Invoke Python backend
 * 8. Evaluate quality gates
 * 9. Export ONNX + metadata
 */

import * as fs from 'fs';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { createRequire } from 'module';
import { pathToFileURL } from 'url';
import { createJiti } from 'jiti';
import * as dotenv from 'dotenv';
import { Argv } from 'yargs';
import ora from 'ora';
import chalk from 'chalk';
import {
  hashPrismaSchema,
  VERSION,
  ModelMetadata,
  TrainingDataset,
  ModelDefinition,
  FeatureSchema,
  CategoryEncoding,
  ImputationRule,
  TrainingMetrics,
  FeatureDependency,
  buildCategoryMapping,
  normalizeFeatureVector,
  parseModelSchema,
} from '..';
import { QualityGateError, ModelDefinitionError, ConfigurationError } from '..';

type ResolvedModel = ModelDefinition & {
  output: {
    field: string;
    taskType: ModelDefinition['output']['taskType'];
    resolver?: (entity: any) => number | string | boolean;
  };
};

type FeatureStats = {
  name: string;
  type: 'number' | 'boolean' | 'string' | 'date' | 'unknown';
  values: unknown[];
  hasNulls?: boolean;
  stringMode?: string;
  numericMean?: number;
  booleanMode?: boolean;
  encoding?: CategoryEncoding;
  imputation?: ImputationRule;
};

type TrainingRow = {
  features: Record<string, unknown>;
  label: number | string | boolean;
};

function isModelDefinition(value: any): value is ResolvedModel {
  return (
    value &&
    typeof value === 'object' &&
    typeof value.name === 'string' &&
    typeof value.modelName === 'string' &&
    value.output &&
    value.features &&
    value.algorithm
  );
}

function toCamelCase(name: string): string {
  return name ? name[0].toLowerCase() + name.slice(1) : name;
}

function seededShuffle<T>(items: T[], seed: number): T[] {
  const result = items.slice();
  let state = seed;
  for (let i = result.length - 1; i > 0; i--) {
    state = (state * 1664525 + 1013904223) % 0x100000000;
    const j = state % (i + 1);
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function inferFeatureType(values: unknown[]): FeatureStats['type'] {
  for (const value of values) {
    if (value === null || value === undefined) continue;
    if (value instanceof Date) return 'date';
    if (typeof value === 'number') return 'number';
    if (typeof value === 'boolean') return 'boolean';
    if (typeof value === 'string') return 'string';
  }
  return 'unknown';
}

function computeStringMode(values: unknown[]): string | undefined {
  const counts = new Map<string, number>();
  for (const value of values) {
    if (typeof value === 'string') {
      counts.set(value, (counts.get(value) || 0) + 1);
    }
  }
  let best: string | undefined;
  let bestCount = -1;
  for (const [key, count] of counts.entries()) {
    if (count > bestCount) {
      best = key;
      bestCount = count;
    }
  }
  return best;
}

function computeNumericMean(values: unknown[]): number | undefined {
  const nums = values.filter((v) => typeof v === 'number') as number[];
  if (nums.length === 0) return undefined;
  const sum = nums.reduce((acc, v) => acc + v, 0);
  return sum / nums.length;
}

function computeBooleanMode(values: unknown[]): boolean | undefined {
  let trueCount = 0;
  let falseCount = 0;
  for (const value of values) {
    if (typeof value === 'boolean') {
      value ? trueCount++ : falseCount++;
    }
  }
  if (trueCount === 0 && falseCount === 0) return undefined;
  return trueCount >= falseCount;
}

async function loadConfigModule(configPath: string): Promise<Record<string, unknown>> {
  const jiti = createJiti(pathToFileURL(__filename).href, { interopDefault: true });
  return (await jiti.import(configPath)) as Record<string, unknown>;
}

function buildFeatureSchema(stats: FeatureStats[]): FeatureSchema {
  return {
    features: stats.map((stat, index) => ({
      name: stat.name,
      index,
      originalType: stat.type,
      encoding: stat.encoding,
      imputation: stat.imputation,
    })),
    count: stats.length,
    order: stats.map((stat) => stat.name),
  };
}

export const trainCommand = {
  command: 'train',
  description: 'Train PrisML models',
  builder: (yargs: Argv) => {
    return yargs
      .option('config', {
        alias: 'c',
        description: 'Path to prisml.config.ts',
        type: 'string',
        default: './prisml.config.ts',
      })
      .option('schema', {
        alias: 's',
        description: 'Path to Prisma schema',
        type: 'string',
        default: './prisma/schema.prisma',
      })
      .option('output', {
        alias: 'o',
        description: 'Output directory for models',
        type: 'string',
        default: './.prisml',
      })
      .option('python', {
        description: 'Python backend: "local"',
        type: 'string',
        default: 'local',
        choices: ['local'],
      });
  },
  handler: async (argv: any) => {
    const spinner = ora();
    let prisma: any = null;

    try {
      dotenv.config();

      const configPath = path.resolve(argv.config);
      const schemaPath = path.resolve(argv.schema);
      const outputPath = path.resolve(argv.output);

      if (!fs.existsSync(outputPath)) {
        fs.mkdirSync(outputPath, { recursive: true });
      }

      // 1. Load Prisma schema
      spinner.start('Loading Prisma schema...');
      const schemaContent = fs.readFileSync(schemaPath, 'utf-8');
      const schemaHash = hashPrismaSchema(schemaContent);
      spinner.succeed(`Schema loaded (hash: ${schemaHash.slice(0, 8)})`);

      // 2. Load model definitions
      spinner.start('Loading model definitions...');

      const configModule = await loadConfigModule(configPath);
      const configExports =
        configModule.default && typeof configModule.default === 'object'
          ? { ...configModule, ...configModule.default }
          : configModule;
      const modelDefinitions = Object.values(configExports).filter(
        isModelDefinition
      ) as ResolvedModel[];

      if (modelDefinitions.length === 0) {
        throw new ModelDefinitionError('unknown', 'No models exported from config');
      }

      spinner.succeed(`Loaded ${modelDefinitions.length} model definition(s)`);

      // 3. Create output directory
      const outputDir = path.resolve(argv.output);
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
      }

      // 4. Validate models and load PrismaClient
      spinner.start('Validating models...');

      const requirePrisma = createRequire(
        path.resolve(process.cwd(), 'node_modules/@prisma/client/package.json')
      );
      const { PrismaClient } = requirePrisma('@prisma/client');
      prisma = new PrismaClient();
      const modelArtifacts: { metadata: ModelMetadata; onnxPath: string }[] = [];

      const prismaModels =
        schemaContent
          .match(/model\s+(\w+)\s*{/g)
          ?.map((match: string) => match.split(' ')[1]) || [];
      for (const model of modelDefinitions) {
        if (!prismaModels.includes(model.modelName)) {
          throw new ModelDefinitionError(
            model.name,
            `Prisma model "${model.modelName}" not found in schema`
          );
        }
        if (!model.output.resolver) {
          throw new ModelDefinitionError(
            model.name,
            'Output resolver is required for training'
          );
        }
      }
      spinner.succeed('Models validated');

      // 5. Extract training data and train
      spinner.start('Extracting training data via Prisma...');

      for (const model of modelDefinitions) {
        const prismaDelegate = (prisma as any)[toCamelCase(model.modelName)];
        if (!prismaDelegate || typeof prismaDelegate.findMany !== 'function') {
          throw new ConfigurationError(
            `PrismaClient does not expose model "${model.modelName}"`
          );
        }

        // ORDER BY primary key for deterministic row ordering across runs.
        // Without this, database row order is non-deterministic and the seeded
        // shuffle produces a different train/test split on every invocation.
        const entities = await prismaDelegate.findMany({ orderBy: { id: 'asc' } });
        if (!entities.length) {
          throw new ConfigurationError(`No records found for model "${model.modelName}"`);
        }

        const featureNames = Object.keys(model.features);
        const rows: TrainingRow[] = entities.map((entity: any) => {
          const featureValues: Record<string, unknown> = {};
          for (const featureName of featureNames) {
            const resolver = model.features[featureName];
            featureValues[featureName] = resolver(entity);
          }
          const label = model.output.resolver!(entity);
          return { features: featureValues, label };
        });

        const featureStats: FeatureStats[] = featureNames.map((name) => ({
          name,
          type: 'unknown',
          values: rows.map((row: TrainingRow) => row.features[name]),
        }));

        for (const stat of featureStats) {
          stat.hasNulls = stat.values.some((value) => value === null || value === undefined);
          stat.type = inferFeatureType(stat.values);
          if (stat.type === 'string') {
            stat.stringMode = computeStringMode(stat.values);
            stat.encoding = {
              type: 'label',
              mapping: buildCategoryMapping(
                stat.values.filter((v) => typeof v === 'string') as string[]
              ),
            };
          }
          if (stat.type === 'number') {
            const mean = computeNumericMean(stat.values);
            if (mean !== undefined) {
              stat.numericMean = mean;
              stat.imputation = { strategy: 'constant', value: mean };
            }
          }
          if (stat.type === 'boolean') {
            const mode = computeBooleanMode(stat.values);
            if (mode !== undefined) {
              stat.booleanMode = mode;
              stat.imputation = { strategy: 'constant', value: mode ? 1 : 0 };
            }
          }
        }

        const schema: FeatureSchema = buildFeatureSchema(featureStats);
        const prismaFields = parseModelSchema(schemaContent, model.modelName);
        const featureDependencies: FeatureDependency[] = featureStats.map((stat) => {
          const field = prismaFields[stat.name];
          const extractable = !!field;
          const issues = extractable
            ? []
            : [
                `Feature "${stat.name}" is not a direct field on model "${model.modelName}"`,
              ];
          return {
            modelName: model.modelName,
            path: `${model.modelName}.${stat.name}`,
            scalarType: stat.type,
            nullable: !!stat.hasNulls,
            encoding: stat.encoding,
            extractable,
            issues: issues.length ? issues : undefined,
          };
        });
        const encodings: Record<string, CategoryEncoding | undefined> = {};
        const imputations: Record<string, ImputationRule | undefined> = {};
        const stringModes: Record<string, string | undefined> = {};

        for (const stat of featureStats) {
          encodings[stat.name] = stat.encoding;
          imputations[stat.name] = stat.imputation;
          if (stat.type === 'string') {
            stringModes[stat.name] = stat.stringMode;
          }
        }

        const vectors = rows.map((row: TrainingRow) => {
          const prepared: Record<string, unknown> = { ...row.features };
          for (const stat of featureStats) {
            const value = prepared[stat.name];
            if ((value === null || value === undefined) && stat.type === 'string') {
              if (stringModes[stat.name]) {
                prepared[stat.name] = stringModes[stat.name];
              }
            }
          }
          return normalizeFeatureVector(prepared, schema, encodings, imputations);
        });

        const labels = rows.map((row: TrainingRow) => {
          const label = row.label;
          if (typeof label === 'boolean') return label ? 1 : 0;
          return label as any;
        });

        // TODO(V2 tech debt): split belongs in Python, not here. Moving
        // preprocessing to Python (V2 hardening) requires Python to own the
        // split so that encoders fit on X_train only. Seed is fixed at 42 for
        // now to keep artifact generation deterministic.
        const seed = 42;
        const indices = seededShuffle([...Array(vectors.length).keys()], seed);
        const testSize = Math.max(1, Math.floor(vectors.length * 0.2));
        const testIndices = new Set(indices.slice(0, testSize));

        const X_train: number[][] = [];
        const y_train: Array<number | string> = [];
        const X_test: number[][] = [];
        const y_test: Array<number | string> = [];

        indices.forEach((idx) => {
          if (testIndices.has(idx)) {
            X_test.push(vectors[idx]);
            y_test.push(labels[idx] as any);
          } else {
            X_train.push(vectors[idx]);
            y_train.push(labels[idx] as any);
          }
        });

        const dataset: TrainingDataset = {
          size: vectors.length,
          splitSeed: seed,
          trainSize: X_train.length,
          testSize: X_test.length,
          materializedAt: new Date().toISOString(),
        };

        const datasetPath = path.join(outputDir, `${model.name}.dataset.json`);
        fs.writeFileSync(
          datasetPath,
          JSON.stringify({
            X_train,
            y_train,
            X_test,
            y_test,
            taskType: model.output.taskType,
            algorithm: model.algorithm.name,
            hyperparameters: model.algorithm.hyperparameters || {},
          })
        );

        spinner.text = `Training ${model.name} (${model.algorithm.name})...`;
        const pythonScript = path.resolve(__dirname, '../../python/train.py');
        const result = spawnSync('python3', [pythonScript, '--dataset', datasetPath, '--output', outputDir, '--model-name', model.name], {
          stdio: 'pipe',
          encoding: 'utf-8',
        });

        if (result.error) {
          throw result.error;
        }

        if (result.status !== 0) {
          throw new Error(result.stderr || 'Python backend failed');
        }

        const response = JSON.parse(result.stdout.trim());
        const metrics: TrainingMetrics[] = response.metrics || [];
        const pendingOnnxPath: string = response.onnxPath;

        // Quality gate check runs after Python writes the ONNX artifact.
        // If a gate fails we must delete the orphaned .onnx before rethrowing
        // so that no artifact exists without a corresponding .metadata.json.
        try {
          if (model.qualityGates?.length) {
            for (const gate of model.qualityGates) {
              const metric = metrics.find(
                (m) => m.metric === gate.metric && m.split === 'test'
              );
              if (!metric) {
                throw new QualityGateError(
                  model.name,
                  gate.metric,
                  gate.threshold,
                  NaN,
                  gate.comparison
                );
              }
              const passes =
                gate.comparison === 'gte'
                  ? metric.value >= gate.threshold
                  : metric.value <= gate.threshold;
              if (!passes) {
                throw new QualityGateError(
                  model.name,
                  gate.metric,
                  gate.threshold,
                  metric.value,
                  gate.comparison
                );
              }
            }
          }
        } catch (gateError) {
          if (pendingOnnxPath && fs.existsSync(pendingOnnxPath)) {
            fs.unlinkSync(pendingOnnxPath);
          }
          throw gateError;
        }

        const metadata: ModelMetadata = {
          version: VERSION,
          metadataSchemaVersion: '1.1.0',
          modelName: model.name,
          taskType: model.output.taskType,
          algorithm: model.algorithm,
          features: schema,
          output: { field: model.output.field, shape: [1] },
          tensorSpec: { inputShape: [1, schema.count], outputShape: [1] },
          featureDependencies,
          encoding: encodings,
          imputation: imputations,
          prismaSchemaHash: schemaHash,
          trainingMetrics: metrics,
          dataset,
          compiledAt: new Date().toISOString(),
        };

        const metadataPath = path.join(outputDir, `${model.name}.metadata.json`);
        fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));

        modelArtifacts.push({ metadata, onnxPath: response.onnxPath });
      }

      spinner.succeed('Training complete');
      spinner.start('Writing artifacts...');
      spinner.succeed(`Artifacts written to ${chalk.cyan(outputDir)}`);

      console.log(chalk.green('\n[OK] Training complete\n'));
      console.log('Artifacts:');
      for (const artifact of modelArtifacts) {
        console.log(`  ${chalk.dim(`${artifact.metadata.modelName}.metadata.json`)}`);
        console.log(`  ${chalk.dim(path.basename(artifact.onnxPath))}`);
      }
    } catch (error) {
      spinner.fail((error as Error).message);
      throw error;
    } finally {
      if (prisma) {
        await prisma.$disconnect();
      }
    }
  },
};
