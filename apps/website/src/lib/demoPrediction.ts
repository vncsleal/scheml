import { readFile } from 'fs/promises';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import type { ModelMetadata } from '@vncsleal/prisml-core';

export type DemoPredictionInput = {
  daysSinceActive: number;
  monthlySpend: number;
  supportTickets: number;
};

export type DemoModelInfo = {
  modelName: string;
  taskType: string;
  algorithm: string;
  compiledAt: string;
};

type DemoEntity = {
  id: string;
  email: string;
  createdAt: Date;
  lastActiveAt: Date;
  monthlySpend: number;
  supportTickets: number;
  willChurn: boolean;
};

const DEMO_NOW = new Date('2026-03-08T12:00:00.000Z');
const DAY_MS = 86_400_000;

const schemaPath = fileURLToPath(
  new URL('../../../../examples/basic/prisma/schema.prisma', import.meta.url)
);
const metadataPath = fileURLToPath(
  new URL('../../demo-artifacts/userChurn.metadata.json', import.meta.url)
);
const onnxPath = fileURLToPath(
  new URL('../../demo-artifacts/userChurn.onnx', import.meta.url)
);

const require = createRequire(import.meta.url);
const prismlCore = require('@vncsleal/prisml-core') as typeof import('@vncsleal/prisml-core');
const prismlRuntime = require('@vncsleal/prisml-runtime') as typeof import('@vncsleal/prisml-runtime');

const demoFeatureResolvers = {
  daysSinceActive: (user: DemoEntity) => {
    const days = (DEMO_NOW.getTime() - user.lastActiveAt.getTime()) / DAY_MS;
    return Math.max(0, Math.floor(days));
  },
  monthlySpend: (user: DemoEntity) => Math.max(0, user.monthlySpend),
  supportTickets: (user: DemoEntity) => Math.max(0, user.supportTickets),
};

let metadataPromise: Promise<ModelMetadata> | undefined;
let sessionPromise: Promise<import('@vncsleal/prisml-runtime').PredictionSession> | undefined;

async function getMetadata(): Promise<ModelMetadata> {
  if (!metadataPromise) {
    metadataPromise = readFile(metadataPath, 'utf-8').then((raw) => JSON.parse(raw) as ModelMetadata);
  }
  return metadataPromise;
}

async function getSession(): Promise<import('@vncsleal/prisml-runtime').PredictionSession> {
  if (!sessionPromise) {
    sessionPromise = (async () => {
      const schema = await readFile(schemaPath, 'utf-8');
      const schemaHash = prismlCore.hashPrismaSchema(schema);
      const session = new prismlRuntime.PredictionSession();
      await session.initializeModel(metadataPath, onnxPath, schemaHash);
      return session;
    })();
  }
  return sessionPromise;
}

function toDemoEntity(input: DemoPredictionInput, accountId = 'demo-user'): DemoEntity {
  return {
    id: accountId,
    email: `${accountId}@prisml.dev`,
    createdAt: new Date(DEMO_NOW.getTime() - 365 * DAY_MS),
    lastActiveAt: new Date(DEMO_NOW.getTime() - input.daysSinceActive * DAY_MS),
    monthlySpend: input.monthlySpend,
    supportTickets: input.supportTickets,
    willChurn: false,
  };
}

export async function getDemoModelInfo(): Promise<DemoModelInfo> {
  const metadata = await getMetadata();
  return {
    modelName: metadata.modelName,
    taskType: metadata.taskType,
    algorithm: metadata.algorithm.name,
    compiledAt: metadata.compiledAt,
  };
}

export async function predictDemoChurn(
  input: DemoPredictionInput,
  accountId = 'demo-user',
) {
  const session = await getSession();
  const entity = toDemoEntity(input, accountId);
  const startedAt = Date.now();
  const result = await session.predict('userChurn', entity, demoFeatureResolvers);
  return {
    ...result,
    latencyMs: Date.now() - startedAt,
  };
}
