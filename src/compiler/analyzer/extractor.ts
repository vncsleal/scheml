/**
 * Prisma Data Extractor
 * 
 * Automatically extracts training data from a Prisma database.
 * Analyzes feature dependencies to generate optimized queries.
 */

import { PrismaClient } from '@prisma/client';
import { PrisMLModel } from '../../core/types';
import { FeatureProcessor } from '../../core/processor';

interface TrainingDataRow {
  features: number[];
  label: number;
}

export interface TrainingDataset {
  features: number[][];
  labels: number[];
  featureNames: string[];
}

export class PrismaDataExtractor {
  private prisma: PrismaClient;

  constructor() {
    this.prisma = new PrismaClient();
  }

  /**
   * Extract training data from Prisma database
   * 
   * @param model PrisML model definition
   * @param options Extraction options
   * @returns Training dataset ready for Python
   */
  async extractTrainingData(
    model: PrisMLModel,
    options: {
      limit?: number;
      batchSize?: number;
      where?: any;
    } = {}
  ): Promise<TrainingDataset> {
    const { limit, batchSize = 1000, where = {} } = options;

    // Create processor for this model
    const processor = new FeatureProcessor(model);

    console.log(` Extracting training data for ${model.name}...`);
    console.log(`   Target: ${model.target}`);
    console.log(`   Output: ${model.output}`);

    // Determine which fields we need from the database
    const requiredFields = this.getRequiredFields(model);
    console.log(`   Required fields: ${requiredFields.join(', ')}`);

    // Extract data in batches
    const rows: TrainingDataRow[] = [];
    let cursor: any = undefined;
    let totalProcessed = 0;

    while (true) {
      // Build query
      const queryArgs: any = {
        take: batchSize,
        where,
        select: this.buildSelectClause(requiredFields, model.output)
      };

      if (cursor) {
        queryArgs.skip = 1;
        queryArgs.cursor = cursor;
      }

      if (limit && totalProcessed >= limit) {
        break;
      }

      // Execute query
      // @ts-ignore - Dynamic model access
      const batch = await this.prisma[model.target.toLowerCase()].findMany(queryArgs);

      if (batch.length === 0) {
        break;
      }

      // Process each entity
      for (const entity of batch) {
        // Extract features using processor (returns Promise<number[]>)
        const features = await processor.processEntity(entity);

        // Extract label (target variable)
        const label = this.extractLabel(entity, model.output);

        if (label !== null) {
          rows.push({ features, label });
        }

        totalProcessed++;
        if (limit && totalProcessed >= limit) {
          break;
        }
      }

      // Update cursor for pagination
      cursor = { id: batch[batch.length - 1].id };

      console.log(`   Processed: ${totalProcessed} rows...`);

      if (batch.length < batchSize) {
        break;
      }
    }

    console.log(`Extracted ${rows.length} training samples\n`);

    // Convert to Python-friendly format
    return {
      features: rows.map(r => r.features),
      labels: rows.map(r => r.label),
      featureNames: Object.keys(model.features)
    };
  }

  /**
   * Analyze feature definitions to determine required database fields
   */
  private getRequiredFields(model: PrisMLModel): string[] {
    const fields = new Set<string>();

    // Add ID (needed for cursor pagination)
    fields.add('id');

    // Add output field (target variable)
    fields.add(model.output);

    // Common method names to ignore (not database fields)
    const ignoredMethods = new Set([
      'getTime', 'toString', 'valueOf', 'toJSON', 'toISOString',
      'getDate', 'getMonth', 'getFullYear', 'getHours', 'getMinutes',
      'length', 'map', 'filter', 'reduce', 'forEach', 'includes'
    ]);

    // Analyze each feature's resolve function to detect field dependencies
    for (const [featureName, featureDef] of Object.entries(model.features)) {
      // Simple heuristic: look at resolve function string
      const resolveStr = featureDef.resolve.toString();

      // Match patterns like: user.fieldName, entity.fieldName
      const matches = resolveStr.match(/\b(?:user|entity)\.([\w]+)/g) || [];

      for (const match of matches) {
        const fieldName = match.split('.')[1];
        if (fieldName && !ignoredMethods.has(fieldName)) {
          fields.add(fieldName);
        }
      }
    }

    return Array.from(fields);
  }

  /**
   * Build Prisma select clause from required fields
   */
  private buildSelectClause(requiredFields: string[], outputField: string): Record<string, boolean> {
    const select: Record<string, boolean> = {};

    for (const field of requiredFields) {
      select[field] = true;
    }

    // Ensure output field is included
    select[outputField] = true;

    return select;
  }

  /**
   * Extract the label (target variable) from an entity
   */
  private extractLabel(entity: any, outputField: string): number | null {
    const value = entity[outputField];

    if (value === null || value === undefined) {
      return null;
    }

    // Convert to number
    if (typeof value === 'boolean') {
      return value ? 1 : 0;
    }

    if (typeof value === 'number') {
      return value;
    }

    // Try to parse as number
    const parsed = parseFloat(value);
    if (!isNaN(parsed)) {
      return parsed;
    }

    console.warn(`Warning: Could not convert label value to number: ${value}`);
    return null;
  }

  /**
   * Close Prisma connection
   */
  async disconnect(): Promise<void> {
    await this.prisma.$disconnect();
  }

  /**
   * Test database connection
   */
  async testConnection(): Promise<boolean> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return true;
    } catch (error: any) {
      console.error('Database connection failed:', error.message);
      return false;
    }
  }

  /**
   * Get count of available training samples
   */
  async getAvailableCount(model: PrisMLModel, where: any = {}): Promise<number> {
    // @ts-ignore - Dynamic model access
    return await this.prisma[model.target.toLowerCase()].count({ where });
  }
}
