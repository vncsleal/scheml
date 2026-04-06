/**
 * ONNX Runtime Prediction Engine
 * Manages model sessions and deterministic predictions
 */

import * as fs from 'fs';
import * as path from 'path';
import { spawnSync } from 'child_process';
import * as ort from 'onnxruntime-node';
import {
  ModelMetadata,
  PredictionOutput,
  BatchPredictionResult,
  FeatureSchema,
  ExtractedFeatures,
  AnomalyPredictionOutput,
  GenerativePredictionOutput,
  SimilarityPredictionOutput,
  SimilarityMatch,
} from './types';
import { normalizeFeatureVector } from './encoding';
import {
  SchemaDriftError,
  ArtifactError,
  HydrationError,
  FeatureExtractionError,
  ONNXRuntimeError,
} from './errors';
import { computeSchemaHashForMetadata } from './contracts';
import type { GenerativeTrait } from './traitTypes';
import { detectOutputSchemaShape } from './generative';
import type { ScheMLAdapter } from './adapters/interface';
import { resolveConfiguredAdapter } from './adapterResolution';
import {
  isPredictiveArtifact,
  isAnomalyArtifact,
  isSimilarityArtifact,
  isTemporalArtifact,
  parseArtifactMetadata,
  type ArtifactMetadata,
  type AnomalyArtifactMetadata,
  type SimilarityArtifactMetadata,
} from './artifacts';

type LoadedSimilarityArtifact = {
  metadata: SimilarityArtifactMetadata;
  metadataPath: string;
  indexPath: string;
  entityIds: unknown[];
  embeddings?: {
    data: Float32Array;
    rows: number;
    cols: number;
  };
};

type SchemaHashMetadata = Pick<ModelMetadata, 'modelName' | 'featureDependencies'> & {
  entityName?: string;
};

type EntityResolver<T> = (entity: T) => unknown;

type AiModuleLike = {
  generateText(args: { model: unknown; prompt: string }): Promise<{ text: string }>;
  generateObject(args:
    | { model: unknown; output: 'enum'; enum: string[]; prompt: string }
    | { model: unknown; schema: unknown; prompt: string }
  ): Promise<{ object: unknown }>;
};

function buildFeatureSchema(names: string[]): FeatureSchema {
  return {
    features: names.map((name, index) => ({
      name,
      index,
      columnCount: 1,
      originalType: 'number',
    })),
    count: names.length,
    order: names,
  };
}

function l2Norm(values: number[]): number {
  return Math.sqrt(values.reduce((sum, value) => sum + value * value, 0));
}

function sigmoid(value: number): number {
  return 1 / (1 + Math.exp(-value));
}

function l2Normalize(values: number[]): number[] {
  const norm = l2Norm(values);
  if (norm === 0) {
    return values.map(() => 0);
  }
  return values.map((value) => value / norm);
}

function dotProduct(vectorA: number[], vectorB: ArrayLike<number>, offset = 0): number {
  let sum = 0;
  for (let index = 0; index < vectorA.length; index++) {
    sum += vectorA[index] * vectorB[offset + index];
  }
  return sum;
}

function normalizeNumericFeatures(values: number[], means: number[], stds: number[]): number[] {
  return values.map((value, index) => {
    const mean = means[index] ?? 0;
    const std = stds[index] && stds[index] > 0 ? stds[index] : 1;
    return (value - mean) / std;
  });
}

function parseNpyHeaderShape(header: string): number[] {
  const shapeMatch = header.match(/'shape':\s*\(([^\)]*)\)/);
  if (!shapeMatch) {
    throw new Error('NPY header missing shape');
  }

  return shapeMatch[1]
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .map((part) => Number(part))
    .filter((value) => Number.isFinite(value));
}

