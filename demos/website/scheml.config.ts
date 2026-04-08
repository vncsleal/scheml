import type { AnyTraitDefinition, ZodLike } from '@vncsleal/scheml';
import { createPrismaAdapter, defineConfig, defineTrait } from '@vncsleal/scheml';

const retentionActionOptions = ['retain', 'escalate', 'celebrate'] as const;

const retentionActionSchema: ZodLike = {
  _def: {
    typeName: 'ZodEnum',
    values: retentionActionOptions,
  },
  parse(data: unknown) {
    if (typeof data !== 'string' || !retentionActionOptions.includes(data as (typeof retentionActionOptions)[number])) {
      throw new Error('Expected one of: retain, escalate, celebrate');
    }
    return data;
  },
  safeParse(data: unknown) {
    if (typeof data === 'string' && retentionActionOptions.includes(data as (typeof retentionActionOptions)[number])) {
      return { success: true, data };
    }

    return {
      success: false,
      error: new Error('Expected one of: retain, escalate, celebrate'),
    };
  },
};

export const userChurn = defineTrait('User', {
  type: 'predictive',
  name: 'userChurn',
  target: 'willChurn',
  features: ['lastActiveAt', 'monthlySpend', 'supportTickets'],
  output: {
    field: 'predictedChurn',
    taskType: 'binary_classification',
  },
  algorithm: {
    name: 'gbm',
    hyperparameters: { nEstimators: 200, learningRate: 0.1, maxDepth: 5 },
  },
  qualityGates: [
    { metric: 'precision', threshold: 0.8, comparison: 'gte' },
    { metric: 'recall', threshold: 0.75, comparison: 'gte' },
  ],
});

export const serverAnomaly = defineTrait('ServerMetric', {
  type: 'anomaly',
  name: 'serverAnomaly',
  baseline: ['cpuUsage', 'memoryPressure', 'errorRate'],
  sensitivity: 'medium',
});

export const productSimilarity = defineTrait('Product', {
  type: 'similarity',
  name: 'productSimilarity',
  on: ['categoryIndex', 'price', 'batteryHours', 'weightKg'],
});

export const engagementSequence = defineTrait('EngagementEvent', {
  type: 'temporal',
  name: 'engagementSequence',
  sequence: 'engagementScore',
  orderBy: 'createdAt',
  target: 'willChurnSoon',
  output: {
    field: 'predictedChurn',
    taskType: 'binary_classification',
  },
  algorithm: {
    name: 'gbm',
    hyperparameters: { nEstimators: 120, learningRate: 0.08, maxDepth: 3 },
  },
  qualityGates: [
    { metric: 'accuracy', threshold: 0.7, comparison: 'gte' },
  ],
});

export const retentionMessage = defineTrait('User', {
  type: 'generative',
  name: 'retentionMessage',
  context: ['planTier', 'willChurn', 'monthlySpend'],
  prompt: 'Return the next retention motion for this account in one concise decision.',
  outputSchema: retentionActionSchema,
});

export default defineConfig({
  adapter: createPrismaAdapter(import.meta.dirname),
  schema: './prisma/schema.prisma',
  generativeProvider: { model: 'demo-provider' },
  traits: [userChurn, serverAnomaly, productSimilarity, engagementSequence, retentionMessage] as unknown as AnyTraitDefinition[],
});