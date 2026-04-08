import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import type { SimilarityArtifactMetadata, TemporalArtifactMetadata } from '@vncsleal/scheml';

const require = createRequire(import.meta.url);
const ScheML = require('@vncsleal/scheml') as typeof import('@vncsleal/scheml');
const { PredictionSession } = ScheML;

type DemoManifest = {
  generatedAt: string;
  bundleDir: string;
  traits: Array<{
    traitName: string;
    traitType: string;
    artifactFormat: string;
    compiledAt: string;
    schemaHash: string;
    artifactFile: string | null;
    metrics?: Array<{ metric: string; value: number; split?: string }>;
    outputSchemaShape?: string;
    choiceOptions?: string[];
  }>;
  ui: {
    products: Array<{
      id: string;
      name: string;
      categoryLabel: string;
      categoryIndex: number;
      price: number;
      batteryHours: number;
      weightKg: number;
    }>;
    predictivePresets: Record<string, { label: string; daysSinceActive: number; monthlySpend: number; supportTickets: number }>;
    anomalyPresets: Record<string, { label: string; cpuUsage: number; memoryPressure: number; errorRate: number }>;
    similarityPresets: Record<string, { label: string; categoryIndex: number; price: number; batteryHours: number; weightKg: number; limit: number }>;
    temporalPresets: Record<string, { label: string; scores: number[] }>;
    generativeExamples: Record<string, { label: string; context: Record<string, string | number | boolean>; expectedShape: string }>;
    categories: Array<{ value: number; label: string }>;
  };
};

export type PredictiveInput = {
  daysSinceActive: number;
  monthlySpend: number;
  supportTickets: number;
};

export type AnomalyInput = {
  cpuUsage: number;
  memoryPressure: number;
  errorRate: number;
};

export type SimilarityInput = {
  categoryIndex: number;
  price: number;
  batteryHours: number;
  weightKg: number;
  limit: number;
};

export type TemporalInput = {
  scores: number[];
};

const DAY_MS = 86_400_000;
const DEMO_NOW = new Date('2026-04-07T12:00:00.000Z');
// process.cwd() is /var/task on Vercel Lambda (where includeFiles places demo-bundle)
// and apps/website/ in local dev — both correct. import.meta.url is NOT reliable
// after Vite bundling because chunks land in chunks/ making relative paths wrong.
const bundleDir = path.resolve(process.cwd(), 'demo-bundle');
const schemaPath = path.join(bundleDir, 'schema.source');
const manifestPath = path.join(bundleDir, 'demo.manifest.json');

let manifestCache: DemoManifest | undefined;
let sessionPromise: Promise<PredictionSession> | undefined;
const loadedTraits = new Set<string>();
const temporalFeatureCache = new Map<string, string[]>();

function readJsonFile<T>(fileName: string): T {
  return JSON.parse(readFileSync(path.join(bundleDir, fileName), 'utf-8')) as T;
}

async function getSession() {
  if (!sessionPromise) {
    sessionPromise = Promise.resolve(new PredictionSession());
  }

  return sessionPromise;
}

async function ensureTraitLoaded(traitName: string) {
  if (loadedTraits.has(traitName)) {
    return getSession();
  }

  const session = await getSession();
  await session.loadTrait(traitName, {
    artifactsDir: bundleDir,
    schemaPath,
    adapter: 'prisma',
  });
  loadedTraits.add(traitName);
  return session;
}

function aggregateScores(scores: number[], aggregation: string) {
  if (aggregation === 'mean') {
    return scores.reduce((sum, value) => sum + value, 0) / scores.length;
  }
  if (aggregation === 'sum') {
    return scores.reduce((sum, value) => sum + value, 0);
  }
  if (aggregation === 'min') {
    return Math.min(...scores);
  }
  if (aggregation === 'max') {
    return Math.max(...scores);
  }
  if (aggregation === 'last') {
    return scores[scores.length - 1];
  }
  throw new Error(`Unsupported aggregation in temporal artifact: ${aggregation}`);
}

function getTemporalFeatureNames() {
  const cacheKey = 'engagementSequence';
  const cached = temporalFeatureCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const metadata = readJsonFile<TemporalArtifactMetadata>('engagementSequence.metadata.json');
  const featureNames = metadata.features?.order ?? [];
  temporalFeatureCache.set(cacheKey, featureNames);
  return featureNames;
}