function loadNpyFloat32Matrix(filePath: string): { data: Float32Array; rows: number; cols: number } {
  const buffer = fs.readFileSync(filePath);
  if (buffer.length < 10 || buffer[0] !== 0x93 || buffer.toString('ascii', 1, 6) !== 'NUMPY') {
    throw new Error(`Invalid NPY file: ${filePath}`);
  }

  const majorVersion = buffer[6];
  const minorVersion = buffer[7];
  if (!((majorVersion === 1 || majorVersion === 2) && minorVersion === 0)) {
    throw new Error(`Unsupported NPY version ${majorVersion}.${minorVersion}`);
  }

  const headerLength = majorVersion === 1 ? buffer.readUInt16LE(8) : buffer.readUInt32LE(8);
  const headerOffset = majorVersion === 1 ? 10 : 12;
  const dataOffset = headerOffset + headerLength;
  const header = buffer.toString('latin1', headerOffset, dataOffset).trim();

  if (!header.includes("'descr': '<f4'")) {
    throw new Error(`Unsupported NPY dtype in ${filePath}; expected little-endian float32`);
  }
  if (!header.includes("'fortran_order': False")) {
    throw new Error(`Unsupported NPY layout in ${filePath}; expected C-order array`);
  }

  const shape = parseNpyHeaderShape(header);
  if (shape.length !== 2) {
    throw new Error(`Expected a 2D NPY matrix in ${filePath}`);
  }

  const [rows, cols] = shape;
  const byteLength = rows * cols * Float32Array.BYTES_PER_ELEMENT;
  if (dataOffset + byteLength > buffer.length) {
    throw new Error(`Truncated NPY payload in ${filePath}`);
  }

  const data = new Float32Array(buffer.buffer.slice(buffer.byteOffset + dataOffset, buffer.byteOffset + dataOffset + byteLength));
  return { data, rows, cols };
}

function toRuntimeMetadata(metadata: ArtifactMetadata): ModelMetadata | null {
  if (isPredictiveArtifact(metadata)) {
    return {
      version: metadata.version,
      metadataSchemaVersion: metadata.metadataSchemaVersion,
      modelName: metadata.traitName,
      taskType: metadata.taskType,
      bestEstimator: metadata.bestEstimator,
      features: metadata.features,
      output: metadata.output,
      encoding: metadata.encoding,
      imputation: metadata.imputation,
      scaling: metadata.scaling,
      featureDependencies: metadata.featureDependencies,
      tensorSpec: metadata.tensorSpec,
      schemaHash: metadata.schemaHash,
      trainingMetrics: metadata.trainingMetrics,
      dataset: metadata.dataset,
      compiledAt: metadata.compiledAt,
    };
  }

  if (isTemporalArtifact(metadata)) {
    if (!metadata.taskType || !metadata.features || !metadata.output) {
      return null;
    }

    return {
      version: metadata.version,
      metadataSchemaVersion: metadata.metadataSchemaVersion,
      modelName: metadata.traitName,
      taskType: metadata.taskType,
      bestEstimator: metadata.bestEstimator,
      features: metadata.features,
      output: metadata.output,
      encoding: metadata.encoding ?? {},
      imputation: metadata.imputation ?? {},
      scaling: metadata.scaling ?? {},
      featureDependencies: metadata.featureDependencies,
      tensorSpec: metadata.tensorSpec,
      schemaHash: metadata.schemaHash,
      trainingMetrics: metadata.trainingMetrics,
      dataset: metadata.dataset,
      compiledAt: metadata.compiledAt,
    };
  }

  return null;
}

function toSchemaHashMetadata(metadata: ArtifactMetadata): SchemaHashMetadata {
  return {
    modelName: metadata.traitName,
    featureDependencies: 'featureDependencies' in metadata ? metadata.featureDependencies : undefined,
    entityName: metadata.entityName,
  };
}

function isNumberArrayLike(value: unknown): value is ArrayLike<number> {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as { length?: unknown };
  if (typeof candidate.length !== 'number') {
    return false;
  }

  return Array.from(value as ArrayLike<unknown>).every((item) => typeof item === 'number');
}

function readNumericTensorData(
  outputTensor: ort.Tensor,
  modelName: string,
  outputName: string
): number[] {
  const tensorData = (outputTensor as { data?: unknown }).data;
  if (!isNumberArrayLike(tensorData)) {
    throw new ONNXRuntimeError(
      modelName,
      `ONNX output "${outputName}" did not contain numeric tensor data`
    );
  }

  return Array.from(tensorData);
}

