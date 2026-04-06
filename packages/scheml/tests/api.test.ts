import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  compareSchemaHashes,
  computeMetadataSchemaHash,
  defineTrait,
  hashSchemaEntity,
  hashSchemaGraph,
  normalizeSchemaText,
  hashSchemaText,
  hashSchemaEntitySubset,
  ModelMetadataLoader,
  FeatureExtractor,
  analyzeFeatureResolver,
  validateHydration,
  PrismaSchemaReader,
  resolveSchemaEntityName,
  detectOutputSchemaShape,
  validateGenerativeTrait,
  defineConfig,
} from '../src/index';
import type { EncodedFeature, FeatureSchema } from '../src/index';
import { createTempProject } from './support/project';

function createFeatureSchema(samples: Record<string, unknown>): FeatureSchema {
  const order = Object.keys(samples);
  const features: EncodedFeature[] = order.map((name, index) => {
    const value = samples[name];
    let originalType = 'number';
    if (value instanceof Date) originalType = 'Date';
    else if (typeof value === 'boolean') originalType = 'boolean';
    else if (typeof value === 'string') originalType = 'string';
    return { name, index, columnCount: 1, originalType };
  });
  return { features, count: features.length, order };
}

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'scheml-api-'));

let schemaPath = '';
let metadataPath = '';
let rawSchema = '';

beforeAll(async () => {
  const project = await createTempProject(tempRoot);
  schemaPath = project.schemaPath;
  metadataPath = project.metadataPath;
  rawSchema = fs.readFileSync(schemaPath, 'utf-8');
});

