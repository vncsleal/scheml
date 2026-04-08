/**
 * scheml train command
 * Acts as compiler driver:
 * 1. Load model definitions
 * 2. Validate adapter schemas and feature declarations
 * 3. Resolve defaults deterministically
 * 4. Extract historical data via the configured adapter
 * 5. Split rows and fit a train-derived feature contract
 * 6. Convert train/test rows to feature vectors
 * 7. Invoke Python backend
 * 8. Evaluate quality gates
 * 9. Export ONNX + metadata
 */

import * as fs from 'fs';
import * as path from 'path';
import { spawnSync } from 'child_process';
import * as dotenv from 'dotenv';
import { Argv } from 'yargs';
import ora from 'ora';
import chalk from 'chalk';
import {
  VERSION,
} from '..';
import { ModelDefinitionError, ConfigurationError, QualityGateError } from '..';
import type {
  PredictiveArtifactMetadata,
  AnomalyArtifactMetadata,
  SimilarityArtifactMetadata,
  TemporalArtifactMetadata,
  GenerativeArtifactMetadata,
} from '../artifacts';
import { metadataFileName } from '../artifacts';
import type { QualityGate, TrainingMetrics } from '../types';
import { normalizeFeatureVector } from '../encoding';
import {
  validateGenerativeTrait,
  compileGenerativeTrait,
} from '../generative';
import { requireGenerativeProvider } from '../generativeProvider';
import {
  appendHistoryRecord,
  detectAuthor,
  nextArtifactVersion,
} from '../history';
import {
  requireTraitEntityName,
  resolveConfiguredAdapter,
  resolveSchemaPath,
} from '../adapterResolution';
import type { ScheMLAdapter } from '../adapters/interface';
import { fitTrainingContract, splitTrainingRows, type TrainingRow } from '../trainingContract';
import {
  loadConfigModule,
  normalizeConfigExports,
  resolveTraitDefinitions,
  selectTraitDefinitions,
} from './configHelpers';

const SENSITIVITY_TO_CONTAMINATION: Record<'low' | 'medium' | 'high', number> = {
  low: 0.05,
  medium: 0.1,
  high: 0.2,
};

const DEFAULT_WINDOW_SIZE = 5;
const DEFAULT_AGGREGATIONS: string[] = ['mean', 'sum', 'min', 'max'];

type TrainCommandArgs = {
  config: string;
  output: string;
  schema?: string;
  trait?: string;
  python?: string;
  json?: boolean;
};

type ExtractedEntityRow = Record<string, unknown>;

type PythonAnomalyResponse = {
  modelBase64: string;
  featureCount: number;
  threshold: number;
  normalization: AnomalyArtifactMetadata['normalization'];
  featureNames: string[];
  contamination: number;
  normScoreStats?: NonNullable<AnomalyArtifactMetadata['normScoreStats']>;
};

type PythonSimilarityResponse = {
  strategy: SimilarityArtifactMetadata['strategy'];
  entityCount: number;
  embeddingDim: number;
  featureNames: string[];
  normalization: SimilarityArtifactMetadata['normalization'];
  indexFile: string;
  entityIds?: unknown[];
  idsFile?: string;
};

type PythonTemporalResponse = {
  expandedFeatureNames?: string[];
  windowSize: number;
  aggregations: TemporalArtifactMetadata['aggregations'];
  onnxPath: string;
  bestEstimator?: string;
  metrics: NonNullable<TemporalArtifactMetadata['trainingMetrics']>;
};

type PythonPredictiveResponse = {
  metrics: PredictiveArtifactMetadata['trainingMetrics'];
  onnxPath: string;
  bestEstimator: string;
};

