import { PrismaClient } from '@prisma/client';
import { prisml, defineModel } from '../../src';

const churnModel = defineModel({
  target: 'User',
  output: 'churnProbability',
  features: {
    totalSpent: {
      type: 'Float',
      resolve: (user: any) => user.totalSpent
    },
    daysSinceLastLogin: {
      type: 'Int',
      resolve: (user: any) => user.daysSinceLastLogin
    },
    accountAge: {
      type: 'Int',
      resolve: (user: any) => {
        const createdAt = new Date(user.createdAt);
        const now = new Date();
        return Math.floor((now.getTime() - createdAt.getTime()) / (1000 * 60 * 60 * 24));
      }
    }
  },
  config: {
    minAccuracy: 0.75
  }
});

churnModel.name = 'churnPredictor';

const prisma = new PrismaClient().$extends(prisml([churnModel]));

async function main() {
  console.log('Batch Predictions Example\n');

  // Example 1: Process recent users
  console.log('Example 1: Recent high-risk users');
  // @ts-ignore - Dynamic extension method
  const recentUsers = await prisma.user.withMLMany({
    where: {
      createdAt: {
        gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) // Last 7 days
      }
    },
    take: 50
  });

  console.log(`Processed ${recentUsers.length} users`);
  const highRisk = recentUsers.filter((u: any) => u._ml.churnProbability > 0.7);
  console.log(`High churn risk: ${highRisk.length} users\n`);

  // Example 2: Segment customers by risk
  console.log('Example 2: Customer segmentation');
  // @ts-ignore - Dynamic extension method
  const allUsers = await prisma.user.withMLMany({
    take: 1000,
    orderBy: { totalSpent: 'desc' }
  });

  const segments = {
    highValue_lowRisk: allUsers.filter((u: any) => u.totalSpent > 500 && u._ml.churnProbability < 0.3),
    highValue_highRisk: allUsers.filter((u: any) => u.totalSpent > 500 && u._ml.churnProbability >= 0.7),
    lowValue_lowRisk: allUsers.filter((u: any) => u.totalSpent <= 500 && u._ml.churnProbability < 0.3),
    lowValue_highRisk: allUsers.filter((u: any) => u.totalSpent <= 500 && u._ml.churnProbability >= 0.7)
  };

  console.log('Segmentation results:');
  console.log(`- High-value, Low-risk: ${segments.highValue_lowRisk.length}`);
  console.log(`- High-value, High-risk: ${segments.highValue_highRisk.length}`);
  console.log(`- Low-value, Low-risk: ${segments.lowValue_lowRisk.length}`);
  console.log(`- Low-value, High-risk: ${segments.lowValue_highRisk.length}\n`);

  // Example 3: Daily batch prediction job
  console.log('Example 3: Daily batch job simulation');
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
  // @ts-ignore - Dynamic extension method
  const activeUsers = await prisma.user.withMLMany({
    where: {
      OR: [
        { lastLoginAt: { gte: yesterday } },
        { updatedAt: { gte: yesterday } }
      ]
    }
  });

  // Generate retention campaign list
  const retentionCampaign = activeUsers
    .filter((u: any) => u._ml.churnProbability > 0.6)
    .map((u: any) => ({
      userId: u.id,
      email: u.email,
      churnRisk: u._ml.churnProbability,
      recommendedAction: u._ml.churnProbability > 0.8 ? 'urgent_discount' : 'engagement_email'
    }));

  console.log(`Retention campaign targets: ${retentionCampaign.length} users`);
  console.log('Sample actions:');
  retentionCampaign.slice(0, 5).forEach((action: any) => {
    console.log(`  - User ${action.userId}: ${action.recommendedAction} (risk: ${action.churnRisk.toFixed(2)})`);
  });

  // Example 4: Performance metrics
  console.log('\nExample 4: Performance comparison');

  // Sequential approach (slower)
  const start1 = Date.now();
  const sequentialResults = [];
  for (let i = 0; i < 10; i++) {
    // @ts-ignore - Dynamic extension method
    const user = await prisma.user.withML({ where: { id: i + 1 } });
    if (user) sequentialResults.push(user);
  }
  const sequential_time = Date.now() - start1;

  // Batch approach (faster)
  const start2 = Date.now();
  // @ts-ignore - Dynamic extension method
  const batchResults = await prisma.user.withMLMany({
    where: { id: { in: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] } }
  });
  const batch_time = Date.now() - start2;

  console.log(`Sequential (10 calls): ${sequential_time}ms`);
  console.log(`Batch (1 call): ${batch_time}ms`);
  console.log(`Performance gain: ${(sequential_time / batch_time).toFixed(1)}x faster`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
