import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { PrismaSchemaReader } from '../../src/index';

const PACKAGE_SRC_ENTRY = path.resolve(__dirname, '../../src/index');

const SAMPLE_ONNX_BASE64 =
  'CAgSCHNrbDJvbm54GgYxLjE2LjAiB2FpLm9ubngoADIAOt4BCoIBCgtmbG9hdF9pbnB1dBIIdmFyaWFi' +
  'bGUaD0xpbmVhclJlZ3Jlc3NvciIPTGluZWFyUmVncmVzc29yKiUKDGNvZWZmaWNpZW50cz1FGhZEPfCgO0U90Fqvwz0P1yhEoAEGKhQKCmludGVyY2VwdHM9yDQ8RaABBjoKYWkub25ueC5tbBIgOWM1ODYwZmIzYjI4NGQ5ZGE4MmQ4MDVkNzg0MzJiMmJaGwoLZmxvYXRfaW5wdXQSDAoKCAESBgoACgIIBGIYCgh2YXJpYWJsZRIMCgoIARIGCgAKAggBQg4KCmFpLm9ubngubWwQAUIECgAQEQ==';

const PRISMA_SCHEMA = `generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "sqlite"
  url      = "file:./dev.db"
}

model Product {
  id               String   @id @default(cuid())
  recentAvgViews   Float
  recentTotalViews Float
  recentMinViews   Float
  recentMaxViews   Float
  predictedSales   Float?
  createdAt        DateTime @default(now())
}
`;

function ensureDir(dirPath: string): void {
  fs.mkdirSync(dirPath, { recursive: true });
}

function writeJson(filePath: string, value: unknown): void {
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), 'utf-8');
}

type FixtureField = {
  scalarType: 'number' | 'boolean' | 'string' | 'date' | 'unknown';
  nullable: boolean;
  isEnum: boolean;
};

type FixtureSchema = {
  entities: Record<string, { fields: Record<string, FixtureField> }>;
};

type FixtureRow = {
  id: string;
  recentAvgViews: number;
  recentTotalViews: number;
  recentMinViews: number;
  recentMaxViews: number;
  predictedSales: number | null;
  sessionAnomaly: number | null;
  price: number;
  rating: number;
  windowMean: number;
  windowSum: number;
  windowMin: number;
  windowMax: number;
  sequenceValues: number[];
  planTier: string;
  churned: boolean;
  createdAt: string;
};

const FIXTURE_SCHEMA: FixtureSchema = {
  entities: {
    Product: {
      fields: {
        id: { scalarType: 'string', nullable: false, isEnum: false },
        recentAvgViews: { scalarType: 'number', nullable: false, isEnum: false },
        recentTotalViews: { scalarType: 'number', nullable: false, isEnum: false },
        recentMinViews: { scalarType: 'number', nullable: false, isEnum: false },
        recentMaxViews: { scalarType: 'number', nullable: false, isEnum: false },
        predictedSales: { scalarType: 'number', nullable: true, isEnum: false },
        sessionAnomaly: { scalarType: 'number', nullable: true, isEnum: false },
        price: { scalarType: 'number', nullable: false, isEnum: false },
        rating: { scalarType: 'number', nullable: false, isEnum: false },
        windowMean: { scalarType: 'number', nullable: false, isEnum: false },
        windowSum: { scalarType: 'number', nullable: false, isEnum: false },
        windowMin: { scalarType: 'number', nullable: false, isEnum: false },
        windowMax: { scalarType: 'number', nullable: false, isEnum: false },
        sequenceValues: { scalarType: 'unknown', nullable: false, isEnum: false },
        planTier: { scalarType: 'string', nullable: false, isEnum: false },
        churned: { scalarType: 'boolean', nullable: false, isEnum: false },
        createdAt: { scalarType: 'date', nullable: false, isEnum: false },
      },
    },
  },
};

