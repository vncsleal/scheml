import { defineConfig, defineTrait } from '@vncsleal/scheml';
import type { AnyTraitDefinition } from '@vncsleal/scheml';

type User = {
  id: string;
  email: string;
  createdAt: Date;
  source: 'organic' | 'paid' | 'referral';
  monthlySpend: number;
  monthsActive: number;
  plan: 'free' | 'pro' | 'enterprise';
  actualLifetimeValue?: number;
};

export const userLTVTrait = defineTrait<User>('User', {
  type: 'predictive',
  name: 'userLTV',
  target: 'actualLifetimeValue',
  features: ['createdAt', 'source', 'monthlySpend', 'monthsActive', 'plan'],
  output: {
    field: 'estimatedLTV',
    taskType: 'regression',
    resolver: (user: User) => user.actualLifetimeValue || 0,
  },
  qualityGates: [
    { metric: 'rmse', threshold: 500, comparison: 'lte', description: 'Must predict within $500 RMSE on test set' },
  ],
});

type ChurnUser = {
  id: string;
  email: string;
  createdAt: Date;
  lastActiveAt: Date;
  monthlySpend: number;
  supportTickets: number;
  willChurn?: boolean;
};

export const userChurnTrait = defineTrait<ChurnUser>('User', {
  type: 'predictive',
  name: 'userChurn',
  target: 'willChurn',
  features: ['lastActiveAt', 'monthlySpend', 'supportTickets'],
  output: {
    field: 'predictedChurn',
    taskType: 'binary_classification',
    resolver: (user: ChurnUser) => user.willChurn || false,
  },
  algorithm: {
    name: 'gbm',
    hyperparameters: { nEstimators: 200, learningRate: 0.1, maxDepth: 5 },
  },
  qualityGates: [
    { metric: 'precision', threshold: 0.8, comparison: 'gte', description: 'Precision must be ≥ 80%' },
    { metric: 'recall', threshold: 0.75, comparison: 'gte', description: 'Recall must be ≥ 75%' },
  ],
});

// ---------------------------------------------------------------------------
// New traits for demo page
// ---------------------------------------------------------------------------

export const serverAnomalyTrait = defineTrait('ServerMetric', {
  type: 'anomaly',
  name: 'serverAnomaly',
  baseline: ['cpuUsage', 'memoryPressure', 'errorRate'],
  sensitivity: 'medium',
});

// categoryInt: 0=laptop, 1=tablet, 2=audio, 3=keyboard, 4=monitor
export const productSimilarityTrait = defineTrait('Product', {
  type: 'similarity',
  name: 'productSimilarity',
  on: ['categoryInt', 'price', 'batteryLife', 'weightKg'],
});

// predict willChurn from a sliding window of weekly engagementScore values
export const engagementSequenceTrait = defineTrait('EngagementEvent', {
  type: 'temporal',
  name: 'engagementSequence',
  sequence: 'engagementScore',
  orderBy: 'occurredAt',
  target: 'willChurn',
  output: { field: 'predictedChurn', taskType: 'binary_classification' },
});

export default defineConfig({
  adapter: 'prisma',
  schema: './prisma/schema.prisma',
  traits: [
    userLTVTrait,
    userChurnTrait,
    serverAnomalyTrait,
    productSimilarityTrait,
    engagementSequenceTrait,
  ] as unknown as AnyTraitDefinition[],
});
