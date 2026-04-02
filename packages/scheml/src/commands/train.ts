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
} from '../trainingContract';
import { AnyTraitDefinition } from '../traitTypes';
import type {
  AnomalyArtifactMetadata,
  SimilarityArtifactMetadata,
  SequentialArtifactMetadata,
  GenerativeArtifactMetadata,
} from '../artifacts';
import {
  validateGenerativeTrait,
  compileGenerativeTrait,
} from '../generative';
import {
  appendHistoryRecord,
  detectAuthor,
  nextArtifactVersion,
} from '../history';

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

function isTraitDefinition(value: any): value is AnyTraitDefinition {
  return (
    value &&
    typeof value === 'object' &&
    typeof value.name === 'string' &&
    typeof value.type === 'string' &&
    ['predictive', 'anomaly', 'similarity', 'sequential', 'generative'].includes(value.type)
  );
}

const SENSITIVITY_TO_CONTAMINATION: Record<'low' | 'medium' | 'high', number> = {
  low: 0.05,
  medium: 0.1,
  high: 0.2,
};

const DEFAULT_WINDOW_SIZE = 5;
const DEFAULT_AGGREGATIONS: string[] = ['mean', 'sum', 'min', 'max'];

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
      .option('trait', {
        description: 'Train a single trait by name',
        type: 'string',
      })
      .option('python', {
        description: 'Python backend: "local"',
        type: 'string',
        default: 'local',
        choices: ['local'],
      })
      .option('json', {
        description: 'Emit structured JSON',
        type: 'boolean',
        default: false,
      });
  },
  handler: async (argv: any) => {
    const jsonMode = argv.json as boolean;
    const spinner = ora({ isSilent: jsonMode });
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
      let modelDefinitions = Object.values(configExports).filter(
        isModelDefinition
      ) as ResolvedModel[];
      let traitDefinitions = Object.values(configExports).filter(
        isTraitDefinition
      ) as AnyTraitDefinition[];

      const traitFilter = argv.trait as string | undefined;
      if (traitFilter) {
        modelDefinitions = [];
        traitDefinitions = traitDefinitions.filter((trait) => trait.name === traitFilter);
        if (traitDefinitions.length === 0) {
          throw new ModelDefinitionError(
            traitFilter,
            `Trait "${traitFilter}" not found in config`
          );
        }
      }

      if (modelDefinitions.length === 0 && traitDefinitions.length === 0) {
        throw new ModelDefinitionError('unknown', 'No models or traits exported from config');
      }

      spinner.succeed(`Loaded ${modelDefinitions.length + traitDefinitions.length} definition(s)`);

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
      for (const trait of traitDefinitions) {
        const entityName = typeof (trait as any).entity === 'string'
          ? (trait as any).entity
          : String((trait as any).entity);
        if (!prismaModels.includes(entityName)) {
          throw new ModelDefinitionError(
            trait.name,
            `Prisma model "${entityName}" not found in schema`
          );
        }
      }
      spinner.succeed('Models and traits validated');

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
        appendHistoryRecord(outputDir, {
          trait: model.name,
          model: model.modelName,
          adapter: 'prisma',
          schemaHash: modelSchemaHash,
          definedAt: new Date().toISOString(),
          definedBy: detectAuthor(),
          trainedAt: new Date().toISOString(),
          artifactVersion: nextArtifactVersion(outputDir, model.name),
          status: 'trained',
        });
      }

      // -----------------------------------------------------------------------
      // Trait training loop — anomaly / similarity / sequential
      // generative traits are compiled at build time (no Python backend)
      // -----------------------------------------------------------------------
      const traitArtifactNames: string[] = [];
      for (const trait of traitDefinitions) {
        const entityName =
          typeof (trait as any).entity === 'string'
            ? (trait as any).entity as string
            : String((trait as any).entity);
        const prismaDelegate = (prisma as any)[toCamelCase(entityName)];
        if (!prismaDelegate || typeof prismaDelegate.findMany !== 'function') {
          throw new ConfigurationError(`PrismaClient does not expose model "${entityName}"`);
        }

        if (trait.type === 'anomaly') {
          const features = trait.baseline;
          const contamination = SENSITIVITY_TO_CONTAMINATION[trait.sensitivity];
          const entities = await prismaDelegate.findMany({ orderBy: { id: 'asc' } });
          if (!entities.length) {
            throw new ConfigurationError(
              `No records found for trait "${trait.name}" (entity "${entityName}")`
            );
          }
          const X_train = entities.map((e: any) => features.map((f: string) => Number(e[f] ?? 0)));
          const datasetPath = path.join(outputDir, `${trait.name}.dataset.json`);
          fs.writeFileSync(datasetPath, JSON.stringify({ X_train, feature_names: features }));

          spinner.text = `Training anomaly trait ${trait.name}...`;
          const anomalyScript = path.resolve(__dirname, '../../python/train_anomaly.py');
          const anomResult = spawnSync(
            'python3',
            [
              anomalyScript,
              '--dataset', datasetPath,
              '--output', outputDir,
              '--model-name', trait.name,
              '--contamination', String(contamination),
            ],
            { stdio: 'pipe', encoding: 'utf-8' }
          );
          try { fs.unlinkSync(datasetPath); } catch {}
          if (anomResult.error) throw anomResult.error;
          if (anomResult.status !== 0) {
            throw new Error(anomResult.stderr || 'Python anomaly backend failed');
          }
          const anomalyResponse = JSON.parse(anomResult.stdout.trim());
          const anomalySchemaHash = hashPrismaModelSubset(schemaContent, entityName);
          const anomalyMetadata: AnomalyArtifactMetadata = {
            traitType: 'anomaly',
            traitName: trait.name,
            schemaHash: anomalySchemaHash,
            entityName,
            compiledAt: new Date().toISOString(),
            version: VERSION,
            metadataSchemaVersion: '1.0.0',
            qualityGates: trait.qualityGates,
            modelBase64: anomalyResponse.modelBase64,
            featureCount: anomalyResponse.featureCount,
            threshold: anomalyResponse.threshold,
            normalization: anomalyResponse.normalization,
            featureNames: anomalyResponse.featureNames,
            contamination: anomalyResponse.contamination,
          };
          fs.writeFileSync(
            path.join(outputDir, `${trait.name}.metadata.json`),
            JSON.stringify(anomalyMetadata, null, 2)
          );
          spinner.succeed(`Trained anomaly trait ${chalk.bold(trait.name)}`);
          traitArtifactNames.push(`${trait.name}.metadata.json`);
          appendHistoryRecord(outputDir, {
            trait: trait.name,
            model: entityName,
            adapter: 'prisma',
            schemaHash: anomalySchemaHash,
            definedAt: new Date().toISOString(),
            definedBy: detectAuthor(),
            trainedAt: new Date().toISOString(),
            artifactVersion: nextArtifactVersion(outputDir, trait.name),
            status: 'trained',
          });

        } else if (trait.type === 'similarity') {
          const features = trait.on;
          const entities = await prismaDelegate.findMany({ orderBy: { id: 'asc' } });
          if (!entities.length) {
            throw new ConfigurationError(
              `No records found for trait "${trait.name}" (entity "${entityName}")`
            );
          }
          const X_train = entities.map((e: any) => features.map((f: string) => Number(e[f] ?? 0)));
          const entityIds = entities.map((e: any) => e.id);
          const datasetPath = path.join(outputDir, `${trait.name}.dataset.json`);
          fs.writeFileSync(
            datasetPath,
            JSON.stringify({ X_train, feature_names: features, entity_ids: entityIds })
          );

          spinner.text = `Training similarity trait ${trait.name}...`;
          const simScript = path.resolve(__dirname, '../../python/train_similarity.py');
          const simResult = spawnSync(
            'python3',
            [simScript, '--dataset', datasetPath, '--output', outputDir, '--model-name', trait.name],
            { stdio: 'pipe', encoding: 'utf-8' }
          );
          try { fs.unlinkSync(datasetPath); } catch {}
          if (simResult.error) throw simResult.error;
          if (simResult.status !== 0) {
            throw new Error(simResult.stderr || 'Python similarity backend failed');
          }
          const simResponse = JSON.parse(simResult.stdout.trim());
          const simSchemaHash = hashPrismaModelSubset(schemaContent, entityName);
          const simMetadata: SimilarityArtifactMetadata = {
            traitType: 'similarity',
            traitName: trait.name,
            schemaHash: simSchemaHash,
            entityName,
            compiledAt: new Date().toISOString(),
            version: VERSION,
            metadataSchemaVersion: '1.0.0',
            qualityGates: trait.qualityGates,
            strategy: simResponse.strategy,
            entityCount: simResponse.entityCount,
            embeddingDim: simResponse.embeddingDim,
            featureNames: simResponse.featureNames,
            normalization: simResponse.normalization,
            indexFile: simResponse.indexFile,
            entityIds: simResponse.strategy === 'cosine_matrix' ? simResponse.entityIds : undefined,
            entityIdsFile: simResponse.strategy === 'faiss_ivf' ? simResponse.idsFile : undefined,
          };
          fs.writeFileSync(
            path.join(outputDir, `${trait.name}.metadata.json`),
            JSON.stringify(simMetadata, null, 2)
          );
          spinner.succeed(`Trained similarity trait ${chalk.bold(trait.name)}`);
          traitArtifactNames.push(`${trait.name}.metadata.json`);
          appendHistoryRecord(outputDir, {
            trait: trait.name,
            model: entityName,
            adapter: 'prisma',
            schemaHash: simSchemaHash,
            definedAt: new Date().toISOString(),
            definedBy: detectAuthor(),
            trainedAt: new Date().toISOString(),
            artifactVersion: nextArtifactVersion(outputDir, trait.name),
            status: 'trained',
          });

        } else if (trait.type === 'sequential') {
          const entities = await prismaDelegate.findMany({ orderBy: { [trait.orderBy]: 'asc' } });
          if (entities.length <= DEFAULT_WINDOW_SIZE) {
            throw new ConfigurationError(
              `Trait "${trait.name}": need more than ${DEFAULT_WINDOW_SIZE} records (found ${entities.length})`
            );
          }
          const seqValues: number[] = entities.map((e: any) => Number(e[trait.sequence] ?? 0));
          const allLabels = entities.map((e: any) => {
            const label = e[trait.target];
            if (typeof label === 'boolean') return label ? 1 : 0;
            return Number(label ?? 0);
          });
          const allWindows: number[][][] = [];
          const allWindowLabels: number[] = [];
          for (let i = 0; i + DEFAULT_WINDOW_SIZE < seqValues.length; i++) {
            allWindows.push(seqValues.slice(i, i + DEFAULT_WINDOW_SIZE).map((v) => [v]));
            allWindowLabels.push(allLabels[i + DEFAULT_WINDOW_SIZE]);
          }
          const splitIdx = Math.floor(allWindows.length * 0.8);
          const y_train = allWindowLabels.slice(0, splitIdx);
          const y_test = allWindowLabels.slice(splitIdx);
          const datasetPath = path.join(outputDir, `${trait.name}.dataset.json`);
          fs.writeFileSync(
            datasetPath,
            JSON.stringify({
              X_windows: allWindows,
              y_train,
              y_test,
              feature_names: [trait.sequence],
              window_size: DEFAULT_WINDOW_SIZE,
              aggregations: DEFAULT_AGGREGATIONS,
              task_type: trait.output.taskType,
              algorithm: 'automl',
              hyperparameters: {},
            })
          );

          spinner.text = `Training sequential trait ${trait.name}...`;
          const seqScript = path.resolve(__dirname, '../../python/train_sequential.py');
          const seqResult = spawnSync(
            'python3',
            [seqScript, '--dataset', datasetPath, '--output', outputDir, '--model-name', trait.name],
            { stdio: 'pipe', encoding: 'utf-8' }
          );
          try { fs.unlinkSync(datasetPath); } catch {}
          if (seqResult.error) throw seqResult.error;
          if (seqResult.status !== 0) {
            throw new Error(seqResult.stderr || 'Python sequential backend failed');
          }
          const seqResponse = JSON.parse(seqResult.stdout.trim());
          const seqSchemaHash = hashPrismaModelSubset(schemaContent, entityName);
          const seqMetadata: SequentialArtifactMetadata = {
            traitType: 'sequential',
            traitName: trait.name,
            schemaHash: seqSchemaHash,
            entityName,
            compiledAt: new Date().toISOString(),
            version: VERSION,
            metadataSchemaVersion: '1.0.0',
            qualityGates: trait.qualityGates,
            windowSize: seqResponse.windowSize,
            aggregations: seqResponse.aggregations,
            onnxFile: path.basename(seqResponse.onnxPath),
            taskType: trait.output.taskType,
            bestEstimator: seqResponse.bestEstimator,
          };
          fs.writeFileSync(
            path.join(outputDir, `${trait.name}.metadata.json`),
            JSON.stringify(seqMetadata, null, 2)
          );
          spinner.succeed(`Trained sequential trait ${chalk.bold(trait.name)}`);
          traitArtifactNames.push(`${trait.name}.metadata.json`);
          appendHistoryRecord(outputDir, {
            trait: trait.name,
            model: entityName,
            adapter: 'prisma',
            schemaHash: seqSchemaHash,
            definedAt: new Date().toISOString(),
            definedBy: detectAuthor(),
            trainedAt: new Date().toISOString(),
            artifactVersion: nextArtifactVersion(outputDir, trait.name),
            status: 'trained',
          });
        // generative: no Python backend — compile-time template validation only
        } else if (trait.type === 'generative') {
          const prismaFields = parseModelSchema(schemaContent, entityName);
          const availableFields = new Set(Object.keys(prismaFields));
          validateGenerativeTrait(trait, availableFields);
          const genSchemaHash = hashPrismaModelSubset(schemaContent, entityName);
          const genMetadata: GenerativeArtifactMetadata = {
            ...compileGenerativeTrait(trait, genSchemaHash, VERSION),
            entityName,
            qualityGates: trait.qualityGates,
          };
          fs.writeFileSync(
            path.join(outputDir, `${trait.name}.metadata.json`),
            JSON.stringify(genMetadata, null, 2)
          );
          spinner.succeed(`Compiled generative trait ${chalk.bold(trait.name)}`);
          traitArtifactNames.push(`${trait.name}.metadata.json`);
          appendHistoryRecord(outputDir, {
            trait: trait.name,
            model: entityName,
            adapter: 'prisma',
            schemaHash: genSchemaHash,
            definedAt: new Date().toISOString(),
            definedBy: detectAuthor(),
            trainedAt: new Date().toISOString(),
            artifactVersion: nextArtifactVersion(outputDir, trait.name),
            status: 'trained',
          });
        }
      }

      spinner.start('Writing artifacts...');
      spinner.succeed(`Artifacts written to ${chalk.cyan(outputDir)}`);

      if (jsonMode) {
        process.stdout.write(
          JSON.stringify({
            ok: true,
            modelCount: modelArtifacts.length,
            traitCount: traitArtifactNames.length,
            models: modelArtifacts.map((artifact) => ({
              name: artifact.metadata.modelName,
              metadataFile: `${artifact.metadata.modelName}.metadata.json`,
              onnxFile: path.basename(artifact.onnxPath),
              estimator: artifact.metadata.bestEstimator,
            })),
            traits: traitArtifactNames,
          }) + '\n'
        );
      } else {
        console.log(chalk.green('\n[OK] Training complete\n'));
        console.log('Artifacts:');
        for (const artifact of modelArtifacts) {
          const est = artifact.metadata.bestEstimator
            ? chalk.dim(` (${artifact.metadata.bestEstimator})`)
            : '';
          console.log(`  ${chalk.dim(`${artifact.metadata.modelName}.metadata.json`)}${est}`);
          console.log(`  ${chalk.dim(path.basename(artifact.onnxPath))}`);
        }
        for (const name of traitArtifactNames) {
          console.log(`  ${chalk.dim(name)}`);
        }
      }
    } catch (error) {
      if (jsonMode) {
        process.stdout.write(
          JSON.stringify({ ok: false, error: (error as Error).message, code: 'TRAIN_FAILED' }) +
            '\n'
        );
      } else {
        spinner.fail((error as Error).message);
        throw error;
      }
    } finally {
      if (prisma) {
        await prisma.$disconnect();
      }
    }
  },
};
