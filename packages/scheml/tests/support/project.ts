import * as fs from 'fs';
import * as path from 'path';
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
