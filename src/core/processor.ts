import { PrisMLModel, FeatureDefinition } from './types';
import { FeatureExtractionError } from './errors';

export class FeatureProcessor {
  constructor(private model: PrisMLModel) { }

  /**
   * Converts a single database entity into a feature vector.
   * This is used during both Training (extraction) and Inference (runtime).
   */
  async processEntity(entity: any): Promise<number[]> {
    const vector: number[] = [];

    // Iterate deterministically over keys to ensure vector order matches
    const featureKeys = Object.keys(this.model.features).sort();

    for (const key of featureKeys) {
      const feature = this.model.features[key];
      try {
        const rawValue = await feature.resolve(entity);
        const encodedValue = this.encodeValue(rawValue, feature.type);
        vector.push(encodedValue);
      } catch (error: any) {
        // Extract field name from error or feature definition
        const fieldName = this.extractFieldName(feature, error);
        throw new FeatureExtractionError(key, fieldName, error);
      }
    }

    return vector;
  }

  /**
   * Attempts to extract the field name from error or feature definition
   */
  private extractFieldName(feature: FeatureDefinition, error: Error): string | undefined {
    // Try to extract field from error message (e.g., "Cannot read property 'x' of undefined")
    const match = error.message.match(/property '(\w+)'/);
    return match ? match[1] : undefined;
  }

  /**
   * Batch process entities for training.
   */
  async processBatch(entities: any[]): Promise<number[][]> {
    return Promise.all(entities.map(e => this.processEntity(e)));
  }

  /**
   * Encodes scalar values into float/int for ML models.
   */
  private encodeValue(value: any, type: string): number {
    if (value === null || value === undefined) {
      // Basic strategy: impute with 0. 
      // V2 TODO: Allow custom imputation strategies in schema.
      return 0;
    }

    switch (type) {
      case 'Int':
      case 'Float':
        const num = Number(value);
        return isNaN(num) ? 0 : num;
      case 'Boolean':
        return value === true ? 1 : 0;
      case 'String':
        // V1 Limitation: We do not support categorical encoding (One-Hot) yet.
        // For V1, we only allow numeric strings or length.
        // TODO: Implement LabelEncoding or Hashing.
        return 0;
      default:
        return 0;
    }
  }
}
