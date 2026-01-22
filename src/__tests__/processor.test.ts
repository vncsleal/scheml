/**
 * Unit Tests: Feature Processor
 */

import { describe, it, expect } from 'vitest';
import { FeatureProcessor } from '../core/processor';
import { defineModel } from '../core/types';

describe('FeatureProcessor', () => {
  describe('processEntity', () => {
    it('should extract numeric features correctly', async () => {
      const model = defineModel({
        target: 'User',
        output: 'score',
        features: {
          age: {
            type: 'Int',
            resolve: (user: any) => user.age
          },
          balance: {
            type: 'Float',
            resolve: (user: any) => user.balance
          }
        }
      });

      const processor = new FeatureProcessor(model);
      const entity = { age: 25, balance: 100.5 };

      const result = await processor.processEntity(entity);

      expect(result).toEqual([25, 100.5]);
    });

    it('should handle null values with imputation', async () => {
      const model = defineModel({
        target: 'User',
        output: 'score',
        features: {
          age: {
            type: 'Int',
            resolve: (user: any) => user.age
          },
          balance: {
            type: 'Float',
            resolve: (user: any) => user.balance
          }
        }
      });

      const processor = new FeatureProcessor(model);
      const entity = { age: null, balance: undefined };

      const result = await processor.processEntity(entity);

      expect(result).toEqual([0, 0]); // Imputed with 0
    });

    it('should encode boolean features as 0/1', async () => {
      const model = defineModel({
        target: 'User',
        output: 'score',
        features: {
          isActive: {
            type: 'Boolean',
            resolve: (user: any) => user.isActive
          },
          isPremium: {
            type: 'Boolean',
            resolve: (user: any) => user.isPremium
          }
        }
      });

      const processor = new FeatureProcessor(model);
      const entity = { isActive: true, isPremium: false };

      const result = await processor.processEntity(entity);

      expect(result).toEqual([1, 0]);
    });

    it('should maintain deterministic feature order', async () => {
      const model = defineModel({
        target: 'User',
        output: 'score',
        features: {
          zScore: { type: 'Float', resolve: (u: any) => u.z },
          aScore: { type: 'Float', resolve: (u: any) => u.a },
          mScore: { type: 'Float', resolve: (u: any) => u.m }
        }
      });

      const processor = new FeatureProcessor(model);
      const entity = { a: 1, m: 2, z: 3 };

      const result = await processor.processEntity(entity);

      // Should be sorted alphabetically: aScore, mScore, zScore
      expect(result).toEqual([1, 2, 3]);
    });

    it('should handle async feature resolvers', async () => {
      const model = defineModel({
        target: 'User',
        output: 'score',
        features: {
          computedValue: {
            type: 'Float',
            resolve: async (user: any) => {
              return Promise.resolve(user.value * 2);
            }
          }
        }
      });

      const processor = new FeatureProcessor(model);
      const entity = { value: 50 };

      const result = await processor.processEntity(entity);

      expect(result).toEqual([100]);
    });
  });

  describe('processBatch', () => {
    it('should process multiple entities', async () => {
      const model = defineModel({
        target: 'User',
        output: 'score',
        features: {
          value: {
            type: 'Float',
            resolve: (user: any) => user.value
          }
        }
      });

      const processor = new FeatureProcessor(model);
      const entities = [
        { value: 10 },
        { value: 20 },
        { value: 30 }
      ];

      const result = await processor.processBatch(entities);

      expect(result).toEqual([[10], [20], [30]]);
    });

    it('should handle empty batch', async () => {
      const model = defineModel({
        target: 'User',
        output: 'score',
        features: {
          value: { type: 'Float', resolve: (u: any) => u.value }
        }
      });

      const processor = new FeatureProcessor(model);
      const result = await processor.processBatch([]);

      expect(result).toEqual([]);
    });
  });
});
