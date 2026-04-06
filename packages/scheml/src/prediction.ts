/**
 * ONNX Runtime Prediction Engine
 * Manages model sessions and deterministic predictions
 */

import * as fs from 'fs';
import * as path from 'path';
import * as ort from 'onnxruntime-node';
import {
  ModelMetadata,
  ModelDefinition,
  PredictionOutput,
  BatchPredictionResult,
  FeatureSchema,
  ExtractedFeatures,
  GenerativePredictionOutput,
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
import { createPrismaAdapter } from './adapters/prisma';

/**
 * Loads and caches ONNX model metadata
 */
export class ModelMetadataLoader {
  private cache: Map<string, ModelMetadata> = new Map();

  loadMetadata(metadataPath: string): ModelMetadata {
    if (this.cache.has(metadataPath)) {
      return this.cache.get(metadataPath)!;
    }

    const content = fs.readFileSync(metadataPath, 'utf-8');
    let metadata: ModelMetadata;

    try {
      const raw = JSON.parse(content);
      // Normalize new trait artifact format: new artifacts use `traitName`
      // instead of `modelName`.
      if (raw.traitName && !raw.modelName) {
        raw.modelName = raw.traitName;
      }
      metadata = raw;
    } catch (error) {
      throw new ArtifactError(
        'unknown',
        `Invalid metadata JSON: ${(error as Error).message}`
      );
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
    resolvers: Record<string, (e: T) => any>,
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
      values: values as any,
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
   * Load a model from disk using default artifact paths.
   *
   * Auto-resolves `.scheml/<name>.{onnx,metadata.json}` relative to process.cwd().
   * `opts.schemaPath` is required — pass the path to your schema file.
   *
   * @example
   * ```ts
   * const session = new PredictionSession();
   * await session.load(productSalesModel, { schemaPath: './prisma/schema.prisma' });
   * ```
   */
  async load(
    model: ModelDefinition,
    opts?: { artifactsDir?: string; schemaPath?: string; adapter?: ScheMLAdapter }
  ): Promise<void> {
    const dir = opts?.artifactsDir ?? path.resolve(process.cwd(), '.scheml');
    if (!opts?.schemaPath) {
      throw new Error(
        'schemaPath is required. Pass opts.schemaPath to session.load() \u2014 ' +
        'or set schema in scheml.config.ts and use the programmatic API that reads it.'
      );
    }
    const schemaFilePath = path.resolve(opts.schemaPath);
    const metadataPath = path.resolve(dir, `${model.name}.metadata.json`);
    const onnxPath = path.resolve(dir, `${model.name}.onnx`);

    // Backward-compatible hash: v1.1.0 artifacts used the full-schema hash;
    // v1.2.0+ artifacts use the model-scoped subset hash.
    const meta = this.metadataLoader.loadMetadata(metadataPath);
    const adapterImpl = opts?.adapter ?? createPrismaAdapter();
    const graph = await adapterImpl.reader.readSchema(schemaFilePath);
    const hash = computeSchemaHashForMetadata(graph, meta, adapterImpl.reader);

    await this.initializeModel(metadataPath, onnxPath, hash);
  }

  /**
   * Load a trained trait artifact from disk.
   *
   * Works for all ONNX-backed trait types: `sequential`, and `predictive`.
   * The artifact's own `schemaHash` is compared against the current schema to
   * detect drift without requiring the caller to specify a hash algorithm.
   *
   * @example
   * ```ts
   * const session = new PredictionSession();
   * await session.loadTrait('engagementSequence', { artifactsDir, schemaPath });
   * const result = await session.predict('engagementSequence', entity, resolvers);
   * ```
   */
  async loadTrait(
    traitName: string,
    opts?: { artifactsDir?: string; schemaPath?: string; adapter?: ScheMLAdapter }
  ): Promise<void> {
    const dir = opts?.artifactsDir ?? path.resolve(process.cwd(), '.scheml');
    if (!opts?.schemaPath) {
      throw new Error(
        'schemaPath is required. Pass opts.schemaPath to session.loadTrait().'
      );
    }
    const schemaFilePath = path.resolve(opts.schemaPath);
    const metadataPath = path.resolve(dir, `${traitName}.metadata.json`);
    const meta = this.metadataLoader.loadMetadata(metadataPath);
    // Prefer the onnxFile path from metadata; fall back to convention.
    const onnxFile = (meta as { onnxFile?: string }).onnxFile ?? `${traitName}.onnx`;
    const onnxPath = path.resolve(dir, onnxFile);
    const adapterImpl = opts?.adapter ?? createPrismaAdapter();
    const graph = await adapterImpl.reader.readSchema(schemaFilePath);
    const hash = computeSchemaHashForMetadata(graph, meta as any, adapterImpl.reader);
    await this.initializeModel(metadataPath, onnxPath, hash);
  }

  /**
   * Run prediction on a single entity.
   *
   * Overload 1 (recommended): pass the model definition — resolvers are read from model.features
   * ```ts
   * await session.predict(productSalesModel, product);
   * ```
   *
   * Overload 2 (advanced): pass model name + explicit resolver map
   * ```ts
   * await session.predict('productSales', product, { price: p => p.price });
   * ```
   */
  async predict<T>(model: ModelDefinition<T>, entity: T): Promise<PredictionOutput>;
  async predict<T>(
    modelName: string,
    entity: T,
    featureResolvers: Record<string, (e: T) => any>
  ): Promise<PredictionOutput>;
  async predict<T>(
    modelOrName: ModelDefinition<T> | string,
    entity: T,
    featureResolvers?: Record<string, (e: T) => any>
  ): Promise<PredictionOutput> {
    let modelName: string;
    let resolvers: Record<string, (e: T) => any>;

    if (typeof modelOrName === 'string') {
      modelName = modelOrName;
      resolvers = featureResolvers!;
    } else {
      modelName = modelOrName.name;
      resolvers = modelOrName.features as Record<string, (e: T) => any>;
    }

    const metadata = this.metadata.get(modelName);
    if (!metadata) {
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

      const outputData = Array.from(outputTensor.data as any) as number[];

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
   * Overload 1 (recommended): pass the model definition
   * ```ts
   * await session.predictBatch(productSalesModel, products);
   * ```
   *
   * Overload 2 (advanced): pass model name + explicit resolver map
   */
  async predictBatch<T>(model: ModelDefinition<T>, entities: T[]): Promise<BatchPredictionResult>;
  async predictBatch<T>(
    modelName: string,
    entities: T[],
    featureResolvers: Record<string, (e: T) => any>
  ): Promise<BatchPredictionResult>;
  async predictBatch<T>(
    modelOrName: ModelDefinition<T> | string,
    entities: T[],
    featureResolvers?: Record<string, (e: T) => any>
  ): Promise<BatchPredictionResult> {
    if (!Array.isArray(entities)) {
      throw new Error('entities must be an array');
    }

    let modelName: string;
    let resolvers: Record<string, (e: T) => any>;

    if (typeof modelOrName === 'string') {
      modelName = modelOrName;
      resolvers = featureResolvers!;
    } else {
      modelName = modelOrName.name;
      resolvers = modelOrName.features as Record<string, (e: T) => any>;
    }

    const metadata = this.metadata.get(modelName);
    if (!metadata) {
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

        const outputData = Array.from(outputTensor.data as any) as number[];

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
  }

  /**
   * Dispose all model sessions.
   */
  async disposeAll(): Promise<void> {
    this.sessions.clear();
    this.metadata.clear();
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
      context[field] = (entity as any)[field];
    }

    const prompt = `<context>\n${JSON.stringify(context, null, 2)}\n</context>\n\n${trait.prompt}`;

    // Dynamic import — 'ai' is an optional peer dependency.
    // This gives a clear error message if the user hasn't installed it.
    let aiModule: any;
    try {
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore — optional peer dep, not present in dev environment
      aiModule = await import('ai');
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
