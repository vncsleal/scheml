import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { ModelMetadataLoader, FeatureExtractor, PredictionSession } from '../../src/prediction';
import { SchemaDriftError, ArtifactError, FeatureExtractionError } from '../../src/errors';
import type { ModelMetadata, FeatureSchema } from '../../src/types';
import type { ScheMLAdapter, SchemaGraph, FieldSchema } from '../../src/adapters/interface';
import type {
  PredictiveArtifactMetadata,
  AnomalyArtifactMetadata,
  SimilarityArtifactMetadata,
} from '../../src/artifacts';
import type { GenerativeTrait } from '../../src/traitTypes';

type PriceOnlyEntity = { price: number };
type UserAnomalyEntity = { spend: number; sessions: number };
type ProductSimilarityEntity = { price: number; rating: number };
type BehaviorSimilarityEntity = { f1: number; f2: number };
type GenerativeEntity = { plan: string; churned: boolean };

function createSchemaGraph(entityName: string): SchemaGraph {
  return {
    entities: new Map([[entityName, { name: entityName, fields: {} as Record<string, FieldSchema> }]]),
    rawSource: '',
  };
}

function createTestAdapter(entityName: string, schemaHash: string): ScheMLAdapter {
  return {
    name: 'test',
    reader: {
      readSchema: async () => createSchemaGraph(entityName),
      hashModel: () => schemaHash,
    },
  };
}

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
    schemaHash: 'abc123hashvalue',
    compiledAt: new Date().toISOString(),
  };
  return { ...base, ...overrides };
}

function makePredictiveArtifact(overrides: Partial<PredictiveArtifactMetadata> = {}): PredictiveArtifactMetadata {
  const metadata = makeMetadata();
  return {
    version: metadata.version,
    metadataSchemaVersion: metadata.metadataSchemaVersion,
    traitType: 'predictive',
    traitName: metadata.modelName,
    schemaHash: metadata.schemaHash,
    compiledAt: metadata.compiledAt,
    artifactFormat: 'onnx',
    entityName: 'Product',
    taskType: metadata.taskType,
    bestEstimator: metadata.bestEstimator ?? 'forest',
    features: metadata.features,
    output: metadata.output,
    tensorSpec: metadata.tensorSpec ?? { inputShape: [1, 2], outputShape: [1] },
    featureDependencies: metadata.featureDependencies ?? [],
    encoding: metadata.encoding,
    imputation: metadata.imputation,
    scaling: metadata.scaling,
    trainingMetrics: metadata.trainingMetrics ?? [],
    dataset: metadata.dataset ?? { size: 10, splitSeed: 1, trainSize: 8, testSize: 2, materializedAt: metadata.compiledAt },
    onnxFile: 'TestModel.onnx',
    ...overrides,
  };
}

let tmpDir: string;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scheml-test-'));
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.doUnmock('ai');
});

function writeTmpMetadata(name: string, metadata: unknown): string {
  const filePath = path.join(tmpDir, `${name}.metadata.json`);
  fs.writeFileSync(filePath, JSON.stringify(metadata, null, 2));
  return filePath;
}

function writeNpyFloat32Matrix(filePath: string, rows: number[][]): void {
  const rowCount = rows.length;
  const columnCount = rows[0]?.length ?? 0;
  const header = `{'descr': '<f4', 'fortran_order': False, 'shape': (${rowCount}, ${columnCount}), }`;
  const preambleLength = 10;
  const paddingLength = (16 - ((preambleLength + header.length + 1) % 16)) % 16;
  const paddedHeader = `${header}${' '.repeat(paddingLength)}\n`;

  const buffer = Buffer.alloc(preambleLength + paddedHeader.length + rowCount * columnCount * 4);
  buffer[0] = 0x93;
  buffer.write('NUMPY', 1, 'ascii');
  buffer[6] = 1;
  buffer[7] = 0;
  buffer.writeUInt16LE(Buffer.byteLength(paddedHeader, 'latin1'), 8);
  buffer.write(paddedHeader, 10, 'latin1');

  let offset = 10 + Buffer.byteLength(paddedHeader, 'latin1');
  for (const row of rows) {
    for (const value of row) {
      buffer.writeFloatLE(value, offset);
      offset += 4;
    }
  }

  fs.writeFileSync(filePath, buffer);
}

// ---------------------------------------------------------------------------
// ModelMetadataLoader
// ---------------------------------------------------------------------------