function getEntityFieldValue(entity: unknown, field: string): unknown {
  if (!entity || typeof entity !== 'object') {
    return undefined;
  }

  return (entity as Record<string, unknown>)[field];
}

/**
 * Loads and caches ONNX model metadata
 */
export class ModelMetadataLoader {
  private cache: Map<string, ModelMetadata> = new Map();
  private artifactCache: Map<string, ArtifactMetadata> = new Map();

  loadArtifactMetadata(metadataPath: string): ArtifactMetadata {
    if (this.artifactCache.has(metadataPath)) {
      return this.artifactCache.get(metadataPath)!;
    }

    const content = fs.readFileSync(metadataPath, 'utf-8');
    let artifact: ArtifactMetadata | null;

    try {
      artifact = parseArtifactMetadata(JSON.parse(content));
    } catch (error) {
      throw new ArtifactError(
        'unknown',
        `Invalid metadata JSON: ${(error as Error).message}`
      );
    }

    if (!artifact) {
      throw new ArtifactError('unknown', 'Metadata is not a supported artifact');
    }

    this.artifactCache.set(metadataPath, artifact);
    return artifact;
  }

  loadMetadata(metadataPath: string): ModelMetadata {
    if (this.cache.has(metadataPath)) {
      return this.cache.get(metadataPath)!;
    }

    const artifact = this.loadArtifactMetadata(metadataPath);
    const metadata = toRuntimeMetadata(artifact);

    if (!metadata) {
      throw new ArtifactError('unknown', 'Metadata is not a supported ONNX-backed artifact');
    }

    this.validateMetadata(metadata);
    this.cache.set(metadataPath, metadata);

    return metadata;
  }

  private validateMetadata(metadata: ModelMetadata): void {
    if (!metadata.modelName || !metadata.taskType) {
      throw new ArtifactError(
        'unknown',
        'Metadata missing required fields: modelName, taskType'
      );
    }

    if (!metadata.schemaHash) {
      throw new ArtifactError(
        metadata.modelName,
        'Metadata missing schema hash'
      );
    }

    if (!metadata.features || !metadata.features.order || metadata.features.order.length === 0) {
      throw new ArtifactError(
        metadata.modelName,
        'Metadata has no features defined'
      );
    }
  }
}

/**
 * Feature extractor: resolves features from entities
 */
export class FeatureExtractor {
  extract<T>(
    entity: T,
    resolvers: Record<string, (e: T) => unknown>,
    schema: FeatureSchema
  ): ExtractedFeatures {
    const values: unknown[] = [];

    for (const featureName of schema.order) {
      const resolver = resolvers[featureName];

      if (!resolver) {
        throw new FeatureExtractionError(
          'unknown',
          featureName,
          `No resolver defined`
        );
      }

      try {
        const value = resolver(entity);
        values.push(value);
      } catch (error) {
        throw new FeatureExtractionError(
          'unknown',
          featureName,
          `Resolver threw: ${(error as Error).message}`
        );
      }
    }

    return {
      values,
      featureNames: schema.order,
    };
  }
}

/**
 * ONNX Runtime prediction session manager
 */
export class PredictionSession {
  private metadataLoader = new ModelMetadataLoader();
  private featureExtractor = new FeatureExtractor();
  private sessions: Map<string, ort.InferenceSession> = new Map();
  private metadata: Map<string, ModelMetadata> = new Map();
  private anomalyMetadata: Map<string, AnomalyArtifactMetadata> = new Map();
  private similarityArtifacts: Map<string, LoadedSimilarityArtifact> = new Map();

  /**
   * Initialize a model for predictions using explicit paths.
   */
  async initializeModel(
    metadataPath: string,
    onnxPath: string,
    schemaHash: string
  ): Promise<void> {
    const metadata = this.metadataLoader.loadMetadata(metadataPath);

    if (metadata.schemaHash !== schemaHash) {
      throw new SchemaDriftError(metadata.schemaHash, schemaHash);
    }

    this.metadata.set(metadata.modelName, metadata);

    const session = await ort.InferenceSession.create(onnxPath);
    this.sessions.set(metadata.modelName, session);
  }

