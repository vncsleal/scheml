/**
 * Unit Tests: ONNX Inference Engine
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ONNXInferenceEngine } from '../runtime/engine/inference';
import { defineModel } from '../core/types';
import fs from 'fs';
import path from 'path';

// Mock onnxruntime-node
vi.mock('onnxruntime-node', () => ({
  InferenceSession: {
    create: vi.fn()
  },
  Tensor: class MockTensor {
    constructor(public type: string, public data: any, public shape: number[]) { }
  }
}));

describe('ONNXInferenceEngine', () => {
  const model = defineModel({
    target: 'User',
    output: 'churnProbability',
    features: {
      daysSinceLastLogin: {
        type: 'Int',
        resolve: (user: any) => user.daysSinceLastLogin
      },
      totalSpent: {
        type: 'Float',
        resolve: (user: any) => user.totalSpent
      }
    }
  });

  model.name = 'testModel';

  describe('constructor', () => {
    it('should create engine with default model directory', () => {
      const engine = new ONNXInferenceEngine(model);
      expect(engine).toBeDefined();
    });

    it('should create engine with custom model directory', () => {
      const customDir = '/custom/path';
      const engine = new ONNXInferenceEngine(model, customDir);
      expect(engine).toBeDefined();
    });
  });

  describe('initialization', () => {
    it('should throw error if model file does not exist', async () => {
      const engine = new ONNXInferenceEngine(model, '/nonexistent/path');

      await expect(engine.initialize()).rejects.toThrow(
        /Trained model not found/
      );
    });
  });

  describe('error handling', () => {
    it('should throw error if predict called before initialize', async () => {
      const engine = new ONNXInferenceEngine(model);
      const entity = { daysSinceLastLogin: 10, totalSpent: 100 };

      await expect(engine.predict(entity)).rejects.toThrow(
        /not initialized/
      );
    });

    it('should throw error if predictBatch called before initialize', async () => {
      const engine = new ONNXInferenceEngine(model);
      const entities = [
        { daysSinceLastLogin: 10, totalSpent: 100 }
      ];

      await expect(engine.predictBatch(entities)).rejects.toThrow(
        /not initialized/
      );
    });
  });
});