describe('ModelMetadataLoader', () => {
  it('loads valid metadata from a file', () => {
    const meta = makePredictiveArtifact();
    const filePath = writeTmpMetadata('ValidModel', meta);

    const loader = new ModelMetadataLoader();
    const loaded = loader.loadMetadata(filePath);

    expect(loaded.modelName).toBe('TestModel');
    expect(loaded.taskType).toBe('regression');
    expect(loaded.schemaHash).toBe('abc123hashvalue');
  });

  it('caches: returns same reference on repeated calls', () => {
    const meta = makePredictiveArtifact({ traitName: 'CachedModel' });
    const filePath = writeTmpMetadata('CachedModel', meta);

    const loader = new ModelMetadataLoader();
    const first = loader.loadMetadata(filePath);
    const second = loader.loadMetadata(filePath);

    expect(first).toBe(second);
  });

  it('throws ArtifactError for missing traitName', () => {
    const meta = makePredictiveArtifact({ traitName: '' });
    const filePath = writeTmpMetadata('NoName', meta);

    const loader = new ModelMetadataLoader();
    expect(() => loader.loadMetadata(filePath)).toThrow(ArtifactError);
  });

  it('throws ArtifactError for missing schemaHash', () => {
    const meta = makePredictiveArtifact();
    const filePath = writeTmpMetadata('NoHash', meta);

    const raw = JSON.parse(fs.readFileSync(path.join(tmpDir, 'NoHash.metadata.json'), 'utf-8'));
    delete raw.schemaHash;
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
    const meta = makePredictiveArtifact();
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
    const meta = makePredictiveArtifact({ schemaHash: 'compiled-hash-abc' });
    const metaPath = writeTmpMetadata('DriftModel', meta);

    const session = new PredictionSession();

    await expect(
      session.initializeModel(metaPath, '/nonexistent/model.onnx', 'runtime-hash-xyz')
    ).rejects.toThrow(SchemaDriftError);
  });

  it('SchemaDriftError contains both hashes', async () => {
    const meta = makePredictiveArtifact({ schemaHash: 'compiled-hash' });
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
    const meta = makeMetadata({ schemaHash: 'matching-hash' });
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
      session.predict<PriceOnlyEntity>('NonExistentModel', { price: 10 }, { price: (entity) => entity.price })
    ).rejects.toThrow(ArtifactError);
  });

  it('throws ArtifactError when predictBatch() called before initializeModel()', async () => {
    const session = new PredictionSession();

    await expect(
      session.predictBatch<PriceOnlyEntity>('NonExistentModel', [{ price: 10 }], {
        price: (entity) => entity.price,
      })
    ).rejects.toThrow(ArtifactError);
  });
});

describe('PredictionSession — anomaly runtime inference', () => {
  it('loads anomaly metadata and returns a numeric anomaly score', async () => {
    const metadata: AnomalyArtifactMetadata = {
      version: '0.3.1',
      metadataSchemaVersion: '1.0.0',
      traitType: 'anomaly',
      artifactFormat: 'onnx',
      traitName: 'sessionAnomaly',
      schemaHash: 'hash-user',
      entityName: 'User',
      compiledAt: new Date().toISOString(),
      modelBase64: 'unused',
      featureCount: 2,
      featureNames: ['spend', 'sessions'],
      contamination: 0.1,
      threshold: 0.5,
      normalization: { means: [10, 5], stds: [2, 1] },
      normScoreStats: { mean: 1.5, std: 0.5, threshold: 2.0 },
    };
    writeTmpMetadata('sessionAnomaly', metadata);
    const schemaPath = path.join(tmpDir, 'schema.prisma');
    fs.writeFileSync(schemaPath, 'model User { id Int @id spend Float sessions Int }');

    const session = new PredictionSession();
    await session.loadTrait('sessionAnomaly', {
      artifactsDir: tmpDir,
      schemaPath,
      adapter: createTestAdapter('User', 'hash-user'),
    });

    const result = await session.predict(
      'sessionAnomaly',
      { spend: 20, sessions: 8 },
      {
        spend: (entity: UserAnomalyEntity) => entity.spend,
        sessions: (entity: UserAnomalyEntity) => entity.sessions,
      }
    );

    expect(typeof result.prediction).toBe('number');
    expect((result.prediction as number)).toBeGreaterThan(0.5);
    expect(result.confidence).toBe(result.prediction);
  });
});