  /**
   * Load a trained trait artifact from disk.
   *
   * Works for all ONNX-backed trait types: `temporal`, and `predictive`.
   * The artifact's own `schemaHash` is compared against the current schema to
   * detect drift without requiring the caller to specify a hash algorithm.
   * Callers must provide an explicit adapter so runtime loading stays aligned
   * with the package's adapter-agnostic contract.
   *
   * @example
   * ```ts
   * const session = new PredictionSession();
   * await session.loadTrait('engagementSequence', { artifactsDir, schemaPath, adapter: 'prisma' });
   * const result = await session.predict('engagementSequence', entity, resolvers);
   * ```
   */
  async loadTrait(
    traitName: string,
    opts?: { artifactsDir?: string; schemaPath?: string; adapter?: string | ScheMLAdapter }
  ): Promise<void> {
    const dir = opts?.artifactsDir ?? path.resolve(process.cwd(), '.scheml');
    if (!opts?.adapter) {
      throw new Error(
        'adapter is required. Pass opts.adapter to session.loadTrait().'
      );
    }
    const schemaFilePath = opts?.schemaPath ? path.resolve(opts.schemaPath) : '';
    const metadataPath = path.resolve(dir, `${traitName}.metadata.json`);
    const adapterImpl = resolveConfiguredAdapter(opts.adapter);
    const graph = await adapterImpl.reader.readSchema(schemaFilePath);
    const artifact = this.metadataLoader.loadArtifactMetadata(metadataPath);
    const hash = computeSchemaHashForMetadata(graph, toSchemaHashMetadata(artifact), adapterImpl.reader);

    if (artifact.schemaHash !== hash) {
      throw new SchemaDriftError(artifact.schemaHash, hash);
    }

    if (isPredictiveArtifact(artifact) || isTemporalArtifact(artifact)) {
      const meta = this.metadataLoader.loadMetadata(metadataPath);
      const onnxFile = (meta as { onnxFile?: string }).onnxFile ?? `${traitName}.onnx`;
      const onnxPath = path.resolve(dir, onnxFile);
      await this.initializeModel(metadataPath, onnxPath, hash);
      return;
    }

    if (isAnomalyArtifact(artifact)) {
      this.anomalyMetadata.set(artifact.traitName, artifact);
      return;
    }

    if (isSimilarityArtifact(artifact)) {
      const indexPath = path.resolve(path.dirname(metadataPath), artifact.indexFile);
      if (!fs.existsSync(indexPath)) {
        throw new ArtifactError(artifact.traitName, `Similarity index file not found: ${artifact.indexFile}`);
      }
      const entityIds = artifact.entityIds ?? (() => {
        if (!artifact.entityIdsFile) {
          throw new ArtifactError(artifact.traitName, 'Similarity metadata missing entityIds/entityIdsFile');
        }
        const idsPath = path.resolve(path.dirname(metadataPath), artifact.entityIdsFile);
        if (!fs.existsSync(idsPath)) {
          throw new ArtifactError(artifact.traitName, `Similarity ids file not found: ${artifact.entityIdsFile}`);
        }
        return JSON.parse(fs.readFileSync(idsPath, 'utf-8')) as unknown[];
      })();

      const loaded: LoadedSimilarityArtifact = {
        metadata: artifact,
        metadataPath,
        indexPath,
        entityIds,
      };

      if (artifact.artifactFormat === 'npy') {
        loaded.embeddings = loadNpyFloat32Matrix(indexPath);
      }

      this.similarityArtifacts.set(artifact.traitName, loaded);
      return;
    }

    throw new ArtifactError(artifact.traitName, `Trait type "${artifact.traitType}" is not supported by loadTrait()`);
  }

