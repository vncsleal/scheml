import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import {
  PredictionSession,
  SchemaDriftError,
  createPrismaAdapter,
  hashSchemaSource,
} from '../src/index';
import type { ScheMLAdapter, FieldSchema } from '../src/adapters/interface';
import type { GenerativeTrait } from '../src/traitTypes';
import { createAdvancedTempProject, createTempProject } from './support/project';

type Product = {
  recentAvgViews: number;
  recentTotalViews: number;
  recentMinViews: number;
  recentMaxViews: number;
};

type AdvancedProduct = Product & {
  price: number;
  rating: number;
  windowMean: number;
  windowSum: number;
  windowMin: number;
  windowMax: number;
  planTier: string;
  churned: boolean;
};

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'scheml-pipeline-'));
const advancedTempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'scheml-pipeline-advanced-'));

let schemaPath = '';
let artifactsDir = '';
let metadataPath = '';
let onnxPath = '';
let schemaHash = '';
let advancedSchemaPath = '';
let advancedArtifactsDir = '';
let predictiveTraitName = '';
let anomalyTraitName = '';
let similarityTraitName = '';
let temporalTraitName = '';
let generativeTraitName = '';

const resolvers = {
  recentAvgViews: (entity: Product) => entity.recentAvgViews,
  recentTotalViews: (entity: Product) => entity.recentTotalViews,
  recentMinViews: (entity: Product) => entity.recentMinViews,
  recentMaxViews: (entity: Product) => entity.recentMaxViews,
};

const adapter = createPrismaAdapter();

function stableEntityHash(entityName: string, fields: Record<string, FieldSchema>): string {
  const payload = {
    name: entityName,
    fields: Object.entries(fields)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([fieldName, field]) => ({
        fieldName,
        scalarType: field.scalarType,
        nullable: field.nullable,
        isEnum: field.isEnum,
      })),
  };

  return crypto.createHash('sha256').update(JSON.stringify(payload), 'utf-8').digest('hex');
}

function createFixtureAdapter(): ScheMLAdapter {
  return {
    name: 'fixture',
    reader: {
      readSchema: async (source: string) => {
        const parsed = JSON.parse(fs.readFileSync(source, 'utf-8')) as {
          entities: Record<string, { fields: Record<string, FieldSchema> }>;
        };

        return {
          entities: new Map(
            Object.entries(parsed.entities).map(([name, entity]) => [name, { name, fields: entity.fields }])
          ),
          rawSource: JSON.stringify(parsed),
        };
      },
      hashModel: (graph, modelName) => {
        const entity = graph.entities.get(modelName);
        if (!entity) {
          return stableEntityHash(modelName, {});
        }
        return stableEntityHash(modelName, entity.fields);
      },
    },
  };
}

function product(overrides: Partial<Product> = {}): Product {
  return {
    recentAvgViews: 100,
    recentTotalViews: 450,
    recentMinViews: 80,
    recentMaxViews: 160,
    ...overrides,
  };
}

beforeAll(async () => {
  const project = await createTempProject(tempRoot);
  schemaPath = project.schemaPath;
  artifactsDir = project.artifactsDir;
  metadataPath = project.metadataPath;
  onnxPath = project.onnxPath;
  schemaHash = project.schemaHash;

  const advancedProject = await createAdvancedTempProject(advancedTempRoot);
  advancedSchemaPath = advancedProject.schemaPath;
  advancedArtifactsDir = advancedProject.artifactsDir;
  predictiveTraitName = advancedProject.predictiveTraitName;
  anomalyTraitName = advancedProject.anomalyTraitName;
  similarityTraitName = advancedProject.similarityTraitName;
  temporalTraitName = advancedProject.temporalTraitName;
  generativeTraitName = advancedProject.generativeTraitName;
});

afterAll(() => {
  fs.rmSync(tempRoot, { recursive: true, force: true });
  fs.rmSync(advancedTempRoot, { recursive: true, force: true });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.doUnmock('ai');
});

