import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { ModelMetadataLoader, FeatureExtractor, PredictionSession } from './prediction';
import { SchemaDriftError, ArtifactError, FeatureExtractionError } from './errors';
import type { ModelMetadata, FeatureSchema } from './types';
import { defineModel } from './defineModel';
import { hashPrismaModelSubset } from './schema';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMetadata(overrides: Partial<ModelMetadata> = {}): ModelMetadata {
  const base: ModelMetadata = {
    version: '0.1.0',
    metadataSchemaVersion: '1.1.0',
    modelName: 'TestModel',
    taskType: 'regression',
    algorithm: { name: 'forest' },
    features: {
      features: [
        { name: 'price', index: 0, originalType: 'number', columnCount: 1 },
        { name: 'stock', index: 1, originalType: 'number', columnCount: 1 },
      ],
      count: 2,
      order: ['price', 'stock'],
    },
    output: { field: 'sales', shape: [1] },
    encoding: {},
    imputation: {},
    scaling: {},
    prismaSchemaHash: 'abc123hashvalue',
    compiledAt: new Date().toISOString(),
  };
  return { ...base, ...overrides };
}

let tmpDir: string;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scheml-test-'));
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function writeTmpMetadata(name: string, metadata: ModelMetadata): string {
  const filePath = path.join(tmpDir, `${name}.metadata.json`);
  fs.writeFileSync(filePath, JSON.stringify(metadata, null, 2));
  return filePath;
}

// ---------------------------------------------------------------------------
// ModelMetadataLoader
// ---------------------------------------------------------------------------

describe('ModelMetadataLoader', () => {
  it('loads valid metadata from a file', () => {
    const meta = makeMetadata();
    const filePath = writeTmpMetadata('ValidModel', meta);

    const loader = new ModelMetadataLoader();
    const loaded = loader.loadMetadata(filePath);

    expect(loaded.modelName).toBe('TestModel');
    expect(loaded.taskType).toBe('regression');
    expect(loaded.prismaSchemaHash).toBe('abc123hashvalue');
  });

  it('caches: returns same reference on repeated calls', () => {
    const meta = makeMetadata({ modelName: 'CachedModel' });
    const filePath = writeTmpMetadata('CachedModel', meta);

    const loader = new ModelMetadataLoader();
    const first = loader.loadMetadata(filePath);
    const second = loader.loadMetadata(filePath);

    expect(first).toBe(second);
  });

  it('throws ArtifactError for missing modelName', () => {
    const meta = makeMetadata({ modelName: '' });
    const filePath = writeTmpMetadata('NoName', meta);

    const loader = new ModelMetadataLoader();
    expect(() => loader.loadMetadata(filePath)).toThrow(ArtifactError);
  });

  it('throws ArtifactError for missing prismaSchemaHash', () => {
    const meta = makeMetadata({ prismaSchemaHash: '' as any });
    const filePath = writeTmpMetadata('NoHash', meta);

    const raw = JSON.parse(fs.readFileSync(path.join(tmpDir, 'NoHash.metadata.json'), 'utf-8'));
    delete raw.prismaSchemaHash;
    fs.writeFileSync(path.join(tmpDir, 'NoHash.metadata.json'), JSON.stringify(raw));

    const loader = new ModelMetadataLoader();
    expect(() =>
      loader.loadMetadata(path.join(tmpDir, 'NoHash.metadata.json'))
    ).toThrow(ArtifactError);
  });

  it('throws ArtifactError for invalid JSON', () => {
    const filePath = path.join(tmpDir, 'BadJSON.metadata.json');
    fs.writeFileSync(filePath, '{ this is: not json }');

    const loader = new ModelMetadataLoader();
    expect(() => loader.loadMetadata(filePath)).toThrow(ArtifactError);
  });

  it('throws ArtifactError for missing features.order', () => {
    const meta = makeMetadata();
    const raw = JSON.parse(JSON.stringify(meta));
    delete raw.features.order;
    const filePath = path.join(tmpDir, 'NoOrder.metadata.json');
    fs.writeFileSync(filePath, JSON.stringify(raw));

    const loader = new ModelMetadataLoader();
    expect(() => loader.loadMetadata(filePath)).toThrow(ArtifactError);
  });
});

// ---------------------------------------------------------------------------
// FeatureExtractor
// ---------------------------------------------------------------------------