const FIXTURE_ROWS: FixtureRow[] = [
  {
    id: 'p1',
    recentAvgViews: 90,
    recentTotalViews: 320,
    recentMinViews: 40,
    recentMaxViews: 140,
    predictedSales: null,
    sessionAnomaly: null,
    price: 1,
    rating: 0,
    windowMean: 12,
    windowSum: 48,
    windowMin: 8,
    windowMax: 18,
    sequenceValues: [8, 10, 12, 18],
    planTier: 'starter',
    churned: false,
    createdAt: '2026-04-06T00:00:00.000Z',
  },
  {
    id: 'p2',
    recentAvgViews: 120,
    recentTotalViews: 460,
    recentMinViews: 70,
    recentMaxViews: 180,
    predictedSales: null,
    sessionAnomaly: null,
    price: 0.8,
    rating: 0.2,
    windowMean: 16,
    windowSum: 64,
    windowMin: 10,
    windowMax: 24,
    sequenceValues: [10, 14, 16, 24],
    planTier: 'growth',
    churned: false,
    createdAt: '2026-04-07T00:00:00.000Z',
  },
  {
    id: 'p3',
    recentAvgViews: 35,
    recentTotalViews: 120,
    recentMinViews: 10,
    recentMaxViews: 60,
    predictedSales: null,
    sessionAnomaly: null,
    price: 0,
    rating: 1,
    windowMean: 6,
    windowSum: 24,
    windowMin: 2,
    windowMax: 10,
    sequenceValues: [2, 4, 8, 10],
    planTier: 'starter',
    churned: true,
    createdAt: '2026-04-08T00:00:00.000Z',
  },
];

