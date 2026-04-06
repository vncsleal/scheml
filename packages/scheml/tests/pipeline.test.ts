import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  PredictionSession,
  SchemaDriftError,
  createPrismaAdapter,
  hashSchemaSource,
} from '../src/index';
import { createTempProject } from './support/project';

type Product = {
  recentAvgViews: number;
  recentTotalViews: number;
  recentMinViews: number;
  recentMaxViews: number;
};

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'scheml-pipeline-'));

let schemaPath = '';
let artifactsDir = '';
let metadataPath = '';
let onnxPath = '';
let schemaHash = '';

const resolvers = {
  recentAvgViews: (entity: Product) => entity.recentAvgViews,
  recentTotalViews: (entity: Product) => entity.recentTotalViews,
  recentMinViews: (entity: Product) => entity.recentMinViews,
  recentMaxViews: (entity: Product) => entity.recentMaxViews,
};

const adapter = createPrismaAdapter();

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
});

afterAll(() => {
  fs.rmSync(tempRoot, { recursive: true, force: true });
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