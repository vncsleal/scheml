// This file is used by ScheML at compile time to discover models
// Models are discovered via AST analysis and should use defineModel()

import { defineModel } from '@vncsleal/scheml';

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

/**
 * User Lifetime Value (LTV) Prediction Model
 * Predicts estimated customer LTV based on signup and behavioral signals
 */
export const userLTVModel = defineModel<User>({
  name: 'userLTV',
  modelName: 'User',

  output: {
    field: 'estimatedLTV',
    taskType: 'regression',
    // Label resolver: used only during training to get actual LTV
    resolver: (user: User) => user.actualLifetimeValue || 0,
  },

  features: {
    // Account age in days
    accountAge: (user: User) => {
      if (!user.createdAt) return null;
      const days = (Date.now() - user.createdAt.getTime()) / (1000 * 60 * 60 * 24);
      return Math.floor(days);
    },

    // Signup source: categorical
    signupSource: (user: User) => user.source,

    // Monthly spend (numeric)
    monthlySpend: (user: User) =>
      user.monthsActive > 0 ? user.monthlySpend / user.monthsActive : 0,

    // Premium flag: boolean → encoded as 0/1
    isPremium: (user: User) => user.plan === 'pro' || user.plan === 'enterprise',
  },

  // algorithm is omitted — FLAML AutoML will select and tune the best estimator

  qualityGates: [
    {
      metric: 'rmse',
      threshold: 500,
      comparison: 'lte',
      description: 'Must predict within $500 RMSE on test set',
    },
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

/**
 * Customer Churn Prediction
 * Binary classification: predict if user will churn in next 30 days
 */
export const userChurnModel = defineModel<ChurnUser>({
  name: 'userChurn',
  modelName: 'User',

  output: {
    field: 'predictedChurn',
    taskType: 'binary_classification',
    resolver: (user: ChurnUser) => user.willChurn || false,
  },

  features: {
    // Days since last active
    daysSinceActive: (user: ChurnUser) => {
      const days = (Date.now() - user.lastActiveAt.getTime()) / (1000 * 60 * 60 * 24);
      return Math.max(0, Math.floor(days));
    },

    // Monthly spend (0-1 normalized would be done at training time)
    monthlySpend: (user: ChurnUser) => Math.max(0, user.monthlySpend),

    // Support engagement
    supportTickets: (user: ChurnUser) => user.supportTickets,
  },

  // Explicit override example: use GBM with custom hyperparameters
  algorithm: {
    name: 'gbm',
    hyperparameters: {
      nEstimators: 200,
      learningRate: 0.1,
      maxDepth: 5,
    },
  },

  qualityGates: [
    {
      metric: 'precision',
      threshold: 0.8,
      comparison: 'gte',
      description: 'Precision must be ≥ 80%',
    },
    {
      metric: 'recall',
      threshold: 0.75,
      comparison: 'gte',
      description: 'Recall must be ≥ 75%',
    },
  ],
});
