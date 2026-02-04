/**
 * Example: Runtime Predictions
 * Demonstrates how to use trained models in an application
 */

import { PredictionSession, hashPrismaSchema } from '@vncsleal/prisml';
import * as fs from 'fs';

type SampleUser = {
  id: string;
  email: string;
  createdAt: Date;
  source: string;
  monthlySpend: number;
  monthsActive: number;
  plan: string;
};

// Sample Prisma schema
const sampleSchema = `
  model User {
    id String @id
    email String @unique
    createdAt DateTime @default(now())
    source String
    monthlySpend Float
    monthsActive Int
    plan String
  }
`;

// Sample user for predictions
const sampleUser: SampleUser = {
  id: '1',
  email: 'user@example.com',
  createdAt: new Date('2023-01-01'),
  source: 'organic',
  monthlySpend: 1500,
  monthsActive: 24,
  plan: 'pro',
};

async function main() {
  try {
    const session = new PredictionSession();

    // Initialize model (in real app, paths point to compiled artifacts)
    const schemaHash = hashPrismaSchema(sampleSchema);
    const metadataPath = './prisml-artifacts/userLTV.metadata.json';
    const onnxPath = './prisml-artifacts/userLTV.onnx';

    console.log('Initializing model...');
    if (fs.existsSync(metadataPath) && fs.existsSync(onnxPath)) {
      await session.initializeModel(metadataPath, onnxPath, schemaHash);
      console.log('[OK] Model initialized');
    } else {
      console.log(
        '⚠ Artifacts not found. Run: prisml train --config ./prisml.config.ts'
      );
      return;
    }

    // Run predictions
    console.log('\nRunning predictions...');
    const result = await session.predict('userLTV', sampleUser, {
      accountAge: (user: SampleUser) => {
        const days = (Date.now() - user.createdAt.getTime()) / (1000 * 60 * 60 * 24);
        return Math.floor(days);
      },
      signupSource: (user: SampleUser) => user.source,
      monthlySpend: (user: SampleUser) =>
        user.monthsActive > 0 ? user.monthlySpend / user.monthsActive : 0,
      isPremium: (user: SampleUser) => user.plan === 'pro' || user.plan === 'enterprise',
    });

    console.log('[OK] Predictions complete');
    console.log(JSON.stringify(result, null, 2));

    // Batch predictions
    console.log('\nRunning batch predictions...');
    const batch: SampleUser[] = [sampleUser, { ...sampleUser, id: '2', monthlySpend: 2500 }];
    const batchResult = await session.predictBatch('userLTV', batch, {
      accountAge: (user: SampleUser) => {
        const days = (Date.now() - user.createdAt.getTime()) / (1000 * 60 * 60 * 24);
        return Math.floor(days);
      },
      signupSource: (user: SampleUser) => user.source,
      monthlySpend: (user: SampleUser) =>
        user.monthsActive > 0 ? user.monthlySpend / user.monthsActive : 0,
      isPremium: (user: SampleUser) => user.plan === 'pro' || user.plan === 'enterprise',
    });

    console.log(
      `[OK] Batch predictions complete: ${batchResult.successCount}/${batch.length}`
    );

    await session.disposeAll();
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

main();