describe('PredictionSession — similarity runtime inference', () => {
  it('loads cosine-matrix similarity artifacts and returns nearest matches', async () => {
    const embeddingsPath = path.join(tmpDir, 'productSimilarity.embeddings.npy');
    writeNpyFloat32Matrix(embeddingsPath, [
      [1, 0],
      [0.8, 0.2],
      [0, 1],
    ]);

    const metadata: SimilarityArtifactMetadata = {
      version: '0.3.1',
      metadataSchemaVersion: '1.0.0',
      traitType: 'similarity',
      artifactFormat: 'npy',
      traitName: 'productSimilarity',
      schemaHash: 'hash-product',
      entityName: 'Product',
      compiledAt: new Date().toISOString(),
      strategy: 'cosine_matrix',
      entityCount: 3,
      embeddingDim: 2,
      featureNames: ['price', 'rating'],
      entityIds: ['p1', 'p2', 'p3'],
      indexFile: 'productSimilarity.embeddings.npy',
      normalization: { means: [0, 0], stds: [1, 1] },
    };
    writeTmpMetadata('productSimilarity', metadata);
    const schemaPath = path.join(tmpDir, 'product-schema.prisma');
    fs.writeFileSync(schemaPath, 'model Product { id Int @id price Float rating Float }');

    const session = new PredictionSession();
    await session.loadTrait('productSimilarity', {
      artifactsDir: tmpDir,
      schemaPath,
      adapter: createTestAdapter('Product', 'hash-product'),
    });

    const result = await session.predictSimilarity(
      'productSimilarity',
      { price: 1, rating: 0 },
      {
        price: (entity: ProductSimilarityEntity) => entity.price,
        rating: (entity: ProductSimilarityEntity) => entity.rating,
      },
      { limit: 2 }
    );

    expect(result.matches).toHaveLength(2);
    expect(result.matches[0].entityId).toBe('p1');
    expect(result.matches[1].entityId).toBe('p2');
    expect(result.matches[0].score).toBeGreaterThan(result.matches[1].score);
  });

  it('throws a helpful error when similarity traits are used with predict()', async () => {
    const embeddingsPath = path.join(tmpDir, 'behaviorSimilarity.embeddings.npy');
    writeNpyFloat32Matrix(embeddingsPath, [[1, 0]]);

    const metadata: SimilarityArtifactMetadata = {
      version: '0.3.1',
      metadataSchemaVersion: '1.0.0',
      traitType: 'similarity',
      artifactFormat: 'npy',
      traitName: 'behaviorSimilarity',
      schemaHash: 'hash-behavior',
      entityName: 'Behavior',
      compiledAt: new Date().toISOString(),
      strategy: 'cosine_matrix',
      entityCount: 1,
      embeddingDim: 2,
      featureNames: ['f1', 'f2'],
      entityIds: ['b1'],
      indexFile: 'behaviorSimilarity.embeddings.npy',
      normalization: { means: [0, 0], stds: [1, 1] },
    };
    writeTmpMetadata('behaviorSimilarity', metadata);
    const schemaPath = path.join(tmpDir, 'behavior-schema.prisma');
    fs.writeFileSync(schemaPath, 'model Behavior { id Int @id f1 Float f2 Float }');

    const session = new PredictionSession();
    await session.loadTrait('behaviorSimilarity', {
      artifactsDir: tmpDir,
      schemaPath,
      adapter: createTestAdapter('Behavior', 'hash-behavior'),
    });

    await expect(
      session.predict<BehaviorSimilarityEntity>('behaviorSimilarity', { f1: 1, f2: 0 }, {
        f1: (entity) => entity.f1,
        f2: (entity) => entity.f2,
      })
    ).rejects.toThrow(/predictSimilarity\(\)/);
  });
});

describe('PredictionSession — generative runtime inference', () => {
  it('uses the configured default provider for generative traits', async () => {
    const provider = { model: 'default-provider' };
    const generateText = vi.fn(async ({ model }: { model: unknown; prompt: string }) => ({
      text: JSON.stringify({ model, ok: true }),
    }));

    vi.doMock('ai', () => ({
      generateText,
      generateObject: vi.fn(),
    }));

    const session = new PredictionSession({ generativeProvider: provider });
    const trait: GenerativeTrait<GenerativeEntity> = {
      type: 'generative',
      name: 'retentionMessage',
      entity: 'User',
      context: ['plan', 'churned'],
      prompt: 'Write a retention message.',
    } as GenerativeTrait<GenerativeEntity>;

    const result = await session.predictGenerative(trait, { plan: 'pro', churned: false });

    expect(generateText).toHaveBeenCalledOnce();
    expect(generateText.mock.calls[0]?.[0]).toMatchObject({ model: provider });
    expect(result.traitName).toBe('retentionMessage');
  });

  it('prefers an explicit provider override for generative traits', async () => {
    const configuredProvider = { model: 'configured-provider' };
    const overrideProvider = { model: 'override-provider' };
    const generateText = vi.fn(async ({ model }: { model: unknown; prompt: string }) => ({
      text: JSON.stringify({ model, ok: true }),
    }));

    vi.doMock('ai', () => ({
      generateText,
      generateObject: vi.fn(),
    }));

    const session = new PredictionSession({ generativeProvider: configuredProvider });
    const trait: GenerativeTrait<GenerativeEntity> = {
      type: 'generative',
      name: 'retentionMessage',
      entity: 'User',
      context: ['plan'],
      prompt: 'Write a retention message.',
    } as GenerativeTrait<GenerativeEntity>;

    await session.predictGenerative(trait, { plan: 'pro', churned: false }, overrideProvider);

    expect(generateText.mock.calls[0]?.[0]).toMatchObject({ model: overrideProvider });
  });

  it('fails fast when generative inference has no configured provider', async () => {
    const session = new PredictionSession();
    const trait: GenerativeTrait<GenerativeEntity> = {
      type: 'generative',
      name: 'retentionMessage',
      entity: 'User',
      context: ['plan'],
      prompt: 'Write a retention message.',
    } as GenerativeTrait<GenerativeEntity>;

    await expect(
      session.predictGenerative(trait, { plan: 'pro', churned: false })
    ).rejects.toThrow(/generative provider/i);
  });
});


