import { readFileSync } from 'node:fs';
import path from 'node:path';
import { PredictionSession, defineModel, type ModelMetadata } from '../../../../packages/scheml/src/index';

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

type User = {
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

const artifactsDir = path.resolve(process.cwd(), 'demo-artifacts');
const schemaPath = path.join(artifactsDir, 'schema.prisma');

export const churnModel = defineModel<User>({
  name: 'userChurn',
  modelName: 'User',
  algorithm: { name: 'gbm' },
  output: {
    field: 'willChurn',
    taskType: 'binary_classification',
    resolver: (u) => u.willChurn,
  },
  features: {
    daysSinceActive: (u) =>
      Math.max(0, Math.floor((DEMO_NOW.getTime() - u.lastActiveAt.getTime()) / DAY_MS)),
    monthlySpend: (u) => Math.max(0, u.monthlySpend),
    supportTickets: (u) => Math.max(0, u.supportTickets),
  },
});

let sessionPromise: Promise<PredictionSession> | undefined;

async function getSession(): Promise<PredictionSession> {
  if (!sessionPromise) {
    sessionPromise = (async () => {
      const session = new PredictionSession();
      await session.load(churnModel, { artifactsDir, schemaPath });
      return session;
    })();
  }
  return sessionPromise;
}

function toDemoEntity(input: DemoPredictionInput, accountId = 'demo-user'): User {
  return {
    id: accountId,
    email: `${accountId}@scheml.dev`,
    createdAt: new Date(DEMO_NOW.getTime() - 365 * DAY_MS),
    lastActiveAt: new Date(DEMO_NOW.getTime() - input.daysSinceActive * DAY_MS),
    monthlySpend: input.monthlySpend,
    supportTickets: input.supportTickets,
    willChurn: false,
  };
}

export async function getDemoModelInfo(): Promise<DemoModelInfo> {
  const raw = readFileSync(path.join(artifactsDir, 'userChurn.metadata.json'), 'utf-8');
  const metadata = JSON.parse(raw) as ModelMetadata;
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
  const result = await session.predict(churnModel, entity);
  return {
    ...result,
    latencyMs: Date.now() - startedAt,
  };
}
