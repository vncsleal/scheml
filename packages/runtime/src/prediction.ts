/**
 * ONNX Runtime Prediction Engine
 * Manages model sessions and deterministic predictions
 */

import * as fs from 'fs';
import * as path from 'path';
import * as ort from 'onnxruntime-node';
import {
  ModelMetadata,
  PredictionInput,
  PredictionOutput,
  BatchPredictionResult,
  FeatureSchema,
  ExtractedFeatures,
  normalizeFeatureVector,
} from '@vncsleal/prisml-core';
import {
  SchemaDriftError,
  ArtifactError,
  HydrationError,
  FeatureExtractionError,
  ONNXRuntimeError,
} from '@vncsleal/prisml-core';

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
      metadata = JSON.parse(content);
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

    if (!metadata.prismaSchemaHash) {
      throw new ArtifactError(
        metadata.modelName,
        'Metadata missing Prisma schema hash'
      );
    }

    if (!metadata.features || Object.keys(metadata.features).length === 0) {
      throw new ArtifactError(
        metadata.modelName,
        'Metadata has no features defined'
      );
    }
    if (!metadata.features || !metadata.features.order) {
      throw new ArtifactError(
        metadata.modelName,
        'Metadata missing feature schema'
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
   * Initialize a model for predictions
   */
  async initializeModel(
    metadataPath: string,
    onnxPath: string,
    prismaSchemaHash: string
  ): Promise<void> {
    const modelName = path.basename(metadataPath, '.metadata.json');

    const metadata = this.metadataLoader.loadMetadata(metadataPath);

    // Validate schema hash
    if (metadata.prismaSchemaHash !== prismaSchemaHash) {
      throw new SchemaDriftError(metadata.prismaSchemaHash, prismaSchemaHash);
    }

    this.metadata.set(metadata.modelName, metadata);

    const session = await ort.InferenceSession.create(onnxPath);
    this.sessions.set(metadata.modelName, session);
  }

  /**
   * Run prediction on a single entity
   */
  async predict<T>(
    modelName: string,
    entity: T,
    featureResolvers: Record<string, (e: T) => any>
  ): Promise<PredictionOutput> {
    const metadata = this.metadata.get(modelName);
    if (!metadata) {
      throw new ArtifactError(modelName, 'Model not initialized');
    }

    const session = this.sessions.get(modelName);
    if (!session) {
      throw new ArtifactError(modelName, 'ONNX session not initialized');
    }

    try {
      // Extract features
      const extracted = this.featureExtractor.extract(
        entity,
        featureResolvers,
        metadata.features
      );

      const featureRecord: Record<string, unknown> = {};
      for (let i = 0; i < extracted.featureNames.length; i++) {
        featureRecord[extracted.featureNames[i]] = extracted.values[i];
      }

      const vector = normalizeFeatureVector(
        featureRecord,
        metadata.features,
        metadata.encoding || {},
        metadata.imputation || {}
      );

      const inputName = session.inputNames[0] || 'input';
      const outputName = session.outputNames[0] || 'output';
      const inputTensor = new ort.Tensor('float32', Float32Array.from(vector), [1, vector.length]);
      const results = await session.run({ [inputName]: inputTensor });
      const outputTensor = results[outputName];

      if (!outputTensor) {
        throw new Error(`ONNX output "${outputName}" not found`);
      }

      const outputData = Array.from(outputTensor.data as any) as number[];

      let prediction: number | string;
      if (metadata.taskType === 'regression') {
        prediction = outputData[0];
      } else if (metadata.taskType === 'binary_classification') {
        if (outputData.length === 1) {
          prediction = String(outputData[0]);
        } else {
          prediction = outputData[0] >= 0.5 ? '1' : '0';
        }
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

      return {
        modelName,
        prediction,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      if (error instanceof HydrationError || error instanceof FeatureExtractionError) {
        throw error;
      }
      throw new ONNXRuntimeError(modelName, `Prediction failed: ${(error as Error).message}`);
    }
  }

  /**
   * Run batch predictions
   * 
   * PRD Requirement: "Preflight validation runs atomically over the entire batch.
   * Any failure aborts inference with no partial execution."
   * 
   * Implementation:
   * Phase 1: Validate all entities and extract features (no ONNX execution)
   * Phase 2: Execute ONNX inference (only if all entities validated)
   */
  async predictBatch<T>(
    modelName: string,
    entities: T[],
    featureResolvers: Record<string, (e: T) => any>
  ): Promise<BatchPredictionResult> {
    if (!Array.isArray(entities)) {
      throw new Error('entities must be an array');
    }

    const metadata = this.metadata.get(modelName);
    if (!metadata) {
      throw new ArtifactError(modelName, 'Model not initialized');
    }

    const session = this.sessions.get(modelName);
    if (!session) {
      throw new ArtifactError(modelName, 'ONNX session not initialized');
    }

    // Phase 1: Preflight validation - extract and validate all features atomically
    // If ANY entity fails validation, abort the entire batch with no partial execution
    const extractedFeatures: ExtractedFeatures[] = [];
    const featureVectors: number[][] = [];

    for (let i = 0; i < entities.length; i++) {
      try {
        // Extract features
        const extracted = this.featureExtractor.extract(
          entities[i],
          featureResolvers,
          metadata.features
        );
        extractedFeatures.push(extracted);

        // Convert to feature record
        const featureRecord: Record<string, unknown> = {};
        for (let j = 0; j < extracted.featureNames.length; j++) {
          featureRecord[extracted.featureNames[j]] = extracted.values[j];
        }

        // Normalize to vector
        const vector = normalizeFeatureVector(
          featureRecord,
          metadata.features,
          metadata.encoding || {},
          metadata.imputation || {}
        );
        featureVectors.push(vector);
      } catch (error) {
        // Atomic abort: if any entity fails preflight, throw immediately
        // Attach batch index for debugging
        if (error instanceof FeatureExtractionError) {
          const context = error.context as {
            featureName?: unknown;
            reason?: unknown;
          };
          const featureName =
            typeof context.featureName === 'string' ? context.featureName : 'unknown';
          const reason =
            typeof context.reason === 'string' ? context.reason : 'unknown';
          throw new FeatureExtractionError(modelName, featureName, reason, i, error.context);
        }
        if (error instanceof HydrationError) {
          const context = error.context as {
            entityPath?: unknown;
            reason?: unknown;
          };
          const entityPath =
            typeof context.entityPath === 'string' ? context.entityPath : 'unknown';
          const reason =
            typeof context.reason === 'string' ? context.reason : 'unknown';
          throw new HydrationError(modelName, entityPath, reason, i);
        }
        // Re-throw other errors with batch context
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
        const inputTensor = new ort.Tensor('float32', Float32Array.from(vector), [1, vector.length]);
        const onnxResults = await session.run({ [inputName]: inputTensor });
        const outputTensor = onnxResults[outputName];

        if (!outputTensor) {
          throw new Error(`ONNX output "${outputName}" not found`);
        }

        const outputData = Array.from(outputTensor.data as any) as number[];

        let prediction: number | string;
        if (metadata.taskType === 'regression') {
          prediction = outputData[0];
        } else if (metadata.taskType === 'binary_classification') {
          if (outputData.length === 1) {
            prediction = String(outputData[0]);
          } else {
            prediction = outputData[0] >= 0.5 ? '1' : '0';
          }
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

        results.push({
          modelName,
          prediction,
          timestamp: new Date().toISOString(),
        });
      } catch (error) {
        // ONNX execution failure (should be rare after successful preflight)
        throw new ONNXRuntimeError(
          modelName,
          `Batch inference failed at index ${i}: ${(error as Error).message}`
        );
      }
    }

    return {
      modelName,
      results,
      successCount: results.length,
      failureCount: 0,
    };
  }

  /**
   * Cleanup session
   */
  async dispose(modelName: string): Promise<void> {
    if (!this.sessions.has(modelName)) {
      return;
    }

    this.sessions.delete(modelName);
    this.metadata.delete(modelName);
  }

  /**
   * Cleanup all sessions
   */
  async disposeAll(): Promise<void> {
    this.sessions.clear();
    this.metadata.clear();
  }
}
