/**
 * scheml train command
 * Acts as compiler driver:
 * 1. Load model definitions
 * 2. Validate Prisma schemas and feature declarations
 * 3. Resolve defaults deterministically
 * 4. Extract historical data via Prisma
 * 5. Split rows and fit a train-derived feature contract
 * 6. Convert train/test rows to feature vectors
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
  hashPrismaModelSubset,
  VERSION,
  ModelMetadata,
  TrainingDataset,
  ModelDefinition,
  TrainingMetrics,
  FeatureDependency,
  normalizeFeatureVector,
  parseModelSchema,
} from '..';
import { QualityGateError, ModelDefinitionError, ConfigurationError } from '..';
import { validateTrainingModelDefinition } from '../contracts';
import {
  fitTrainingContract,
  splitTrainingRows,
  type TrainingRow,
} from '../training_contract';

type ResolvedModel = ModelDefinition & {
  output: {
    field: string;
    taskType: ModelDefinition['output']['taskType'];
    resolver?: (entity: any) => number | string | boolean;
  };
};

function isModelDefinition(value: any): value is ResolvedModel {
  return (
    value &&
    typeof value === 'object' &&
    typeof value.name === 'string' &&
    typeof value.modelName === 'string' &&
    value.output &&
    value.features
    // algorithm is intentionally optional
  );
}

function toCamelCase(name: string): string {
  return name ? name[0].toLowerCase() + name.slice(1) : name;
}

async function loadConfigModule(configPath: string): Promise<Record<string, unknown>> {
  const jiti = createJiti(pathToFileURL(__filename).href, { interopDefault: true });
  return (await jiti.import(configPath)) as Record<string, unknown>;
}

function checkPythonEnvironment(): void {
  const whichResult = spawnSync('which', ['python3'], { encoding: 'utf-8' });
  if (whichResult.status !== 0) {
    throw new ConfigurationError(
      'Python 3 not found on PATH. Install Python 3 and ensure it is accessible.'
    );
  }
  const importCheck = spawnSync(
    'python3',
    ['-c', 'import flaml, sklearn, skl2onnx, numpy, onnx'],
    { encoding: 'utf-8' }
  );
  if (importCheck.status !== 0) {
    throw new ConfigurationError(
      'Required Python packages not found. Run:\n  pip install -r packages/scheml/python/requirements.txt\n\n' +
        (importCheck.stderr || importCheck.stdout || '').trim()
    );
  }
}

export const trainCommand = {
  command: 'train',
  description: 'Train ScheML models',
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
        description: 'Output directory for models',
        type: 'string',
        default: './.scheml',
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
      spinner.succeed('Schema loaded');
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

      // 3. Preflight validate model definitions before invoking Python or instantiating PrismaClient / extracting data via Prisma.
      spinner.start('Running preflight validation...');
      for (const model of modelDefinitions) {
        validateTrainingModelDefinition(model);
      }
      spinner.succeed('Preflight validation passed');

      // 4. Verify Python environment before doing any heavy work
      spinner.start('Checking Python environment...');
      checkPythonEnvironment();
      spinner.succeed('Python environment OK');

      // 5. Create output directory
      const outputDir = path.resolve(argv.output);
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
      }

      // 6. Validate models and load PrismaClient
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

      // 7. Extract training data and train
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

        const seed = 42;
        const { trainRows, testRows } = splitTrainingRows(rows, seed, 0.2);
        const fittedContract = fitTrainingContract(model.name, featureNames, trainRows, rows);
        const { schema, featureStats, encodings, imputations, scalings } = fittedContract;

        const prismaFields = parseModelSchema(schemaContent, model.modelName);
        const featureDependencies: FeatureDependency[] = featureStats.map((stat): FeatureDependency => {
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
            nullable: stat.hasNulls,
            encoding: stat.encoding,
            extractable,
            issues: issues.length ? issues : undefined,
          };
        });

        const toVector = (row: TrainingRow) =>
          normalizeFeatureVector(row.features, schema, encodings, imputations, scalings);
        const toLabel = (row: TrainingRow) => {
          const label = row.label;
          if (typeof label === 'boolean') return label ? 1 : 0;
          return label as any;
        };

        const X_train = trainRows.map(toVector);
        const y_train = trainRows.map(toLabel);
        const X_test = testRows.map(toVector);
        const y_test = testRows.map(toLabel);

        const dataset: TrainingDataset = {
          size: rows.length,
          splitSeed: seed,
          trainSize: X_train.length,
          testSize: X_test.length,
          materializedAt: new Date().toISOString(),
        };

        // Per-model scoped schema hash: only hashes the relevant Prisma model block + its enums
        const modelSchemaHash = hashPrismaModelSubset(schemaContent, model.modelName);
        // Backfill schemaHash on the live model definition object
        (model as any).schemaHash = modelSchemaHash;

        const datasetPath = path.join(outputDir, `${model.name}.dataset.json`);
        const algorithmName = model.algorithm?.name ?? 'automl';
        fs.writeFileSync(
          datasetPath,
          JSON.stringify({
            X_train,
            y_train,
            X_test,
            y_test,
            taskType: model.output.taskType,
            algorithm: algorithmName,
            hyperparameters: model.algorithm?.hyperparameters || {},
          })
        );

        spinner.text = `Training ${model.name} (${algorithmName === 'automl' ? 'FLAML AutoML' : algorithmName})...`;
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
        const bestEstimator: string = response.bestEstimator || algorithmName;

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
          metadataSchemaVersion: '1.2.0',
          modelName: model.name,
          taskType: model.output.taskType,
          algorithm: model.algorithm,
          bestEstimator,
          features: schema,
          output: { field: model.output.field, shape: [1] },
          tensorSpec: { inputShape: [1, schema.count], outputShape: [1] },
          featureDependencies,
          encoding: encodings,
          imputation: imputations,
          scaling: scalings,
          prismaSchemaHash: modelSchemaHash,
          trainingMetrics: metrics,
          dataset,
          compiledAt: new Date().toISOString(),
        };

        const metadataPath = path.join(outputDir, `${model.name}.metadata.json`);
        fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));

        modelArtifacts.push({ metadata, onnxPath: response.onnxPath });
        spinner.succeed(
          `Trained ${chalk.bold(model.name)} \u2014 estimator: ${chalk.cyan(bestEstimator)}`
        );
      }

      spinner.start('Writing artifacts...');
      spinner.succeed(`Artifacts written to ${chalk.cyan(outputDir)}`);

      console.log(chalk.green('\n[OK] Training complete\n'));
      console.log('Artifacts:');
      for (const artifact of modelArtifacts) {
        const est = artifact.metadata.bestEstimator
          ? chalk.dim(` (${artifact.metadata.bestEstimator})`)
          : '';
        console.log(`  ${chalk.dim(`${artifact.metadata.modelName}.metadata.json`)}${est}`);
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
