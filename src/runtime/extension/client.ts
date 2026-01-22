/**
 * PrisML Prisma Client Extension
 * 
 * Adds ML prediction methods to Prisma models.
 * Uses model methods instead of result fields due to Prisma's async limitations.
 */

import { Prisma } from '@prisma/client';
import { PrisMLModel } from '../../core/types';
import { ONNXInferenceEngine } from '../engine/inference';
import * as path from 'path';

interface EngineCache {
  [modelName: string]: ONNXInferenceEngine;
}

/**
 * Create a PrisML extension for Prisma Client.
 * 
 * @param models Array of PrisML model definitions
 * @returns Prisma Client extension with ML prediction methods
 * 
 * @example
 * ```typescript
 * const prisma = new PrismaClient().$extends(prisml([churnModel]));
 * 
 * // Single prediction
 * const user = await prisma.user.withML({ where: { id: 1 } });
 * console.log(user._ml.churnProbability);
 * 
 * // Batch predictions
 * const users = await prisma.user.withMLMany({ 
 *   where: { createdAt: { gte: lastWeek } },
 *   take: 100
 * });
 * users.forEach(u => console.log(u._ml.churnProbability));
 * ```
 */
export function prisml(models: PrisMLModel[]) {
  const engineCache: EngineCache = {};

  async function getEngine(model: PrisMLModel): Promise<ONNXInferenceEngine> {
    if (engineCache[model.name]) {
      return engineCache[model.name];
    }

    const modelDir = path.join(process.cwd(), 'prisml', 'generated');
    const engine = new ONNXInferenceEngine(model, modelDir);
    await engine.initialize();

    engineCache[model.name] = engine;
    return engine;
  }

  const targetMap = new Map<string, PrisMLModel[]>();
  for (const model of models) {
    const modelList = targetMap.get(model.target) || [];
    modelList.push(model);
    targetMap.set(model.target, modelList);
  }

  const extensionConfig: any = {
    name: 'prisml',
    model: {}
  };

  for (const [target, modelList] of targetMap.entries()) {
    const targetLower = target.toLowerCase();

    extensionConfig.model[targetLower] = {
      async withML(args: any) {
        // @ts-ignore - this context is provided by Prisma
        const entity = await this.findUnique(args);
        if (!entity) return null;

        const predictions: any = {};
        for (const model of modelList) {
          try {
            const engine = await getEngine(model);
            predictions[model.output] = await engine.predict(entity);
          } catch (error: any) {
            console.error(`[PrisML] Prediction failed for ${model.output}:`, error.message);
            predictions[model.output] = null;
          }
        }

        return {
          ...entity,
          _ml: predictions
        };
      },

      async withMLMany(args: any) {
        // @ts-ignore - this context is provided by Prisma
        const entities = await this.findMany(args);
        if (!entities || entities.length === 0) return [];

        // Batch predictions for efficiency
        const results = await Promise.all(
          entities.map(async (entity: any) => {
            const predictions: any = {};
            for (const model of modelList) {
              try {
                const engine = await getEngine(model);
                predictions[model.output] = await engine.predict(entity);
              } catch (error: any) {
                console.error(`[PrisML] Batch prediction failed for ${model.output}:`, error.message);
                predictions[model.output] = null;
              }
            }

            return {
              ...entity,
              _ml: predictions
            };
          })
        );

        return results;
      }
    };
  }

  return Prisma.defineExtension(extensionConfig);
}

export type PrismaClientWithML = ReturnType<typeof Prisma.defineExtension>;