function stableEntityHash(entityName: string, fields: Record<string, FixtureField>): string {
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

export function writeNpyFloat32Matrix(filePath: string, rows: number[][]): void {
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

function writeHistory(outputDir: string, traitName: string, schemaHash: string): void {
  const historyDir = path.join(outputDir, 'history');
  ensureDir(historyDir);
  const historyPath = path.join(historyDir, `${traitName}.jsonl`);

  fs.writeFileSync(
    historyPath,
    [
      JSON.stringify({
        trait: traitName,
        model: 'Product',
        adapter: 'prisma',
        schemaHash,
        definedAt: '2026-04-06T00:00:00.000Z',
        definedBy: 'agent:copilot',
        artifactVersion: '0',
        status: 'defined',
      }),
      JSON.stringify({
        trait: traitName,
        model: 'Product',
        adapter: 'prisma',
        schemaHash,
        definedAt: '2026-04-06T00:00:00.000Z',
        definedBy: 'agent:copilot',
        trainedAt: '2026-04-06T00:05:00.000Z',
        artifactVersion: '1',
        status: 'trained',
      }),
    ].join('\n') + '\n',
    'utf-8'
  );
}

function writeFixtureHistory(outputDir: string, traitName: string, schemaHash: string): void {
  writeHistory(outputDir, traitName, schemaHash);
}

function writeConfig(rootDir: string, traitName: string): void {
  const configPath = path.join(rootDir, 'scheml.config.ts');
  const configContents = `import { defineTrait, defineConfig } from ${JSON.stringify(PACKAGE_SRC_ENTRY)};

export const ${traitName} = defineTrait('Product', {
  type: 'predictive',
  name: '${traitName}',
  target: 'recentMaxViews',
  features: ['recentAvgViews', 'recentTotalViews', 'recentMinViews', 'recentMaxViews'],
  output: {
    field: 'predictedSales',
    taskType: 'regression',
  },
  qualityGates: [
    {
      metric: 'rmse',
      threshold: 10,
      comparison: 'lte',
      description: 'RMSE must stay below 10',
    },
  ],
});

export default defineConfig({
  adapter: 'prisma',
  schema: './prisma/schema.prisma',
  traits: [${traitName}],
});
`;

  fs.writeFileSync(configPath, configContents, 'utf-8');
}

function createPredictiveMetadata(schemaHash: string, traitName: string) {
  return {
    version: '0.3.1',
    metadataSchemaVersion: '1.2.0',
    traitType: 'predictive',
    traitName,
    schemaHash,
    entityName: 'Product',
    compiledAt: '2026-04-06T00:10:00.000Z',
    artifactFormat: 'onnx',
    qualityGates: [
      {
        metric: 'rmse',
        threshold: 10,
        comparison: 'lte',
        description: 'RMSE must stay below 10',
      },
    ],
    taskType: 'regression',
    bestEstimator: 'sgd',
    features: {
      features: [
        { name: 'recentAvgViews', index: 0, columnCount: 1, originalType: 'number' },
        { name: 'recentTotalViews', index: 1, columnCount: 1, originalType: 'number' },
        { name: 'recentMinViews', index: 2, columnCount: 1, originalType: 'number' },
        { name: 'recentMaxViews', index: 3, columnCount: 1, originalType: 'number' },
      ],
      count: 4,
      order: ['recentAvgViews', 'recentTotalViews', 'recentMinViews', 'recentMaxViews'],
    },
    output: {
      field: 'predictedSales',
      shape: [1],
    },
    tensorSpec: {
      inputShape: [1, 4],
      outputShape: [1],
    },
    featureDependencies: [
      { modelName: 'Product', path: 'Product.recentAvgViews', scalarType: 'number', nullable: false, extractable: true },
      { modelName: 'Product', path: 'Product.recentTotalViews', scalarType: 'number', nullable: false, extractable: true },
      { modelName: 'Product', path: 'Product.recentMinViews', scalarType: 'number', nullable: false, extractable: true },
      { modelName: 'Product', path: 'Product.recentMaxViews', scalarType: 'number', nullable: false, extractable: true },
    ],
    encoding: {},
    imputation: {},
    scaling: {},
    trainingMetrics: [{ metric: 'rmse', value: 0.5, split: 'test' }],
    dataset: {
      size: 20,
      splitSeed: 42,
      trainSize: 16,
      testSize: 4,
      materializedAt: '2026-04-06T00:08:00.000Z',
    },
    onnxFile: `${traitName}.onnx`,
  };
}

function createAnomalyMetadata(schemaHash: string, traitName: string) {
  return {
    version: '0.3.1',
    metadataSchemaVersion: '1.2.0',
    traitType: 'anomaly',
    traitName,
    schemaHash,
    entityName: 'Product',
    compiledAt: '2026-04-06T00:10:00.000Z',
    artifactFormat: 'onnx',
    modelBase64: 'unused',
    featureCount: 2,
    featureNames: ['recentTotalViews', 'recentMaxViews'],
    contamination: 0.1,
    threshold: 0.5,
    normalization: {
      means: [250, 120],
      stds: [100, 30],
    },
    normScoreStats: {
      mean: 1.5,
      std: 0.5,
      threshold: 1.8,
    },
    dataset: {
      size: 20,
      splitSeed: 42,
      trainSize: 16,
      testSize: 4,
      materializedAt: '2026-04-06T00:08:00.000Z',
    },
  };
}

function createSimilarityMetadata(schemaHash: string, traitName: string) {
  return {
    version: '0.3.1',
    metadataSchemaVersion: '1.2.0',
    traitType: 'similarity',
    traitName,
    schemaHash,
    entityName: 'Product',
    compiledAt: '2026-04-06T00:10:00.000Z',
    artifactFormat: 'npy',
    strategy: 'cosine_matrix',
    entityCount: 3,
    embeddingDim: 2,
    featureNames: ['price', 'rating'],
    entityIds: FIXTURE_ROWS.map((row) => row.id),
    indexFile: `${traitName}.embeddings.npy`,
    normalization: {
      means: [0, 0],
      stds: [1, 1],
    },
  };
}

function createTemporalMetadata(schemaHash: string, traitName: string) {
  return {
    version: '0.3.1',
    metadataSchemaVersion: '1.2.0',
    traitType: 'temporal',
    traitName,
    schemaHash,
    entityName: 'Product',
    compiledAt: '2026-04-06T00:10:00.000Z',
    artifactFormat: 'onnx',
    windowSize: 4,
    aggregations: ['mean', 'sum', 'min', 'max'],
    onnxFile: `${traitName}.onnx`,
    taskType: 'regression',
    bestEstimator: 'sgd',
    features: {
      features: [
        { name: 'windowMean', index: 0, columnCount: 1, originalType: 'number' },
        { name: 'windowSum', index: 1, columnCount: 1, originalType: 'number' },
        { name: 'windowMin', index: 2, columnCount: 1, originalType: 'number' },
        { name: 'windowMax', index: 3, columnCount: 1, originalType: 'number' },
      ],
      count: 4,
      order: ['windowMean', 'windowSum', 'windowMin', 'windowMax'],
    },
    output: {
      field: 'engagementForecast',
      shape: [1],
    },
    tensorSpec: {
      inputShape: [1, 4],
      outputShape: [1],
    },
    featureDependencies: [
      { modelName: 'Product', path: 'Product.windowMean', scalarType: 'number', nullable: false, extractable: true },
      { modelName: 'Product', path: 'Product.windowSum', scalarType: 'number', nullable: false, extractable: true },
      { modelName: 'Product', path: 'Product.windowMin', scalarType: 'number', nullable: false, extractable: true },
      { modelName: 'Product', path: 'Product.windowMax', scalarType: 'number', nullable: false, extractable: true },
    ],
    encoding: {},
    imputation: {},
    scaling: {},
    trainingMetrics: [{ metric: 'rmse', value: 0.4, split: 'test' }],
    dataset: {
      size: 20,
      splitSeed: 42,
      trainSize: 16,
      testSize: 4,
      materializedAt: '2026-04-06T00:08:00.000Z',
    },
  };
}

function writeAdvancedConfig(rootDir: string): void {
  const configPath = path.join(rootDir, 'scheml.config.ts');
  const configContents = `import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { defineTrait, defineConfig } from ${JSON.stringify(PACKAGE_SRC_ENTRY)};

const fixtureRoot = ${JSON.stringify(rootDir)};
const schemaPath = path.join(fixtureRoot, 'fixture.schema.json');
const rowsPath = path.join(fixtureRoot, 'fixture.rows.json');
const cleanupPath = path.join(fixtureRoot, 'fixture.cleanup.json');

function recordCleanup(event: string) {
  const current = fs.existsSync(cleanupPath)
    ? JSON.parse(fs.readFileSync(cleanupPath, 'utf-8'))
    : { events: [] };
  current.events.push(event);
  fs.writeFileSync(cleanupPath, JSON.stringify(current, null, 2), 'utf-8');
}

function readSchemaGraph(filePath: string) {
  const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  return {
    entities: new Map(
      Object.entries(parsed.entities).map(([name, entity]) => [name, { name, fields: (entity as { fields: Record<string, unknown> }).fields }])
    ),
    rawSource: JSON.stringify(parsed),
  };
}

function hashModel(graph: { entities: Map<string, { name: string; fields: Record<string, { scalarType: string; nullable: boolean; isEnum: boolean }> }> }, modelName: string) {
  const entity = graph.entities.get(modelName);
  const payload = {
    name: entity?.name ?? modelName,
    fields: Object.entries(entity?.fields ?? {})
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

const adapter = {
  name: 'fixture',
  reader: {
    readSchema: async (source: string) => readSchemaGraph(source),
    hashModel,
  },
  extractor: {
    extract: async () => JSON.parse(fs.readFileSync(rowsPath, 'utf-8')),
    write: async (_modelName: string, results: Array<{ entityId: unknown; prediction: unknown }>, columnName = 'schemlPrediction') => {
      const rows = JSON.parse(fs.readFileSync(rowsPath, 'utf-8')) as Array<Record<string, unknown>>;
      const byId = new Map(results.map((result) => [String(result.entityId), result.prediction]));
      const nextRows = rows.map((row) =>
        byId.has(String(row.id))
          ? { ...row, [columnName]: byId.get(String(row.id)) ?? null }
          : row
      );
      fs.writeFileSync(rowsPath, JSON.stringify(nextRows, null, 2), 'utf-8');
    },
    disconnect: async () => {
      recordCleanup('disconnect');
    },
  },
};

export const productSales = defineTrait('Product', {
  type: 'predictive',
  name: 'productSales',
  target: 'recentMaxViews',
  features: ['recentAvgViews', 'recentTotalViews', 'recentMinViews', 'recentMaxViews'],
  output: {
    field: 'predictedSales',
    taskType: 'regression',
  },
});

export const sessionAnomaly = defineTrait('Product', {
  type: 'anomaly',
  name: 'sessionAnomaly',
  baseline: ['recentTotalViews', 'recentMaxViews'],
  sensitivity: 'medium',
});

export const productSimilarity = defineTrait('Product', {
  type: 'similarity',
  name: 'productSimilarity',
  on: ['price', 'rating'],
});

export const engagementSequence = defineTrait('Product', {
  type: 'temporal',
  name: 'engagementSequence',
  sequence: 'sequenceValues',
  orderBy: 'createdAt',
  target: 'recentMaxViews',
  output: {
    field: 'engagementForecast',
    taskType: 'regression',
  },
});

export const retentionMessage = defineTrait('Product', {
  type: 'generative',
  name: 'retentionMessage',
  context: ['planTier', 'churned', 'recentTotalViews'],
  prompt: 'Write a short retention message for this account.',
});

export default defineConfig({
  adapter,
  schema: schemaPath,
  generativeProvider: { model: 'fixture-provider' },
  traits: [productSales, sessionAnomaly, productSimilarity, engagementSequence, retentionMessage],
});
`;

  fs.writeFileSync(configPath, configContents, 'utf-8');
}

export async function createTempProject(
  rootDir: string,
  options: { traitName?: string } = {}
): Promise<{ schemaPath: string; artifactsDir: string; metadataPath: string; onnxPath: string; traitName: string; schemaHash: string }> {
  const traitName = options.traitName ?? 'productSales';
  const prismaDir = path.join(rootDir, 'prisma');
  const artifactsDir = path.join(rootDir, '.scheml');
  const schemaPath = path.join(prismaDir, 'schema.prisma');
  const metadataPath = path.join(artifactsDir, `${traitName}.metadata.json`);
  const onnxPath = path.join(artifactsDir, `${traitName}.onnx`);

  ensureDir(prismaDir);
  ensureDir(path.join(prismaDir, 'migrations'));
  ensureDir(artifactsDir);

  fs.writeFileSync(schemaPath, PRISMA_SCHEMA, 'utf-8');
  writeConfig(rootDir, traitName);

  const reader = new PrismaSchemaReader();
  const graph = await reader.readSchema(schemaPath);
  const schemaHash = reader.hashModel(graph, 'Product');

  writeJson(
    metadataPath,
    createPredictiveMetadata(schemaHash, traitName)
  );
  fs.writeFileSync(onnxPath, Buffer.from(SAMPLE_ONNX_BASE64, 'base64'));
  writeHistory(artifactsDir, traitName, schemaHash);

  return { schemaPath, artifactsDir, metadataPath, onnxPath, traitName, schemaHash };
}

export async function createAdvancedTempProject(
  rootDir: string
): Promise<{
  schemaPath: string;
  dataPath: string;
  cleanupPath: string;
  artifactsDir: string;
  schemaHash: string;
  predictiveTraitName: string;
  anomalyTraitName: string;
  similarityTraitName: string;
  temporalTraitName: string;
  generativeTraitName: string;
}> {
  const schemaPath = path.join(rootDir, 'fixture.schema.json');
  const dataPath = path.join(rootDir, 'fixture.rows.json');
  const cleanupPath = path.join(rootDir, 'fixture.cleanup.json');
  const artifactsDir = path.join(rootDir, '.scheml');
  const predictiveTraitName = 'productSales';
  const anomalyTraitName = 'sessionAnomaly';
  const similarityTraitName = 'productSimilarity';
  const temporalTraitName = 'engagementSequence';
  const generativeTraitName = 'retentionMessage';

  ensureDir(artifactsDir);
  writeJson(schemaPath, FIXTURE_SCHEMA);
  writeJson(dataPath, FIXTURE_ROWS);
  writeJson(cleanupPath, { events: [] });
  writeAdvancedConfig(rootDir);

  const schemaHash = stableEntityHash('Product', FIXTURE_SCHEMA.entities.Product.fields);

  writeJson(path.join(artifactsDir, `${predictiveTraitName}.metadata.json`), createPredictiveMetadata(schemaHash, predictiveTraitName));
  fs.writeFileSync(path.join(artifactsDir, `${predictiveTraitName}.onnx`), Buffer.from(SAMPLE_ONNX_BASE64, 'base64'));
  writeFixtureHistory(artifactsDir, predictiveTraitName, schemaHash);

  writeJson(path.join(artifactsDir, `${anomalyTraitName}.metadata.json`), createAnomalyMetadata(schemaHash, anomalyTraitName));
  writeFixtureHistory(artifactsDir, anomalyTraitName, schemaHash);

  writeJson(path.join(artifactsDir, `${similarityTraitName}.metadata.json`), createSimilarityMetadata(schemaHash, similarityTraitName));
  writeNpyFloat32Matrix(path.join(artifactsDir, `${similarityTraitName}.embeddings.npy`), [
    [1, 0],
    [0.8, 0.2],
    [0, 1],
  ]);
  writeFixtureHistory(artifactsDir, similarityTraitName, schemaHash);

  writeJson(path.join(artifactsDir, `${temporalTraitName}.metadata.json`), createTemporalMetadata(schemaHash, temporalTraitName));
  fs.writeFileSync(path.join(artifactsDir, `${temporalTraitName}.onnx`), Buffer.from(SAMPLE_ONNX_BASE64, 'base64'));
  writeFixtureHistory(artifactsDir, temporalTraitName, schemaHash);

  return {
    schemaPath,
    dataPath,
    cleanupPath,
    artifactsDir,
    schemaHash,
    predictiveTraitName,
    anomalyTraitName,
    similarityTraitName,
    temporalTraitName,
    generativeTraitName,
  };
}
