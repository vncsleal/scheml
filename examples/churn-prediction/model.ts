/**
 * Example: Churn Prediction Model
 * 
 * Predicts the likelihood that a user will churn based on their
 * login activity and spending patterns.
 * 
 * Workflow:
 * 1. Define features in TypeScript
 * 2. Train model: npx prisml train -f examples/churn-prediction.ts
 * 3. Run real-time predictions with ONNX
 */

import { defineModel } from '../../src';
import { ONNXInferenceEngine } from '../../src';
import { PrismaClient, User } from '@prisma/client';

/**
 * Churn Prediction Model
 * 
 * Target: User table
 * Output: isChurned (boolean converted to 0/1)
 */
export const churnPredictor = defineModel<User>({
  target: 'User',
  output: 'isChurned',

  features: {
    daysSinceLastLogin: {
      type: 'Int',
      resolve: (user: User) => {
        const lastLogin = new Date(user.lastLogin);
        const now = new Date();
        return Math.floor((now.getTime() - lastLogin.getTime()) / (1000 * 60 * 60 * 24));
      }
    },

    totalSpent: {
      type: 'Float',
      resolve: (user: User) => user.totalSpent || 0
    }
  },

  config: {
    algorithm: 'RandomForest',
    minAccuracy: 0.75,
    testSplit: 0.2
  }
});

churnPredictor.name = 'churnPredictor';

/**
 * Training:
 * npx prisml train -f examples/churn-prediction.ts
 * 
 * This will:
 * - Extract features from all User records in database
 * - Train RandomForest model with scikit-learn
 * - Export ONNX model to prisml/generated/churnPredictor.onnx
 */

/**
 * Usage: Real-time Prediction
// Uncomment this function after training to test predictions
/*
async function predictChurnRisk() {
  const prisma = new PrismaClient();
  
  // Initialize ONNX inference engine
  const engine = new ONNXInferenceEngine(churnPredictor);
  await engine.initialize(); // Loads the .onnx model
  
  try {
    // Get user from database
    const user = await prisma.user.findUnique({
      where: { id: 123 }
    });
    
    if (!user) {
      console.log('User not found');
      return;
    }
    
    // Run prediction (uses ONNX runtime)
    const churnProbability = await engine.predict(user);
    
    console.log(`Churn Risk: ${(churnProbability * 100).toFixed(1)}%`);
    
    if (churnProbability > 0.7) {
      console.log('⚠️  High churn risk - trigger retention campaign');
    }
    
    // Batch prediction example
    const allUsers = await prisma.user.findMany({
      take: 100
    });
    
    const predictions = await engine.predictBatch(allUsers);
    
    const highRiskUsers = allUsers.filter((_, idx) => predictions[idx] > 0.7);
    console.log(`Found ${highRiskUsers.length} high-risk users`);
    
  } finally {
    await engine.dispose(); // Release ONNX session
    await prisma.$disconnect();
  }
}

// Uncomment to run prediction after training
// predictChurnRisk().catch(console.error);
*/