export function evaluateQualityGates(
  modelName: string,
  qualityGates: QualityGate[] | undefined,
  metrics: TrainingMetrics[] | undefined,
): Record<string, { threshold: number; result: number }> | undefined {
  if (!qualityGates?.length) {
    return undefined;
  }

  if (!metrics?.length) {
    throw new ConfigurationError(
      `Trait "${modelName}" declares quality gates, but the training backend did not report metrics to evaluate.`
    );
  }

  const results: Record<string, { threshold: number; result: number }> = {};

  for (const gate of qualityGates) {
    const metric = metrics.find((entry) => entry.metric === gate.metric && entry.split === 'test')
      ?? metrics.find((entry) => entry.metric === gate.metric);

    if (!metric) {
      throw new ConfigurationError(
        `Trait "${modelName}" declares a quality gate for "${gate.metric}", but the training backend did not report that metric.`
      );
    }

    results[gate.metric] = {
      threshold: gate.threshold,
      result: metric.value,
    };

    const passed = gate.comparison === 'gte'
      ? metric.value >= gate.threshold
      : metric.value <= gate.threshold;

    if (!passed) {
      throw new QualityGateError(
        modelName,
        gate.metric,
        gate.threshold,
        metric.value,
        gate.comparison
      );
    }
  }

  return results;
}

function getNumericField(row: ExtractedEntityRow, field: string): number {
  return Number(row[field] ?? 0);
}

function getEntityId(row: ExtractedEntityRow, traitName: string): unknown {
  if (!Object.prototype.hasOwnProperty.call(row, 'id')) {
    throw new ConfigurationError(`Trait "${traitName}" requires extracted rows to include an id field`);
  }

  return row.id;
}

function getPredictiveFeatureValue(
  entity: ExtractedEntityRow,
  featureName: string,
  featureResolver?: (entity: ExtractedEntityRow) => unknown,
): unknown {
  if (!featureResolver) {
    return entity[featureName];
  }

  try {
    return featureResolver(entity);
  } catch (error) {
    throw new ConfigurationError(
      `Feature resolver for "${featureName}" failed: ${(error as Error).message}`
    );
  }
}

function getPredictiveLabelValue(
  entity: ExtractedEntityRow,
  traitName: string,
  target: string,
  labelResolver?: (entity: ExtractedEntityRow) => unknown,
): number | string | boolean {
  const label = labelResolver ? labelResolver(entity) : entity[target];
  if (typeof label === 'number' || typeof label === 'string' || typeof label === 'boolean') {
    return label;
  }

  throw new ConfigurationError(
    `Trait "${traitName}" requires scalar labels. Received ${label === null ? 'null' : typeof label} for target "${target}"`
  );
}

function compactDefinedRecord<T>(record: Record<string, T | undefined>): Record<string, T> {
  return Object.fromEntries(
    Object.entries(record).filter((entry): entry is [string, T] => entry[1] !== undefined)
  );
}