  private extractNumericFeatures<T>(
    modelName: string,
    entity: T,
    resolvers: Record<string, EntityResolver<T>>,
    featureNames: string[]
  ): number[] {
    const extracted = this.featureExtractor.extract(entity, resolvers, buildFeatureSchema(featureNames));
    return extracted.values.map((value, index) => {
      const numericValue = Number(value);
      if (!Number.isFinite(numericValue)) {
        throw new FeatureExtractionError(
          modelName,
          featureNames[index] ?? `feature_${index}`,
          `Expected numeric value, got ${String(value)}`
        );
      }
      return numericValue;
    });
  }

  private predictAnomalyInternal<T>(
    modelName: string,
    entity: T,
    featureResolvers: Record<string, EntityResolver<T>>
  ): AnomalyPredictionOutput {
    const metadata = this.anomalyMetadata.get(modelName);
    if (!metadata) {
      throw new ArtifactError(modelName, 'Anomaly artifact not initialized');
    }

    const values = this.extractNumericFeatures(modelName, entity, featureResolvers, metadata.featureNames);
    const normalized = normalizeNumericFeatures(
      values,
      metadata.normalization.means,
      metadata.normalization.stds,
    );

    const norm = l2Norm(normalized);
    const stats = metadata.normScoreStats;
    const threshold = stats?.threshold ?? metadata.threshold;
    const spread = stats?.std && stats.std > 0 ? stats.std : 1;
    const score = Number(sigmoid((norm - threshold) / spread).toFixed(6));

    return {
      modelName,
      prediction: score,
      confidence: score,
      timestamp: new Date().toISOString(),
    };
  }

  private queryFaissSimilarity(artifact: LoadedSimilarityArtifact, vector: number[], limit: number): SimilarityMatch[] {
    const scriptPath = path.resolve(__dirname, '../../python/query_similarity.py');
    const result = spawnSync(
      'python3',
      [
        scriptPath,
        '--metadata',
        artifact.metadataPath,
        '--query',
        JSON.stringify(vector),
        '--k',
        String(limit),
      ],
      { encoding: 'utf-8', stdio: 'pipe' }
    );

    if (result.error) {
      throw new ArtifactError(artifact.metadata.traitName, `FAISS similarity query failed: ${result.error.message}`);
    }
    if (result.status !== 0) {
      throw new ArtifactError(
        artifact.metadata.traitName,
        result.stderr.trim() || 'FAISS similarity query failed'
      );
    }

    try {
      const payload = JSON.parse(result.stdout.trim()) as { matches?: SimilarityMatch[] };
      return Array.isArray(payload.matches) ? payload.matches : [];
    } catch (error) {
      throw new ArtifactError(
        artifact.metadata.traitName,
        `FAISS similarity query returned invalid JSON: ${(error as Error).message}`
      );
    }
  }

