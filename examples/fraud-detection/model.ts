/**
 * Example: Fraud Detection Model
 * 
 * Predicts the likelihood that a transaction is fraudulent based on
 * transaction patterns, user behavior, and transaction metadata.
 * 
 * Use case: E-commerce platform preventing payment fraud
 */

import { defineModel } from '../../src';

interface Transaction {
  id: number;
  amount: number;
  currency: string;
  createdAt: Date;
  ipAddress: string;
  deviceId: string;
  isInternational: boolean;
  userId: number;

  // Relations
  user?: {
    createdAt: Date;
    totalTransactions: number;
    totalSpent: number;
    isVerified: boolean;
  };

  // Label (ground truth)
  isFraud: boolean;
}

/**
 * Fraud Detection Model
 * 
 * Features engineered to capture suspicious patterns:
 * - Unusually high transaction amounts
 * - New user accounts
 * - International transactions
 * - Unverified accounts
 * - Transaction velocity
 */
export const fraudDetector = defineModel<Transaction>({
  target: 'Transaction',
  output: 'fraudScore',

  features: {
    // Transaction amount (normalized by user's average)
    amountRatio: {
      type: 'Float',
      resolve: (tx) => {
        if (!tx.user || !tx.user.totalSpent || tx.user.totalTransactions === 0) {
          return 1.0; // Default for new users
        }
        const avgSpent = tx.user.totalSpent / tx.user.totalTransactions;
        return tx.amount / Math.max(avgSpent, 1);
      }
    },

    // Account age in days
    accountAge: {
      type: 'Int',
      resolve: (tx) => {
        if (!tx.user) return 0;
        const now = new Date();
        const createdAt = new Date(tx.user.createdAt);
        return Math.floor((now.getTime() - createdAt.getTime()) / 86400000);
      }
    },

    // International transaction flag
    isInternational: {
      type: 'Boolean',
      resolve: (tx) => tx.isInternational
    },

    // Account verification status
    isVerified: {
      type: 'Boolean',
      resolve: (tx) => tx.user?.isVerified || false
    },

    // Transaction history count
    transactionCount: {
      type: 'Int',
      resolve: (tx) => tx.user?.totalTransactions || 0
    },

    // Time of day (0-23) - fraud more common at night
    hourOfDay: {
      type: 'Int',
      resolve: (tx) => {
        const date = new Date(tx.createdAt);
        return date.getHours();
      }
    },

    // Day of week (0-6) - patterns differ by day
    dayOfWeek: {
      type: 'Int',
      resolve: (tx) => {
        const date = new Date(tx.createdAt);
        return date.getDay();
      }
    },

    // Amount in USD cents (normalized)
    amountCents: {
      type: 'Float',
      resolve: (tx) => {
        // Convert to cents and log-scale to handle wide range
        const cents = tx.amount * 100;
        return Math.log10(cents + 1);
      }
    }
  },

  config: {
    algorithm: 'XGBoost', // Best for fraud detection
    minAccuracy: 0.85,    // High accuracy required for production
    testSplit: 0.3        // Use more data for testing
  }
});

fraudDetector.name = 'fraudDetector';

/**
 * Usage Example:
 * 
 * 1. Train the model:
 *    npx prisml train -f examples/fraud-detection/model.ts
 * 
 * 2. Use in production:
 *    const tx = await prisma.transaction.withML({
 *      where: { id: 123 },
 *      include: { user: true }
 *    });
 * 
 *    if (tx._ml.fraudScore > 0.8) {
 *      // Block transaction or require additional verification
 *      await sendVerificationEmail(tx.userId);
 *      await flagForManualReview(tx.id);
 *    }
 * 
 * 3. Monitor and retrain:
 *    - Review flagged transactions
 *    - Update labels based on investigations
 *    - Retrain weekly to adapt to new fraud patterns
 */