function buildTemporalEntity(scores: number[]) {
  const featureNames = getTemporalFeatureNames();
  const entity: Record<string, number> = {};

  for (const featureName of featureNames) {
    const aggregation = featureName.split('__').at(-1);
    if (!aggregation) {
      throw new Error(`Temporal feature name is missing aggregation suffix: ${featureName}`);
    }
    entity[featureName] = aggregateScores(scores, aggregation);
  }

  return entity;
}

function getManifest() {
  if (!manifestCache) {
    manifestCache = JSON.parse(readFileSync(manifestPath, 'utf-8')) as DemoManifest;
  }

  return manifestCache;
}

function getTraitSummary(traitName: string) {
  const trait = getManifest().traits.find((entry) => entry.traitName === traitName);
  if (!trait) {
    throw new Error(`Missing trait summary in demo manifest: ${traitName}`);
  }
  return trait;
}

export function getDemoManifest() {
  return getManifest();
}

export function getDemoTraitSummary(traitName: string) {
  return getTraitSummary(traitName);
}

export async function runPredictiveDemo(input: PredictiveInput) {
  const session = await ensureTraitLoaded('userChurn');
  const entity = {
    id: 'demo-user',
    email: 'demo-user@scheml.dev',
    createdAt: new Date(DEMO_NOW.getTime() - 320 * DAY_MS),
    lastActiveAt: new Date(DEMO_NOW.getTime() - input.daysSinceActive * DAY_MS),
    monthlySpend: input.monthlySpend,
    supportTickets: input.supportTickets,
    planTier: 'growth',
    willChurn: false,
  };
  const startedAt = Date.now();
  const result = await session.predict('userChurn', entity, {
    lastActiveAt: (row) => row.lastActiveAt,
    monthlySpend: (row) => row.monthlySpend,
    supportTickets: (row) => row.supportTickets,
  });

  return {
    ...result,
    label: String(result.prediction) === '1' ? 'Will churn' : 'Will retain',
    latencyMs: Date.now() - startedAt,
    trait: getTraitSummary('userChurn'),
  };
}

export async function runAnomalyDemo(input: AnomalyInput) {
  const session = await ensureTraitLoaded('serverAnomaly');
  const startedAt = Date.now();
  const result = await session.predict('serverAnomaly', input, {
    cpuUsage: (row) => row.cpuUsage,
    memoryPressure: (row) => row.memoryPressure,
    errorRate: (row) => row.errorRate,
  });
  const score = Number(result.prediction);

  return {
    ...result,
    score,
    isAnomaly: score >= 0.5,
    label: score >= 0.5 ? 'Anomaly detected' : 'Within normal range',
    latencyMs: Date.now() - startedAt,
    trait: getTraitSummary('serverAnomaly'),
  };
}

export async function runSimilarityDemo(input: SimilarityInput) {
  const session = await ensureTraitLoaded('productSimilarity');
  const products = new Map(getManifest().ui.products.map((product) => [product.id, product]));
  const startedAt = Date.now();
  const result = await session.predictSimilarity('productSimilarity', input, {
    categoryIndex: (row) => row.categoryIndex,
    price: (row) => row.price,
    batteryHours: (row) => row.batteryHours,
    weightKg: (row) => row.weightKg,
  }, { limit: input.limit });

  return {
    ...result,
    matches: result.matches.map((match) => ({
      ...match,
      product: products.get(String(match.entityId)) ?? null,
    })),
    latencyMs: Date.now() - startedAt,
    trait: getTraitSummary('productSimilarity'),
  };
}

export async function runTemporalDemo(input: TemporalInput) {
  const session = await ensureTraitLoaded('engagementSequence');
  const entity = buildTemporalEntity(input.scores);
  const resolvers = Object.fromEntries(
    Object.keys(entity).map((key) => [key, (row: Record<string, number>) => row[key]])
  ) as Record<string, (row: Record<string, number>) => unknown>;
  const startedAt = Date.now();
  const result = await session.predict('engagementSequence', entity, resolvers);

  return {
    ...result,
    label: String(result.prediction) === '1' ? 'Churn risk' : 'Stable trajectory',
    latencyMs: Date.now() - startedAt,
    derivedFeatures: entity,
    trait: getTraitSummary('engagementSequence'),
  };
}

export function getGenerativeDemoContract() {
  return {
    trait: getTraitSummary('retentionMessage'),
    examples: getManifest().ui.generativeExamples,
  };
}

export function getSimilarityMetadata() {
  return readJsonFile<SimilarityArtifactMetadata>('productSimilarity.metadata.json');
}