  async predictSimilarity<T>(
    traitName: string,
    entity: T,
    featureResolvers: Record<string, EntityResolver<T>>,
    options: { limit?: number } = {}
  ): Promise<SimilarityPredictionOutput> {
    const artifact = this.similarityArtifacts.get(traitName);
    if (!artifact) {
      throw new ArtifactError(traitName, 'Similarity artifact not initialized');
    }

    const limit = Math.max(1, options.limit ?? 5);
    const rawVector = this.extractNumericFeatures(
      traitName,
      entity,
      featureResolvers,
      artifact.metadata.featureNames,
    );
    const normalized = normalizeNumericFeatures(
      rawVector,
      artifact.metadata.normalization.means,
      artifact.metadata.normalization.stds,
    );
    const queryVector = l2Normalize(normalized);

    let matches: SimilarityMatch[];

    if (artifact.metadata.artifactFormat === 'npy') {
      const embeddings = artifact.embeddings ?? loadNpyFloat32Matrix(artifact.indexPath);
      artifact.embeddings = embeddings;
      if (embeddings.cols !== queryVector.length) {
        throw new ArtifactError(
          traitName,
          `Similarity embedding dimension mismatch: expected ${embeddings.cols}, got ${queryVector.length}`
        );
      }

      const scored = new Array<SimilarityMatch>(embeddings.rows);
      for (let row = 0; row < embeddings.rows; row++) {
        scored[row] = {
          entityId: artifact.entityIds[row],
          score: dotProduct(queryVector, embeddings.data, row * embeddings.cols),
          rank: row + 1,
        };
      }
      matches = scored
        .sort((left, right) => right.score - left.score)
        .slice(0, limit)
        .map((match, index) => ({ ...match, rank: index + 1 }));
    } else {
      matches = this.queryFaissSimilarity(artifact, queryVector, limit);
    }

    return {
      traitName,
      matches,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Run prediction on a single entity.
   *
   * Pass model name + explicit resolver map
   * ```ts
   * await session.predict('productSales', product, { price: p => p.price });
   * ```
   */
  async predict<T>(
    modelName: string,
    entity: T,
    featureResolvers: Record<string, EntityResolver<T>>
  ): Promise<PredictionOutput>;
  async predict<T>(
    modelOrName: string,
    entity: T,
    featureResolvers?: Record<string, EntityResolver<T>>
  ): Promise<PredictionOutput> {
    let modelName: string;
    let resolvers: Record<string, EntityResolver<T>>;

    if (typeof modelOrName === 'string') {
      modelName = modelOrName;
      resolvers = featureResolvers!;
    } else {
      modelName = modelOrName;
      resolvers = featureResolvers!;
    }

    const metadata = this.metadata.get(modelName);
    if (!metadata) {
      if (this.anomalyMetadata.has(modelName)) {
        return this.predictAnomalyInternal(modelName, entity, resolvers);
      }
      if (this.similarityArtifacts.has(modelName)) {
        throw new ArtifactError(modelName, 'Similarity traits use predictSimilarity(), not predict()');
      }
      throw new ArtifactError(modelName, 'Model not initialized');
    }

    const session = this.sessions.get(modelName);
    if (!session) {
      throw new ArtifactError(modelName, 'ONNX session not initialized');
    }

    try {
      const extracted = this.featureExtractor.extract(entity, resolvers, metadata.features);

      const featureRecord: Record<string, unknown> = {};
      for (let i = 0; i < extracted.featureNames.length; i++) {
        featureRecord[extracted.featureNames[i]] = extracted.values[i];
      }

      const vector = normalizeFeatureVector(
        featureRecord,
        metadata.features,
        metadata.encoding || {},
        metadata.imputation || {},
        metadata.scaling || {}
      );

      const inputName = session.inputNames[0] || 'input';
      const outputName = session.outputNames[0] || 'output';
      const inputTensor = new ort.Tensor('float32', Float32Array.from(vector), [
        1,
        vector.length,
      ]);
      // Request only the first output by name to avoid ZipMap type errors
      // that arise with certain sklearn→ONNX classifiers (e.g. ExtraTrees).
      const results = await session.run({ [inputName]: inputTensor }, [outputName]);
      const outputTensor = results[outputName];

      if (!outputTensor) {
        throw new Error(`ONNX output "${outputName}" not found`);
      }

      const outputData = readNumericTensorData(outputTensor, modelName, outputName);

      let prediction: number | string;
      if (metadata.taskType === 'regression') {
        prediction = outputData[0];
      } else if (metadata.taskType === 'binary_classification') {
        prediction = outputData.length === 1 ? String(outputData[0]) : outputData[0] >= 0.5 ? '1' : '0';
      } else {
        if (outputData.length === 1) {
          prediction = String(outputData[0]);
        } else {
          let maxIndex = 0;
          let maxValue = outputData[0] ?? -Infinity;
          for (let i = 1; i < outputData.length; i++) {
            if (outputData[i] > maxValue) {
              maxValue = outputData[i];
              maxIndex = i;
            }
          }
          prediction = String(maxIndex);
        }
      }

      return { modelName, prediction, timestamp: new Date().toISOString() };
    } catch (error) {
      if (error instanceof HydrationError || error instanceof FeatureExtractionError) {
        throw error;
      }
      throw new ONNXRuntimeError(
        modelName,
        `Prediction failed: ${(error as Error).message}`
      );
    }
  }

  /**
   * Run batch predictions.
   *
   * Preflight validation runs atomically over the entire batch.
   * Any failure aborts inference with no partial execution.
   *
   * Pass model name + explicit resolver map
   */
  async predictBatch<T>(
    modelName: string,
    entities: T[],
    featureResolvers: Record<string, EntityResolver<T>>
  ): Promise<BatchPredictionResult>;
  async predictBatch<T>(
    modelOrName: string,
    entities: T[],
    featureResolvers?: Record<string, EntityResolver<T>>
  ): Promise<BatchPredictionResult> {
    if (!Array.isArray(entities)) {
      throw new Error('entities must be an array');
    }

    let modelName: string;
    let resolvers: Record<string, EntityResolver<T>>;

    if (typeof modelOrName === 'string') {
      modelName = modelOrName;
      resolvers = featureResolvers!;
    } else {
      modelName = modelOrName;
      resolvers = featureResolvers!;
    }

    const metadata = this.metadata.get(modelName);
    if (!metadata) {
      if (this.anomalyMetadata.has(modelName)) {
        const results = entities.map((entity) => this.predictAnomalyInternal(modelName, entity, resolvers));
        return { modelName, results, successCount: results.length };
      }
      if (this.similarityArtifacts.has(modelName)) {
        throw new ArtifactError(modelName, 'Similarity traits use predictSimilarity(), not predictBatch()');
      }
      throw new ArtifactError(modelName, 'Model not initialized');
    }

    const session = this.sessions.get(modelName);
    if (!session) {
      throw new ArtifactError(modelName, 'ONNX session not initialized');
    }

    // Phase 1: Preflight validation — extract and validate all features atomically.
    // If ANY entity fails, abort the entire batch with no partial execution.
    const featureVectors: number[][] = [];

    for (let i = 0; i < entities.length; i++) {
      try {
        const extracted = this.featureExtractor.extract(entities[i], resolvers, metadata.features);

        const featureRecord: Record<string, unknown> = {};
        for (let j = 0; j < extracted.featureNames.length; j++) {
          featureRecord[extracted.featureNames[j]] = extracted.values[j];
        }

        const vector = normalizeFeatureVector(
          featureRecord,
          metadata.features,
          metadata.encoding || {},
          metadata.imputation || {},
          metadata.scaling || {}
        );
        featureVectors.push(vector);
      } catch (error) {
        if (error instanceof FeatureExtractionError) {
          const context = error.context as { featureName?: unknown; reason?: unknown };
          const featureName =
            typeof context.featureName === 'string' ? context.featureName : 'unknown';
          const reason = typeof context.reason === 'string' ? context.reason : 'unknown';
          throw new FeatureExtractionError(modelName, featureName, reason, i, error.context);
        }
        if (error instanceof HydrationError) {
          const context = error.context as { entityPath?: unknown; reason?: unknown };
          const entityPath =
            typeof context.entityPath === 'string' ? context.entityPath : 'unknown';
          const reason = typeof context.reason === 'string' ? context.reason : 'unknown';
          throw new HydrationError(modelName, entityPath, reason, i);
        }
        throw new FeatureExtractionError(
          modelName,
          'unknown',
          `Batch preflight failed at index ${i}: ${(error as Error).message}`,
          i
        );
      }
    }

    // Phase 2: Execute ONNX inference (only reached if all entities validated)
    const results: PredictionOutput[] = [];
    const inputName = session.inputNames[0] || 'input';
    const outputName = session.outputNames[0] || 'output';

    for (let i = 0; i < featureVectors.length; i++) {
      try {
        const vector = featureVectors[i];
        const inputTensor = new ort.Tensor('float32', Float32Array.from(vector), [
          1,
          vector.length,
        ]);
        const onnxResults = await session.run({ [inputName]: inputTensor }, [outputName]);
        const outputTensor = onnxResults[outputName];

        if (!outputTensor) {
          throw new Error(`ONNX output "${outputName}" not found`);
        }

        const outputData = readNumericTensorData(outputTensor, modelName, outputName);

        let prediction: number | string;
        if (metadata.taskType === 'regression') {
          prediction = outputData[0];
        } else if (metadata.taskType === 'binary_classification') {
          prediction =
            outputData.length === 1 ? String(outputData[0]) : outputData[0] >= 0.5 ? '1' : '0';
        } else {
          if (outputData.length === 1) {
            prediction = String(outputData[0]);
          } else {
            let maxIndex = 0;
            let maxValue = outputData[0] ?? -Infinity;
            for (let j = 1; j < outputData.length; j++) {
              if (outputData[j] > maxValue) {
                maxValue = outputData[j];
                maxIndex = j;
              }
            }
            prediction = String(maxIndex);
          }
        }

        results.push({ modelName, prediction, timestamp: new Date().toISOString() });
      } catch (error) {
        throw new ONNXRuntimeError(
          modelName,
          `Batch inference failed at index ${i}: ${(error as Error).message}`
        );
      }
    }

    return { modelName, results, successCount: results.length };
  }

  /**
   * Dispose a specific model session.
   */
  async dispose(modelName: string): Promise<void> {
    this.sessions.delete(modelName);
    this.metadata.delete(modelName);
    this.anomalyMetadata.delete(modelName);
    this.similarityArtifacts.delete(modelName);
  }

  /**
   * Dispose all model sessions.
   */
  async disposeAll(): Promise<void> {
    this.sessions.clear();
    this.metadata.clear();
    this.anomalyMetadata.clear();
    this.similarityArtifacts.clear();
  }

  // -------------------------------------------------------------------------
  // Generative trait inference
  // -------------------------------------------------------------------------

  /**
   * Run inference on a generative trait.
   *
   * Serializes the entity's context fields into a structured JSON block,
   * prepends it to the prompt, then calls the configured AI provider via
   * AI SDK v5+ (`generateText` or `generateObject` depending on `outputSchema`).
   *
   * @param trait   - The generative trait definition (used at inference time).
   * @param entity  - The entity to generate output for.
   * @param provider - A `LanguageModel` instance from `ai` (e.g. `openai('gpt-4o')`).
   *
   * @example
   * ```ts
   * import { openai } from '@ai-sdk/openai';
   * const output = await session.predictGenerative(retentionMessage, user, openai('gpt-4o'));
   * // output.result is the generated string / enum value / object
   * ```
   */
  async predictGenerative<T>(
    trait: GenerativeTrait<T>,
    entity: T,
    provider: unknown
  ): Promise<GenerativePredictionOutput> {
    // Build context object from the configured entity fields
    const context: Record<string, unknown> = {};
    for (const field of trait.context) {
      context[field] = getEntityFieldValue(entity, field);
    }

    const prompt = `<context>\n${JSON.stringify(context, null, 2)}\n</context>\n\n${trait.prompt}`;

    // Dynamic import — 'ai' is an optional peer dependency.
    // This gives a clear error message if the user hasn't installed it.
    let aiModule: AiModuleLike;
    try {
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore — optional peer dep, not present in dev environment
      aiModule = (await import('ai')) as AiModuleLike;
    } catch {
      throw new Error(
        'Package "ai" is required for generative trait inference. ' +
          'Install it with: npm install ai'
      );
    }

    const { generateText, generateObject } = aiModule;
    const detected = detectOutputSchemaShape(trait.outputSchema);

    try {
      if (detected.shape === 'text') {
        const { text } = await generateText({ model: provider, prompt });
        return {
          traitName: trait.name,
          result: text as string,
          timestamp: new Date().toISOString(),
        };
      } else if (detected.shape === 'choice') {
        const { object } = await generateObject({
          model: provider,
          output: 'enum',
          enum: detected.choiceOptions ?? [],
          prompt,
        });
        return {
          traitName: trait.name,
          result: object as string,
          timestamp: new Date().toISOString(),
        };
      } else {
        // 'object' shape — pass the user's Zod schema directly to generateObject
        const { object } = await generateObject({
          model: provider,
          schema: trait.outputSchema,
          prompt,
        });
        return {
          traitName: trait.name,
          result: object as Record<string, unknown>,
          timestamp: new Date().toISOString(),
        };
      }
    } catch (error) {
      throw new Error(
        `Generative inference failed for trait "${trait.name}": ${(error as Error).message}`
      );
    }
  }
}
