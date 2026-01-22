import * as ort from 'onnxruntime-node';
import fs from 'fs';
import path from 'path';
import { PrisMLModel } from '../../core/types';
import { FeatureProcessor } from '../../core/processor';
import { ModelNotFoundError, ModelLoadError, InferenceNotInitializedError } from '../../core/errors';

/**
 * ONNX Runtime Inference Engine
 * 
 * Loads pre-trained ONNX models and performs real-time predictions.
 * This replaces the mock inference with actual ML runtime.
 */
export class ONNXInferenceEngine {
  private session: ort.InferenceSession | null = null;
  private processor: FeatureProcessor;
  private modelPath: string;

  constructor(
    private model: PrisMLModel,
    modelDir: string = path.join(process.cwd(), 'prisml', 'generated')
  ) {
    this.processor = new FeatureProcessor(model);
    this.modelPath = path.join(modelDir, `${model.name}.onnx`);
  }

  /**
   * Initialize the ONNX session (load model into memory)
   */
  async initialize(): Promise<void> {
    if (!fs.existsSync(this.modelPath)) {
      throw new ModelNotFoundError(this.model.name, this.modelPath);
    }

    try {
      // Load ONNX model into runtime
      this.session = await ort.InferenceSession.create(this.modelPath, {
        executionProviders: ['cpu'], // V1: CPU only, V2: add GPU support
      });

      console.log(`ONNX model loaded: ${this.model.name}`);
    } catch (error: any) {
      throw new ModelLoadError(this.modelPath, error);
    }
  }

  /**
   * Predict on a single entity
   * 
   * @param entity The database entity (e.g., User object)
   * @returns Prediction value (e.g., churn probability 0.0-1.0)
   */
  async predict(entity: any): Promise<number> {
    if (!this.session) {
      throw new InferenceNotInitializedError(this.model.name);
    }

    // 1. Extract features using the same processor as training
    const features = await this.processor.processEntity(entity);

    // 2. Prepare ONNX input tensor
    // Shape: [1, num_features] for single prediction
    const inputTensor = new ort.Tensor('float32', new Float32Array(features), [1, features.length]);

    try {
      // 3. Run inference
      const feeds = { input: inputTensor }; // Input name depends on training export
      const results = await this.session.run(feeds);

      // 4. Extract output
      // For binary classification: output shape [1, 1] or [1, 2]
      // For regression: output shape [1, 1]
      // Try common output names: sklearn exports use 'variable', others use 'output', 'label', or 'probabilities'
      const outputTensor = results.variable || results.output || results.label || results.probabilities;

      if (!outputTensor) {
        throw new Error('Model output not found. Check ONNX export configuration.');
      }

      const prediction = outputTensor.data as Float32Array;

      // Return first value (probability or regression score)
      return prediction[0];

    } catch (error: any) {
      throw new Error(`Inference failed: ${error.message}`);
    }
  }

  /**
   * Batch prediction for multiple entities
   * 
   * @param entities Array of database entities
   * @returns Array of predictions
   */
  async predictBatch(entities: any[]): Promise<number[]> {
    if (!this.session) {
      throw new Error('Inference engine not initialized. Call .initialize() first.');
    }

    // 1. Extract all feature vectors
    const featureMatrix = await this.processor.processBatch(entities);

    // 2. Flatten to 1D array for ONNX
    const numSamples = featureMatrix.length;
    const numFeatures = featureMatrix[0]?.length || 0;

    if (numFeatures === 0) {
      return [];
    }

    const flatFeatures = new Float32Array(numSamples * numFeatures);
    for (let i = 0; i < numSamples; i++) {
      flatFeatures.set(featureMatrix[i], i * numFeatures);
    }

    // 3. Create batched tensor: [num_samples, num_features]
    const inputTensor = new ort.Tensor('float32', flatFeatures, [numSamples, numFeatures]);

    try {
      const feeds = { input: inputTensor };
      const results = await this.session.run(feeds);

      // Try common output names: sklearn exports use 'variable', others use 'output', 'label', or 'probabilities'
      const outputTensor = results.variable || results.output || results.label || results.probabilities;

      if (!outputTensor) {
        throw new Error('Model output not found. Check ONNX export configuration.');
      }

      const predictions = Array.from(outputTensor.data as Float32Array);

      // For binary classification with 2 outputs per sample, take positive class probability
      if (predictions.length === numSamples * 2) {
        return predictions.filter((_, idx) => idx % 2 === 1); // Take every second value
      }

      return predictions;

    } catch (error: any) {
      throw new Error(`Batch inference failed: ${error.message}`);
    }
  }

  /**
   * Get model metadata
   */
  getMetadata(): { name: string; features: string[]; path: string } {
    return {
      name: this.model.name,
      features: Object.keys(this.model.features).sort(),
      path: this.modelPath,
    };
  }

  /**
   * Release resources
   */
  async dispose(): Promise<void> {
    if (this.session) {
      await this.session.release();
      this.session = null;
    }
  }
}
