// This file is used by ScheML at compile time to discover models
// Models are discovered via AST analysis and should use defineModel()

import { defineModel, defineTrait } from '@vncsleal/scheml';

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

export const userLTVModel = defineModel<User>({
  name: 'userLTV',
  modelName: 'User',
  output: {
    field: 'estimatedLTV',
    taskType: 'regression',
    resolver: (user: User) => user.actualLifetimeValue || 0,
  },
  features: {
    accountAge: (user: User) => {
      if (!user.createdAt) return null;
      const days = (Date.now() - user.createdAt.getTime()) / (1000 * 60 * 60 * 24);
      return Math.floor(days);
    },
    signupSource: (user: User) => user.source,
    monthlySpend: (user: User) =>
      user.monthsActive > 0 ? user.monthlySpend / user.monthsActive : 0,
    isPremium: (user: User) => user.plan === 'pro' || user.plan === 'enterprise',
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

export const userChurnModel = defineModel<ChurnUser>({
  name: 'userChurn',
  modelName: 'User',
  output: {
    field: 'predictedChurn',
    taskType: 'binary_classification',
    resolver: (user: ChurnUser) => user.willChurn || false,
  },
  features: {
    daysSinceActive: (user: ChurnUser) => {
      const days = (Date.now() - user.lastActiveAt.getTime()) / (1000 * 60 * 60 * 24);
      return Math.max(0, Math.floor(days));
    },
    monthlySpend: (user: ChurnUser) => Math.max(0, user.monthlySpend),
    supportTickets: (user: ChurnUser) => user.supportTickets,
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
  type: 'sequential',
  name: 'engagementSequence',
  sequence: 'engagementScore',
  orderBy: 'occurredAt',
  target: 'willChurn',
  output: { field: 'predictedChurn', taskType: 'binary_classification' },
});