afterAll(() => {
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

describe('public API integration', () => {
  it('defineTrait returns a predictive trait with feedback methods', () => {
    const trait = defineTrait('Product', {
      type: 'predictive',
      name: 'productSales',
      target: 'views',
      features: ['price', 'stock'],
      output: { field: 'predictedSales', taskType: 'regression' },
    });

    expect(trait.type).toBe('predictive');
    expect(typeof trait.record).toBe('function');
    expect(typeof trait.recordBatch).toBe('function');
  });

  it('normalizeSchemaText is deterministic for equivalent whitespace', () => {
    const normalizedA = normalizeSchemaText(rawSchema);
    const normalizedB = normalizeSchemaText(`\n${rawSchema}\n`);
    expect(normalizedA).toBe(normalizedB);
  });

  it('hashSchemaText is stable for the generated schema', () => {
    expect(hashSchemaText(rawSchema)).toBe(hashSchemaText(rawSchema));
  });

  it('hashSchemaEntitySubset returns a stable entity-scoped hash', () => {
    expect(hashSchemaEntitySubset(rawSchema, 'Product')).toMatch(/^[a-f0-9]{64}$/);
  });

  it('hashSchemaGraph returns a stable graph hash', async () => {
    const reader = new PrismaSchemaReader();
    const graph = await reader.readSchema(schemaPath);
    expect(hashSchemaGraph(graph)).toMatch(/^[a-f0-9]{64}$/);
  });

  it('hashSchemaEntity delegates to the adapter reader when provided', async () => {
    const reader = new PrismaSchemaReader();
    const graph = await reader.readSchema(schemaPath);
    expect(hashSchemaEntity(graph, 'Product', reader)).toMatch(/^[a-f0-9]{64}$/);
  });

  it('resolveSchemaEntityName and computeMetadataSchemaHash work through the neutral layer', async () => {
    const reader = new PrismaSchemaReader();
    const graph = await reader.readSchema(schemaPath);
    const entityName = resolveSchemaEntityName({
      modelName: 'productSales',
      featureDependencies: [{ modelName: 'Product' } as never],
    });

    expect(entityName).toBe('Product');
    expect(computeMetadataSchemaHash(graph, {
      modelName: 'productSales',
      featureDependencies: [{ modelName: 'Product' } as never],
    }, reader)).toMatch(/^[a-f0-9]{64}$/);
  });

  it('compareSchemaHashes exposes the neutral comparison result', () => {
    expect(compareSchemaHashes('same', 'same').valid).toBe(true);
  });

  it('ModelMetadataLoader loads predictive metadata from disk', () => {
    const loader = new ModelMetadataLoader();
    const metadata = loader.loadMetadata(metadataPath);

    expect(metadata.modelName).toBe('productSales');
    expect(metadata.schemaHash).toMatch(/^[a-f0-9]{64}$/);
    expect(fs.readFileSync(metadataPath, 'utf-8')).toContain('"traitType": "predictive"');
    expect(metadata.features.order).toEqual([
      'recentAvgViews',
      'recentTotalViews',
      'recentMinViews',
      'recentMaxViews',
    ]);
  });

  it('FeatureExtractor preserves schema order', () => {
    const schema = createFeatureSchema({ price: 9.99, stock: 12 });
    const extractor = new FeatureExtractor();
    const result = extractor.extract(
      { price: 9.99, stock: 12 },
      {
        price: (entity: { price: number }) => entity.price,
        stock: (entity: { stock: number }) => entity.stock,
      },
      schema
    );

    expect(result.featureNames).toEqual(['price', 'stock']);
    expect(result.values).toEqual([9.99, 12]);
  });

  it('analyzeFeatureResolver extracts property access paths', () => {
    const analysis = analyzeFeatureResolver('(product) => product.metrics.views', 'views');

    expect(analysis.isExtractable).toBe(true);
    expect(analysis.accessPaths).toEqual([
      {
        segments: ['metrics', 'views'],
        isOptional: false,
        isArrayLength: false,
      },
    ]);
    expect(analysis.issues).toHaveLength(0);
  });

  it('analyzeFeatureResolver reports method calls as warnings', () => {
    const analysis = analyzeFeatureResolver('(product) => product.name.trim()', 'name');

    expect(analysis.isExtractable).toBe(false);
    expect(analysis.issues.some((issue) => issue.code === 'METHOD_CALL')).toBe(true);
  });

  it('validateHydration flags missing required access paths', () => {
    const result = validateHydration(
      [{ segments: ['metrics', 'views'], isOptional: false, isArrayLength: false }],
      { metrics: {} }
    );

    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('metrics.views');
  });

  it('PrismaSchemaReader parses the generated schema', async () => {
    const reader = new PrismaSchemaReader();
    const graph = await reader.readSchema(schemaPath);

    expect(graph.entities.has('Product')).toBe(true);
    expect(graph.entities.get('Product')?.fields.recentAvgViews.scalarType).toBe('number');
  });

  it('detectOutputSchemaShape recognizes text output', () => {
    const textSchema = {
      _def: { typeName: 'ZodString' },
      parse: (value: unknown) => value,
      safeParse: (value: unknown) => ({ success: typeof value === 'string', data: value }),
    };

    expect(detectOutputSchemaShape(textSchema)).toMatchObject({ shape: 'text' });
  });

  it('validateGenerativeTrait accepts a basic generative trait', () => {
    const trait = defineTrait('Product', {
      type: 'generative',
      name: 'productSummary',
      context: ['name', 'category'],
      prompt: 'Summarize the product.',
    });

    expect(() => validateGenerativeTrait(trait, new Set(['name', 'category']))).not.toThrow();
  });

  it('defineConfig preserves configured traits and provider options', () => {
    const generativeProvider = { model: 'gpt-4.1-mini' };
    const trait = defineTrait('Product', {
      type: 'generative',
      name: 'productPitch',
      context: ['name'],
      prompt: 'Pitch the product.',
    });

    const config = defineConfig({
      adapter: 'zod',
      generativeProvider,
      traits: [trait],
    });

    expect(config.generativeProvider).toBe(generativeProvider);
    expect(config.traits).toHaveLength(1);
  });
});