function parsePythonResponse<T>(stdout: string, backendName: string): T {
  try {
    return JSON.parse(stdout.trim()) as T;
  } catch {
    throw new Error(`${backendName} returned invalid JSON: ${stdout.slice(0, 200)}`);
  }
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
        description: 'Path to schema source file (overrides scheml.config.ts schema field)',
        type: 'string',
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
  handler: async (argv: TrainCommandArgs) => {
    const jsonMode = argv.json as boolean;
    const spinner = ora({ isSilent: jsonMode });
    let adapterRef: ScheMLAdapter | null = null;

    try {
      dotenv.config();

      const configPath = path.resolve(argv.config);
      const outputPath = path.resolve(argv.output);

      if (!fs.existsSync(outputPath)) {
        fs.mkdirSync(outputPath, { recursive: true });
      }

      // 1. Load model definitions
      spinner.start('Loading model definitions...');

      const configModule = await loadConfigModule(configPath);
      const configExports = normalizeConfigExports(configModule);
      let traitDefinitions = resolveTraitDefinitions(configExports);

      const traitFilter = argv.trait as string | undefined;
      if (traitFilter) {
        try {
          traitDefinitions = selectTraitDefinitions(traitDefinitions, traitFilter, {
            includeDependencies: true,
          });
        } catch (error) {
          throw new ModelDefinitionError(traitFilter, (error as Error).message);
        }
      }

      if (traitDefinitions.length === 0) {
        throw new ModelDefinitionError('unknown', 'No traits exported from config');
      }

      spinner.succeed(`Loaded ${traitDefinitions.length} definition(s)`);

      // Resolve adapter from config
      const configAdapter = (configExports as { adapter?: unknown }).adapter;
      const schemaSource = resolveSchemaPath((configExports as { schema?: unknown }).schema, argv.schema);
      if (!schemaSource && typeof configAdapter === 'string') {
        throw new ConfigurationError(
          'Schema path not configured. Set schema in scheml.config.ts or pass --schema <path>.'
        );
      }
      const schemaPath = schemaSource ? path.resolve(schemaSource) : undefined;

      const adapter = resolveConfiguredAdapter(configAdapter);
      const adapterName = adapter.name;
      if (!adapter.extractor) {
        throw new ConfigurationError(
          `Adapter "${adapterName}" does not support data extraction. Training requires an adapter with data extraction capability.`
        );
      }
      adapterRef = adapter;

      // 2. Load schema via adapter
      spinner.start('Loading schema...');
      const graph = await adapter.reader.readSchema(schemaPath ?? '');
      spinner.succeed('Schema loaded');

      // 3. Verify Python environment before doing any heavy work
      spinner.start('Checking Python environment...');
      checkPythonEnvironment();
      spinner.succeed('Python environment OK');

      // 4. Create output directory
      const outputDir = path.resolve(argv.output);
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
      }

      // 5. Validate traits against schema graph
      spinner.start('Validating traits...');

      for (const trait of traitDefinitions) {
        const entityName = requireTraitEntityName(trait, adapterName);
        if (!graph.entities.has(entityName)) {
          throw new ModelDefinitionError(
            trait.name,
            `Entity "${entityName}" not found in schema`
          );
        }
      }
      spinner.succeed('Traits validated');

      // 6. Extract training data and train
      spinner.start('Extracting training data...');

      // -----------------------------------------------------------------------
      // Trait training loop — anomaly / similarity / temporal
      // generative traits are compiled at build time (no Python backend)
      // -----------------------------------------------------------------------
      const traitArtifactNames: string[] = [];
      for (const trait of traitDefinitions) {
        const entityName = requireTraitEntityName(trait, adapterName);

        if (trait.type === 'predictive') {
          const entities = await adapter.extractor.extract(entityName, { orderBy: 'id' });
          if (!entities.length) {
            throw new ConfigurationError(
              `No records found for trait "${trait.name}" (entity "${entityName}")`
            );
          }

          const allRows: TrainingRow[] = entities.map((entity) => ({
            features: Object.fromEntries(
              trait.features.map((featureName) => [
                featureName,
                getPredictiveFeatureValue(
                  entity,
                  String(featureName),
                  trait.featureResolvers?.[String(featureName)] as
                    | ((entity: ExtractedEntityRow) => unknown)
                    | undefined,
                ),
              ])
            ),
            label: getPredictiveLabelValue(
              entity,
              trait.name,
              String(trait.target),
              trait.output.resolver as ((entity: ExtractedEntityRow) => unknown) | undefined,
            ),
          }));

          const { trainRows, testRows } = splitTrainingRows(allRows, 42, 0.2);
          const featureNames = trait.features.map((featureName) => String(featureName));
          const contract = fitTrainingContract(
            trait.name,
            featureNames,
            trainRows,
            allRows,
          );
          const X_train = trainRows.map((row) =>
            normalizeFeatureVector(
              row.features,
              contract.schema,
              contract.encodings,
              contract.imputations,
              contract.scalings,
            )
          );
          const X_test = testRows.map((row) =>
            normalizeFeatureVector(
              row.features,
              contract.schema,
              contract.encodings,
              contract.imputations,
              contract.scalings,
            )
          );
          const y_train = trainRows.map((row) => row.label);
          const y_test = testRows.map((row) => row.label);

          const datasetPath = path.join(outputDir, `${trait.name}.dataset.json`);
          fs.writeFileSync(
            datasetPath,
            JSON.stringify({
              X_train,
              y_train,
              X_test,
              y_test,
              taskType: trait.output.taskType,
              algorithm: trait.algorithm?.name ?? 'automl',
              hyperparameters: trait.algorithm?.hyperparameters ?? {},
            })
          );

          spinner.text = `Training predictive trait ${trait.name}...`;
          const predictiveScript = path.resolve(__dirname, '../../python/train.py');
          const predictiveResult = spawnSync(
            'python3',
            [
              predictiveScript,
              '--dataset', datasetPath,
              '--output', outputDir,
              '--model-name', trait.name,
            ],
            { stdio: 'pipe', encoding: 'utf-8' }
          );
          fs.rmSync(datasetPath, { force: true });
          if (predictiveResult.error) throw predictiveResult.error;
          if (predictiveResult.status !== 0) {
            throw new Error(predictiveResult.stderr || 'Python predictive backend failed');
          }

          const predictiveResponse = parsePythonResponse<PythonPredictiveResponse>(
            predictiveResult.stdout,
            'Python predictive backend'
          );
          const predictiveQualityGateResults = evaluateQualityGates(
            trait.name,
            trait.qualityGates,
            predictiveResponse.metrics,
          );
          const predictiveSchemaHash = adapter.reader.hashModel(graph, entityName);
          const predictiveMetadata: PredictiveArtifactMetadata = {
            traitType: 'predictive',
            artifactFormat: 'onnx',
            traitName: trait.name,
            schemaHash: predictiveSchemaHash,
            entityName,
            compiledAt: new Date().toISOString(),
            version: VERSION,
            metadataSchemaVersion: '1.0.0',
            qualityGates: trait.qualityGates,
            taskType: trait.output.taskType,
            bestEstimator: predictiveResponse.bestEstimator,
            features: contract.schema,
            output: { field: trait.output.field, shape: [1] },
            tensorSpec: {
              inputShape: [1, contract.schema.count],
              outputShape: [1],
            },
            featureDependencies: featureNames.map((featureName) => {
              const field = graph.entities.get(entityName)?.fields[featureName];
              return {
                modelName: entityName,
                path: `${entityName}.${featureName}`,
                scalarType: field?.scalarType ?? 'unknown',
                nullable: field?.nullable ?? true,
                encoding: contract.encodings[featureName],
                extractable: !trait.featureResolvers?.[featureName],
              };
            }),
            encoding: compactDefinedRecord(contract.encodings),
            imputation: compactDefinedRecord(contract.imputations),
            scaling: compactDefinedRecord(contract.scalings),
            trainingMetrics: predictiveResponse.metrics,
            dataset: {
              size: allRows.length,
              splitSeed: 42,
              trainSize: trainRows.length,
              testSize: testRows.length,
              materializedAt: new Date().toISOString(),
            },
            onnxFile: path.basename(predictiveResponse.onnxPath),
          };
          fs.writeFileSync(
            path.join(outputDir, metadataFileName(trait.name)),
            JSON.stringify(predictiveMetadata, null, 2)
          );
          spinner.succeed(`Trained predictive trait ${chalk.bold(trait.name)}`);
          traitArtifactNames.push(metadataFileName(trait.name));
          appendHistoryRecord(outputDir, {
            trait: trait.name,
            model: entityName,
            adapter: adapterName,
            schemaHash: predictiveSchemaHash,
            definedAt: new Date().toISOString(),
            definedBy: detectAuthor(),
            trainedAt: new Date().toISOString(),
            artifactVersion: nextArtifactVersion(outputDir, trait.name),
            qualityGates: predictiveQualityGateResults,
            status: 'trained',
          });

        } else if (trait.type === 'anomaly') {
          if (trait.qualityGates?.length) {
            throw new ConfigurationError(
              `Trait "${trait.name}" declares quality gates, but anomaly training does not report evaluable metrics yet.`
            );
          }
          const features = trait.baseline;
          const contamination = SENSITIVITY_TO_CONTAMINATION[trait.sensitivity];
          const entities = await adapter.extractor.extract(entityName, { orderBy: 'id' });
          if (!entities.length) {
            throw new ConfigurationError(
              `No records found for trait "${trait.name}" (entity "${entityName}")`
            );
          }
          const X_train = entities.map((entity) => features.map((feature) => getNumericField(entity, feature)));
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
          fs.rmSync(datasetPath, { force: true });
          if (anomResult.error) throw anomResult.error;
          if (anomResult.status !== 0) {
            throw new Error(anomResult.stderr || 'Python anomaly backend failed');
          }
          const anomalyResponse = parsePythonResponse<PythonAnomalyResponse>(
            anomResult.stdout,
            'Python anomaly backend'
          );
          const anomalySchemaHash = adapter.reader.hashModel(graph, entityName);
          const anomalyMetadata: AnomalyArtifactMetadata = {
            traitType: 'anomaly',
            artifactFormat: 'onnx',
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
            normScoreStats: anomalyResponse.normScoreStats,
          };
          fs.writeFileSync(
            path.join(outputDir, metadataFileName(trait.name)),
            JSON.stringify(anomalyMetadata, null, 2)
          );
          spinner.succeed(`Trained anomaly trait ${chalk.bold(trait.name)}`);
          traitArtifactNames.push(metadataFileName(trait.name));
          appendHistoryRecord(outputDir, {
            trait: trait.name,
            model: entityName,
            adapter: adapterName,
            schemaHash: anomalySchemaHash,
            definedAt: new Date().toISOString(),
            definedBy: detectAuthor(),
            trainedAt: new Date().toISOString(),
            artifactVersion: nextArtifactVersion(outputDir, trait.name),
            status: 'trained',
          });

        } else if (trait.type === 'similarity') {
          if (trait.qualityGates?.length) {
            throw new ConfigurationError(
              `Trait "${trait.name}" declares quality gates, but similarity training does not report evaluable metrics yet.`
            );
          }
          const features = trait.on;
          const entities = await adapter.extractor.extract(entityName, { orderBy: 'id' });
          if (!entities.length) {
            throw new ConfigurationError(
              `No records found for trait "${trait.name}" (entity "${entityName}")`
            );
          }
          const X_train = entities.map((entity) => features.map((feature) => getNumericField(entity, feature)));
          const entityIds = entities.map((entity) => getEntityId(entity, trait.name));
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
          fs.rmSync(datasetPath, { force: true });
          if (simResult.error) throw simResult.error;
          if (simResult.status !== 0) {
            throw new Error(simResult.stderr || 'Python similarity backend failed');
          }
          const simResponse = parsePythonResponse<PythonSimilarityResponse>(
            simResult.stdout,
            'Python similarity backend'
          );
          const simSchemaHash = adapter.reader.hashModel(graph, entityName);
          const simMetadata: SimilarityArtifactMetadata = {
            traitType: 'similarity',
            artifactFormat: simResponse.strategy === 'faiss_ivf' ? 'faiss' : 'npy',
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
            path.join(outputDir, metadataFileName(trait.name)),
            JSON.stringify(simMetadata, null, 2)
          );
          spinner.succeed(`Trained similarity trait ${chalk.bold(trait.name)}`);
          traitArtifactNames.push(metadataFileName(trait.name));
          appendHistoryRecord(outputDir, {
            trait: trait.name,
            model: entityName,
            adapter: adapterName,
            schemaHash: simSchemaHash,
            definedAt: new Date().toISOString(),
            definedBy: detectAuthor(),
            trainedAt: new Date().toISOString(),
            artifactVersion: nextArtifactVersion(outputDir, trait.name),
            status: 'trained',
          });

        } else if (trait.type === 'temporal') {
          const entities = await adapter.extractor.extract(entityName, { orderBy: trait.orderBy });
          if (entities.length <= DEFAULT_WINDOW_SIZE) {
            throw new ConfigurationError(
              `Trait "${trait.name}": need more than ${DEFAULT_WINDOW_SIZE} records (found ${entities.length})`
            );
          }
          const seqValues: number[] = entities.map((entity) => getNumericField(entity, trait.sequence));
          const allLabels = entities.map((entity) => {
            const label = entity[trait.target];
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
              algorithm: trait.algorithm?.name ?? 'automl',
              hyperparameters: trait.algorithm?.hyperparameters ?? {},
            })
          );

          spinner.text = `Training temporal trait ${trait.name}...`;
          const seqScript = path.resolve(__dirname, '../../python/train_temporal.py');
          const seqResult = spawnSync(
            'python3',
            [seqScript, '--dataset', datasetPath, '--output', outputDir, '--model-name', trait.name],
            { stdio: 'pipe', encoding: 'utf-8' }
          );
          fs.rmSync(datasetPath, { force: true });
          if (seqResult.error) throw seqResult.error;
          if (seqResult.status !== 0) {
            throw new Error(seqResult.stderr || 'Python temporal backend failed');
          }
          const seqResponse = parsePythonResponse<PythonTemporalResponse>(
            seqResult.stdout,
            'Python temporal backend'
          );
          const temporalQualityGateResults = evaluateQualityGates(
            trait.name,
            trait.qualityGates,
            seqResponse.metrics,
          );
          const seqSchemaHash = adapter.reader.hashModel(graph, entityName);
          // Build FeatureSchema from the expanded feature names returned by Python
          const expandedNames: string[] = seqResponse.expandedFeatureNames ?? [];
          const seqFeatures = expandedNames.length > 0
            ? {
                features: expandedNames.map((name: string, idx: number) => ({
                  name,
                  index: idx,
                  columnCount: 1,
                  originalType: 'number' as const,
                  imputation: { strategy: 'constant' as const, value: 0 },
                })),
                count: expandedNames.length,
                order: expandedNames,
              }
            : undefined;
          const seqMetadata: TemporalArtifactMetadata = {
            traitType: 'temporal',
            artifactFormat: 'onnx',
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
            features: seqFeatures,
            output: { field: trait.output.field, shape: [1] },
            tensorSpec: {
              inputShape: [1, seqFeatures?.count ?? 0],
              outputShape: [1],
            },
            trainingMetrics: seqResponse.metrics,
          };
          fs.writeFileSync(
            path.join(outputDir, metadataFileName(trait.name)),
            JSON.stringify(seqMetadata, null, 2)
          );
          spinner.succeed(`Trained temporal trait ${chalk.bold(trait.name)}`);
          traitArtifactNames.push(metadataFileName(trait.name));
          appendHistoryRecord(outputDir, {
            trait: trait.name,
            model: entityName,
            adapter: adapterName,
            schemaHash: seqSchemaHash,
            definedAt: new Date().toISOString(),
            definedBy: detectAuthor(),
            trainedAt: new Date().toISOString(),
            artifactVersion: nextArtifactVersion(outputDir, trait.name),
            qualityGates: temporalQualityGateResults,
            status: 'trained',
          });
        // generative: no Python backend — compile-time template validation only
        } else if (trait.type === 'generative') {
          if (trait.qualityGates?.length) {
            throw new ConfigurationError(
              `Trait "${trait.name}" declares quality gates, but generative trait compilation does not report evaluable metrics.`
            );
          }
          requireGenerativeProvider(trait.name, configExports.generativeProvider);
          const availableFields = new Set(Object.keys(graph.entities.get(entityName)?.fields ?? {}));
          validateGenerativeTrait(trait, availableFields);
          const genSchemaHash = adapter.reader.hashModel(graph, entityName);
          const genMetadata: GenerativeArtifactMetadata = {
            ...compileGenerativeTrait(trait, genSchemaHash, VERSION),
            entityName,
            qualityGates: trait.qualityGates,
          };
          fs.writeFileSync(
            path.join(outputDir, metadataFileName(trait.name)),
            JSON.stringify(genMetadata, null, 2)
          );
          spinner.succeed(`Compiled generative trait ${chalk.bold(trait.name)}`);
          traitArtifactNames.push(metadataFileName(trait.name));
          appendHistoryRecord(outputDir, {
            trait: trait.name,
            model: entityName,
            adapter: adapterName,
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
      // Copy the schema source alongside the artifacts so runtime drift checks
      // always use the same schema that was active at train time.
      if (schemaPath && fs.existsSync(schemaPath)) {
        fs.copyFileSync(schemaPath, path.join(outputDir, 'schema.source'));
      } else if (graph.rawSource) {
        fs.writeFileSync(path.join(outputDir, 'schema.source'), graph.rawSource, 'utf-8');
      }
      spinner.succeed(`Artifacts written to ${chalk.cyan(outputDir)}`);

      if (jsonMode) {
        process.stdout.write(
          JSON.stringify({
            ok: true,
            traitCount: traitArtifactNames.length,
            traits: traitArtifactNames,
          }) + '\n'
        );
      } else {
        console.log(chalk.green('\n[OK] Training complete\n'));
        console.log('Artifacts:');
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
      await adapterRef?.extractor?.disconnect?.();
    }
  },
};