describe('PredictionSession integration', () => {
  it('loads a generated trait artifact from disk', async () => {
    const session = new PredictionSession();
    await session.loadTrait('productSales', { artifactsDir, schemaPath, adapter });
    await expect(session.disposeAll()).resolves.toBeUndefined();
  });

  it('produces a finite regression prediction', async () => {
    const session = new PredictionSession();
    await session.loadTrait('productSales', { artifactsDir, schemaPath, adapter });

    const result = await session.predict('productSales', product(), resolvers);

    expect(result.modelName).toBe('productSales');
    expect(Number.isFinite(result.prediction as number)).toBe(true);
    await session.disposeAll();
  });

  it('returns different outputs for different feature vectors', async () => {
    const session = new PredictionSession();
    await session.loadTrait('productSales', { artifactsDir, schemaPath, adapter });

    const low = await session.predict('productSales', product({ recentTotalViews: 100 }), resolvers);
    const high = await session.predict('productSales', product({ recentTotalViews: 900 }), resolvers);

    expect(low.prediction).not.toBe(high.prediction);
    await session.disposeAll();
  });

  it('supports batch prediction across multiple entities', async () => {
    const session = new PredictionSession();
    await session.loadTrait('productSales', { artifactsDir, schemaPath, adapter });

    const batch = await session.predictBatch('productSales', [
      product({ recentAvgViews: 90 }),
      product({ recentAvgViews: 120 }),
      product({ recentAvgViews: 150 }),
    ], resolvers);

    expect(batch.results).toHaveLength(3);
    expect(batch.successCount).toBe(3);
    expect(batch.results.every((result) => Number.isFinite(result.prediction as number))).toBe(true);
    await session.disposeAll();
  });

  it('rejects initialization when the runtime schema hash differs', async () => {
    const session = new PredictionSession();
    await expect(
      session.initializeModel(metadataPath, onnxPath, '0'.repeat(64))
    ).rejects.toBeInstanceOf(SchemaDriftError);
  });

  it('keeps the generated schema hash stable for repeated reads', async () => {
    const firstHash = await hashSchemaSource(schemaPath, adapter.reader, 'Product');
    const secondHash = await hashSchemaSource(schemaPath, adapter.reader, 'Product');

    expect(firstHash).toBe(secondHash);
    expect(schemaHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('disposeAll is idempotent for loaded sessions', async () => {
    const session = new PredictionSession();
    await session.loadTrait('productSales', { artifactsDir, schemaPath, adapter });

    await expect(session.disposeAll()).resolves.toBeUndefined();
    await expect(session.disposeAll()).resolves.toBeUndefined();
  });
});

describe('PredictionSession advanced trait integration', () => {
  const fixtureAdapter = createFixtureAdapter();

  function advancedProduct(overrides: Partial<AdvancedProduct> = {}): AdvancedProduct {
    return {
      recentAvgViews: 100,
      recentTotalViews: 450,
      recentMinViews: 80,
      recentMaxViews: 160,
      price: 1,
      rating: 0,
      windowMean: 12,
      windowSum: 48,
      windowMin: 8,
      windowMax: 18,
      planTier: 'growth',
      churned: false,
      ...overrides,
    };
  }

  it('produces an anomaly score from a trained artifact on disk', async () => {
    const session = new PredictionSession();
    await session.loadTrait(anomalyTraitName, {
      artifactsDir: advancedArtifactsDir,
      schemaPath: advancedSchemaPath,
      adapter: fixtureAdapter,
    });

    const result = await session.predict(anomalyTraitName, advancedProduct({ recentTotalViews: 700, recentMaxViews: 220 }), {
      recentTotalViews: (entity: AdvancedProduct) => entity.recentTotalViews,
      recentMaxViews: (entity: AdvancedProduct) => entity.recentMaxViews,
    });

    expect(typeof result.prediction).toBe('number');
    expect((result.prediction as number)).toBeGreaterThan(0.5);
  });

  it('returns nearest neighbors for a similarity artifact on disk', async () => {
    const session = new PredictionSession();
    await session.loadTrait(similarityTraitName, {
      artifactsDir: advancedArtifactsDir,
      schemaPath: advancedSchemaPath,
      adapter: fixtureAdapter,
    });

    const result = await session.predictSimilarity(similarityTraitName, advancedProduct({ price: 1, rating: 0 }), {
      price: (entity: AdvancedProduct) => entity.price,
      rating: (entity: AdvancedProduct) => entity.rating,
    }, { limit: 2 });

    expect(result.matches).toHaveLength(2);
    expect(result.matches[0]?.entityId).toBe('p1');
    expect(result.matches[1]?.entityId).toBe('p2');
  });

  it('runs temporal inference from a real ONNX artifact on disk', async () => {
    const session = new PredictionSession();
    await session.loadTrait(temporalTraitName, {
      artifactsDir: advancedArtifactsDir,
      schemaPath: advancedSchemaPath,
      adapter: fixtureAdapter,
    });

    const result = await session.predict(temporalTraitName, advancedProduct(), {
      windowMean: (entity: AdvancedProduct) => entity.windowMean,
      windowSum: (entity: AdvancedProduct) => entity.windowSum,
      windowMin: (entity: AdvancedProduct) => entity.windowMin,
      windowMax: (entity: AdvancedProduct) => entity.windowMax,
    });

    expect(result.modelName).toBe(temporalTraitName);
    expect(Number.isFinite(result.prediction as number)).toBe(true);
  });

  it('runs generative inference through the public runtime API', async () => {
    const provider = { model: 'fixture-provider' };
    const generateText = vi.fn(async ({ prompt }: { model: unknown; prompt: string }) => ({
      text: `generated:${prompt.includes('growth') ? 'growth' : 'other'}`,
    }));

    vi.doMock('ai', () => ({
      generateText,
      generateObject: vi.fn(),
    }));

    const session = new PredictionSession({ generativeProvider: provider });
    const trait: GenerativeTrait<AdvancedProduct> = {
      type: 'generative',
      name: generativeTraitName,
      entity: 'Product',
      context: ['planTier', 'churned', 'recentTotalViews'],
      prompt: 'Write a short retention message for this account.',
    } as GenerativeTrait<AdvancedProduct>;

    const result = await session.predictGenerative(trait, advancedProduct({ planTier: 'growth', churned: true }));

    expect(generateText).toHaveBeenCalledOnce();
    expect(result.traitName).toBe(generativeTraitName);
    expect(result.result).toBe('generated:growth');
  });

  it('can still load the predictive artifact from the advanced fixture project', async () => {
    const session = new PredictionSession();
    await session.loadTrait(predictiveTraitName, {
      artifactsDir: advancedArtifactsDir,
      schemaPath: advancedSchemaPath,
      adapter: fixtureAdapter,
    });

    const result = await session.predict(predictiveTraitName, advancedProduct(), {
      recentAvgViews: (entity: AdvancedProduct) => entity.recentAvgViews,
      recentTotalViews: (entity: AdvancedProduct) => entity.recentTotalViews,
      recentMinViews: (entity: AdvancedProduct) => entity.recentMinViews,
      recentMaxViews: (entity: AdvancedProduct) => entity.recentMaxViews,
    });

    expect(Number.isFinite(result.prediction as number)).toBe(true);
  });
});