describe('FeatureExtractor', () => {
  const schema: FeatureSchema = {
    features: [
      { name: 'price', index: 0, originalType: 'number', columnCount: 1 },
      { name: 'stock', index: 1, originalType: 'number', columnCount: 1 },
    ],
    count: 2,
    order: ['price', 'stock'],
  };

  type Product = { price: number; stock: number };

  const resolvers = {
    price: (p: Product) => p.price,
    stock: (p: Product) => p.stock,
  };

  it('extracts features in schema order', () => {
    const extractor = new FeatureExtractor();
    const result = extractor.extract<Product>({ price: 99, stock: 5 }, resolvers, schema);

    expect(result.featureNames).toEqual(['price', 'stock']);
    expect(result.values[0]).toBe(99);
    expect(result.values[1]).toBe(5);
  });

  it('throws FeatureExtractionError when a resolver is missing', () => {
    const extractor = new FeatureExtractor();
    const incompleteResolvers = { price: (p: Product) => p.price };

    expect(() =>
      extractor.extract<Product>({ price: 10, stock: 5 }, incompleteResolvers, schema)
    ).toThrow(FeatureExtractionError);
  });

  it('throws FeatureExtractionError when a resolver throws', () => {
    const extractor = new FeatureExtractor();
    const badResolvers = {
      price: (_: Product) => {
        throw new Error('resolver exploded');
      },
      stock: (p: Product) => p.stock,
    };

    expect(() =>
      extractor.extract<Product>({ price: 10, stock: 5 }, badResolvers, schema)
    ).toThrow(FeatureExtractionError);
  });

  it('handles null resolver return values (passes through for encoding to handle)', () => {
    const extractor = new FeatureExtractor();
    const nullableResolvers = {
      price: (_: Product) => null,
      stock: (p: Product) => p.stock,
    };

    const result = extractor.extract<Product>(
      { price: 10, stock: 5 },
      nullableResolvers,
      schema
    );
    expect(result.values[0]).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// PredictionSession — schema drift detection (core safety guarantee)
// ---------------------------------------------------------------------------

describe('PredictionSession — schema drift detection', () => {
  it('throws SchemaDriftError when hash in metadata does not match runtime hash', async () => {
    const meta = makeMetadata({ prismaSchemaHash: 'compiled-hash-abc' });
    const metaPath = writeTmpMetadata('DriftModel', meta);

    const session = new PredictionSession();

    await expect(
      session.initializeModel(metaPath, '/nonexistent/model.onnx', 'runtime-hash-xyz')
    ).rejects.toThrow(SchemaDriftError);
  });

  it('SchemaDriftError contains both hashes', async () => {
    const meta = makeMetadata({ prismaSchemaHash: 'compiled-hash' });
    const metaPath = writeTmpMetadata('DriftHashes', meta);

    const session = new PredictionSession();

    try {
      await session.initializeModel(metaPath, '/nonexistent.onnx', 'runtime-hash');
      expect.fail('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(SchemaDriftError);
      const err = e as SchemaDriftError;
      expect(err.context['expectedHash']).toBe('compiled-hash');
      expect(err.context['actualHash']).toBe('runtime-hash');
    }
  });

  it('does NOT throw SchemaDriftError when hashes match (proceeds to ONNX load)', async () => {
    const meta = makeMetadata({ prismaSchemaHash: 'matching-hash' });
    const metaPath = writeTmpMetadata('MatchModel', meta);

    const session = new PredictionSession();

    await expect(
      session.initializeModel(metaPath, '/nonexistent/will-fail-on-onnx.onnx', 'matching-hash')
    ).rejects.not.toThrow(SchemaDriftError);
  });
});

// ---------------------------------------------------------------------------
// PredictionSession — guard rails on uninitialized models
// ---------------------------------------------------------------------------

describe('PredictionSession — uninitialized model guards', () => {
  it('throws ArtifactError when predict() called before initializeModel()', async () => {
    const session = new PredictionSession();

    await expect(
      session.predict('NonExistentModel', { price: 10 }, { price: (e: any) => e.price })
    ).rejects.toThrow(ArtifactError);
  });

  it('throws ArtifactError when predictBatch() called before initializeModel()', async () => {
    const session = new PredictionSession();

    await expect(
      session.predictBatch('NonExistentModel', [{ price: 10 }], {
        price: (e: any) => e.price,
      })
    ).rejects.toThrow(ArtifactError);
  });
});

describe('PredictionSession.load()', () => {
  it('uses model-subset hashing for metadata schema v1.2.x artifacts', async () => {
    const schema = `
model User {
  id   String @id
  plan String
}

model AuditLog {
  id String @id
}
`;

    const schemaPath = path.join(tmpDir, 'schema-v121.prisma');
    fs.writeFileSync(schemaPath, schema);

    const metadata = makeMetadata({
      metadataSchemaVersion: '1.2.1',
      modelName: 'churnRisk',
      prismaSchemaHash: hashPrismaModelSubset(schema, 'User'),
      featureDependencies: [{ modelName: 'User' } as any],
    });
    writeTmpMetadata('churnRisk', metadata);
    fs.writeFileSync(path.join(tmpDir, 'churnRisk.onnx'), 'fake-onnx');

    const model = defineModel({
      name: 'churnRisk',
      modelName: 'User',
      output: { field: 'score', taskType: 'binary_classification', resolver: () => true },
      features: { plan: (user: any) => user.plan },
    });

    const session = new PredictionSession();
    const initializeSpy = vi.spyOn(session, 'initializeModel').mockResolvedValue(undefined);

    await session.load(model, { artifactsDir: tmpDir, schemaPath });

    expect(initializeSpy).toHaveBeenCalledWith(
      path.join(tmpDir, 'churnRisk.metadata.json'),
      path.join(tmpDir, 'churnRisk.onnx'),
      hashPrismaModelSubset(schema, 'User')
    );
  });
});
