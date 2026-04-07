import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PrismaQueryInterceptor } from '../../src/adapters/prisma';
import { TTLCache } from '../../src/cache';
import type { PredictionSession } from '../../src/prediction';
import { createPredictionSession, extendClient } from '../../src/runtime';
import { registerAdapter } from '../../src/adapters';
import type { ScheMLConfig } from '../../src/defineConfig';
import { createAdvancedTempProject } from '../support/project';

type TraitScalar = number | string | boolean | null;
type RuntimeRow = Record<string, unknown>;
type RuntimeQueryArgs = {
  where?: Record<string, unknown>;
};
type RuntimeQueryCall = {
  model: string;
  args: RuntimeQueryArgs;
  query: (args: RuntimeQueryArgs) => Promise<RuntimeRow[] | RuntimeRow | null>;
};
type RuntimeComputedField = {
  needs: Record<string, boolean>;
  compute: (row: RuntimeRow) => Promise<TraitScalar>;
};
type RuntimeExtension = {
  query: {
    $allModels: {
      findMany: (args: RuntimeQueryCall) => Promise<RuntimeRow[] | RuntimeRow | null>;
      findFirst: (args: RuntimeQueryCall) => Promise<RuntimeRow[] | RuntimeRow | null>;
      findFirstOrThrow: (args: RuntimeQueryCall) => Promise<RuntimeRow>;
    };
  };
  result: Record<string, Record<string, RuntimeComputedField>>;
};
type MockClient = {
  _rows: RuntimeRow[];
  _extendsCalls: RuntimeExtension[];
  _extension?: RuntimeExtension;
  $extends(ext: RuntimeExtension): MockClient;
};

function getExtension(client: MockClient): RuntimeExtension {
  const extension = client._extendsCalls[0];
  if (!extension) {
    throw new Error('Expected Prisma extension to be registered');
  }
  return extension;
}

function createPredictionSessionMock(
  implementation: Pick<PredictionSession, 'predict'>['predict']
): Pick<PredictionSession, 'predict'> {
  return {
    predict: vi.fn(implementation),
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a minimal mock Prisma client that records `$extends` calls
 * and returns a proxy applying the extension.
 */
function makeMockClient(rows: RuntimeRow[] = []): MockClient {
  const extendsCalls: RuntimeExtension[] = [];

  const client: MockClient = {
    _rows: rows,
    $extends(ext: RuntimeExtension) {
      extendsCalls.push(ext);
      // Return a new client-like object with the extension applied
      return {
        ...client,
        _extension: ext,
        _extendsCalls: extendsCalls,
      };
    },
    _extendsCalls: extendsCalls,
  };

  return client;
}

const customAdapterFactory = vi.fn(() => ({
  name: 'runtime-test',
  reader: {
    readSchema: vi.fn(async () => ({ entities: new Map(), rawSource: '' })),
    hashModel: vi.fn(() => 'hash'),
  },
  createInterceptor: customCreateInterceptor,
}));

const customCreateInterceptor = vi.fn(() => ({
    extendClient: (client: unknown) => client,
  }));

beforeEach(() => {
  registerAdapter('runtime-test', customAdapterFactory);
  customAdapterFactory.mockClear();
  customCreateInterceptor.mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// PrismaQueryInterceptor — basic construction
// ---------------------------------------------------------------------------

describe('PrismaQueryInterceptor', () => {
  it('throws when client does not support $extends', () => {
    const interceptor = new PrismaQueryInterceptor([]);
    expect(() => interceptor.extendClient({})).toThrow('$extends');
  });

  it('calls $extends exactly once', () => {
    const interceptor = new PrismaQueryInterceptor([]);
    const client = makeMockClient();
    interceptor.extendClient(client);
    expect(client._extendsCalls).toHaveLength(1);
  });

  it('registers result extensions for each trait', () => {
    const interceptor = new PrismaQueryInterceptor([
      {
        traitName: 'churnRisk',
        entityName: 'User',
        featureNames: ['totalPurchases', 'lastLoginDays'],
        materializedColumn: 'churnRisk',
        supportsLiveInference: true,
      },
    ]);

    const client = makeMockClient();
    interceptor.extendClient(client);

    const ext = getExtension(client);
    expect(ext).toBeDefined();
    expect(ext.result).toBeDefined();
    expect(ext.result.user).toBeDefined();
    expect(ext.result.user.churnRisk).toBeDefined();
    expect(typeof ext.result.user.churnRisk.compute).toBe('function');
  });

  it('needs object includes id', () => {
    const interceptor = new PrismaQueryInterceptor([
      {
        traitName: 'score',
        entityName: 'Order',
        featureNames: ['amount'],
        materializedColumn: 'score',
        supportsLiveInference: false,
      },
    ]);

    const client = makeMockClient();
    interceptor.extendClient(client);

    const ext = getExtension(client);
    const needs = ext.result.order.score.needs;
    expect(needs.id).toBe(true);
  });

  it('registers query extension layer', () => {
    const interceptor = new PrismaQueryInterceptor([
      {
        traitName: 'churnRisk',
        entityName: 'Customer',
        featureNames: ['spend'],
        materializedColumn: 'churnRisk',
      },
    ]);

    const client = makeMockClient();
    interceptor.extendClient(client);

    const ext = getExtension(client);
    expect(ext.query).toBeDefined();
    expect(ext.query.$allModels).toBeDefined();
    expect(typeof ext.query.$allModels.findMany).toBe('function');
    expect(typeof ext.query.$allModels.findFirst).toBe('function');
  });

  it('does not fall back to live inference in materialized mode', async () => {
    const mockSession = createPredictionSessionMock(async () => ({
      modelName: 'mock',
      prediction: 0.9,
      timestamp: new Date().toISOString(),
    }));
    const interceptor = new PrismaQueryInterceptor(
      [
        {
          traitName: 'churnRisk',
          entityName: 'User',
          featureNames: ['spend'],
          materializedColumn: 'churnRisk',
          supportsLiveInference: true,
        },
      ],
      {
        mode: 'materialized',
        materializedColumnsPresent: true,
        predictionSession: mockSession,
      }
    );

    const client = makeMockClient();
    interceptor.extendClient(client);

    const ext = getExtension(client);
    const value = await ext.result.user.churnRisk.compute({ id: 1, spend: 200, churnRisk: null });

    expect(value).toBeNull();
    expect(mockSession.predict).not.toHaveBeenCalled();
  });
});

describe('extendClient', () => {
  it('creates prediction sessions from config defaults', () => {
    const provider = { model: 'gpt-4.1-mini' };
    const session = createPredictionSession({ generativeProvider: provider });

    expect(session).toBeDefined();
    expect(typeof session.predictGenerative).toBe('function');
  });

  it('fails loudly in live mode when a predictive trait artifact is missing', async () => {
    const config: ScheMLConfig = {
      adapter: 'runtime-test',
      schema: './schema.ts',
      traits: [
        {
          type: 'predictive',
          name: 'churnRisk',
          entity: 'User',
          target: 'churned',
          features: ['spend'],
          output: { field: 'churnRisk', taskType: 'binary_classification' },
        },
      ],
    };

    await expect(
      extendClient({}, config, { mode: 'live', artifactsDir: '/tmp/does-not-exist' })
    ).rejects.toThrow('Missing metadata for: churnRisk');
  });

  it('uses the trait name as the materialized predictive column', async () => {
    const config: ScheMLConfig = {
      adapter: 'runtime-test',
      traits: [
        {
          type: 'predictive',
          name: 'churnRisk',
          entity: 'User',
          target: 'churned',
          features: ['spend'],
          output: { field: 'predictedChurnRisk', taskType: 'binary_classification' },
        },
      ],
    };

    await extendClient({}, config, { mode: 'materialized' });

    expect(customCreateInterceptor).toHaveBeenCalledTimes(1);
    expect(customCreateInterceptor.mock.calls[0]?.[0]).toEqual([
      expect.objectContaining({
        traitName: 'churnRisk',
        materializedColumn: 'churnRisk',
      }),
    ]);
  });

  it('uses compiled temporal artifact features for live extendClient bindings', async () => {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scheml-runtime-temporal-'));

    try {
      const project = await createAdvancedTempProject(rootDir);
      const temporalCreateInterceptor = vi.fn(() => ({
        extendClient: (client: unknown) => client,
      }));

      registerAdapter('runtime-temporal-test', () => ({
        name: 'runtime-temporal-test',
        reader: {
          readSchema: vi.fn(async () => ({ entities: new Map(), rawSource: '' })),
          hashModel: vi.fn(() => project.schemaHash),
        },
        createInterceptor: temporalCreateInterceptor,
      }));

      const config: ScheMLConfig = {
        adapter: 'runtime-temporal-test',
        schema: project.schemaPath,
        traits: [
          {
            type: 'temporal',
            name: project.temporalTraitName,
            entity: 'Product',
            sequence: 'sequenceValues',
            orderBy: 'createdAt',
            target: 'recentMaxViews',
            output: { field: 'engagementForecast', taskType: 'regression' },
          },
        ],
      };

      await extendClient({}, config, { mode: 'live', artifactsDir: project.artifactsDir });

      expect(temporalCreateInterceptor).toHaveBeenCalledTimes(1);
      expect(temporalCreateInterceptor.mock.calls[0]?.[0]).toEqual([
        expect.objectContaining({
          traitName: project.temporalTraitName,
          featureNames: ['windowMean', 'windowSum', 'windowMin', 'windowMax'],
          supportsLiveInference: true,
        }),
      ]);
    } finally {
      fs.rmSync(rootDir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// trait: filter rewriting — materialized mode
// ---------------------------------------------------------------------------

describe('trait: filter — materialized mode', () => {
  it('passes through args unchanged when no trait filter', async () => {
    const interceptor = new PrismaQueryInterceptor(
      [{ traitName: 'risk', entityName: 'User', featureNames: [] }],
      { mode: 'materialized', materializedColumnsPresent: true }
    );
    const client = makeMockClient();
    interceptor.extendClient(client);

    const ext = getExtension(client);
    const capturedArgs: RuntimeQueryArgs[] = [];
    const mockQuery = (args: RuntimeQueryArgs) => {
      capturedArgs.push(args);
      return Promise.resolve([]);
    };

    await ext.query.$allModels.findMany({ model: 'User', args: { where: { name: 'Alice' } }, query: mockQuery });
    expect(capturedArgs[0].where.trait).toBeUndefined();
    expect(capturedArgs[0].where.name).toBe('Alice');
  });

  it('rewrites trait filter to materialized column condition', async () => {
    const interceptor = new PrismaQueryInterceptor(
      [{
        traitName: 'churnRisk',
        entityName: 'Customer',
        featureNames: [],
        materializedColumn: 'churnRisk',
        supportsLiveInference: false,
      }],
      { mode: 'materialized', materializedColumnsPresent: true }
    );
    const client = makeMockClient();
    interceptor.extendClient(client);

    const ext = getExtension(client);
    const capturedArgs: RuntimeQueryArgs[] = [];
    const mockQuery = (args: RuntimeQueryArgs) => {
      capturedArgs.push(args);
      return Promise.resolve([]);
    };

    await ext.query.$allModels.findMany({
      model: 'Customer',
      args: { where: { trait: { churnRisk: { gt: 0.75 } } } },
      query: mockQuery,
    });

    expect(capturedArgs[0].where.trait).toBeUndefined();
    expect(capturedArgs[0].where.churnRisk).toEqual({ gt: 0.75 });
  });

  it('merges trait filter with existing where conditions', async () => {
    const interceptor = new PrismaQueryInterceptor(
      [{
        traitName: 'anomalyScore',
        entityName: 'User',
        featureNames: [],
        materializedColumn: 'anomalyScore',
        supportsLiveInference: false,
      }],
      { mode: 'materialized', materializedColumnsPresent: true }
    );
    const client = makeMockClient();
    interceptor.extendClient(client);

    const ext = getExtension(client);
    const capturedArgs: RuntimeQueryArgs[] = [];
    const mockQuery = (args: RuntimeQueryArgs) => {
      capturedArgs.push(args);
      return Promise.resolve([]);
    };

    await ext.query.$allModels.findMany({
      model: 'User',
      args: { where: { status: 'active', trait: { anomalyScore: { gte: 0.8 } } } },
      query: mockQuery,
    });

    expect(capturedArgs[0].where.trait).toBeUndefined();
    expect(capturedArgs[0].where.status).toBe('active');
    expect(capturedArgs[0].where.anomalyScore).toEqual({ gte: 0.8 });
  });

  it('passes unknown trait names through without rewriting', async () => {
    const interceptor = new PrismaQueryInterceptor(
      [{ traitName: 'churnRisk', entityName: 'Order', featureNames: [] }],
      { mode: 'materialized', materializedColumnsPresent: true }
    );
    const client = makeMockClient();
    interceptor.extendClient(client);

    const ext = getExtension(client);
    const capturedArgs: RuntimeQueryArgs[] = [];
    const mockQuery = (args: RuntimeQueryArgs) => {
      capturedArgs.push(args);
      return Promise.resolve([]);
    };

    // 'Revenue' is not a registered entity
    await ext.query.$allModels.findMany({
      model: 'Revenue',
      args: { where: { trait: { churnRisk: { gt: 0.5 } } } },
      query: mockQuery,
    });

    // trait key is removed but column is not rewritten (model mismatch)
    expect(capturedArgs[0].where?.trait).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// trait: filter rewriting — live mode (post-filter)
// ---------------------------------------------------------------------------

describe('trait: filter — live mode post-filter', () => {
  it('returns rows that match the live filter', async () => {
    const mockSession = createPredictionSessionMock(async (_name, row) => ({
      modelName: 'mock',
      prediction: Number(row['spend']) > 100 ? 0.9 : 0.2,
      timestamp: new Date().toISOString(),
    }));
    const cache = new TTLCache<string, number | string | boolean | null>(5000);
    const interceptor = new PrismaQueryInterceptor(
      [{
        traitName: 'churnRisk',
        entityName: 'Customer',
        featureNames: ['spend'],
        supportsLiveInference: true,
      }],
      { mode: 'live', predictionSession: mockSession, cache }
    );
    const client = makeMockClient();
    interceptor.extendClient(client);

    const ext = getExtension(client);
    const rawRows = [
      { id: 1, spend: 200 }, // prediction → 0.9 (passes gt: 0.75)
      { id: 2, spend: 50 },  // prediction → 0.2 (fails gt: 0.75)
    ];
    const mockQuery = (_args: RuntimeQueryArgs) => Promise.resolve(rawRows);

    const results = await ext.query.$allModels.findMany({
      model: 'Customer',
      args: { where: { trait: { churnRisk: { gt: 0.75 } } } },
      query: mockQuery,
    });

    expect(results).toHaveLength(1);
    expect(results[0].id).toBe(1);
  });

  it('supports findFirst when the underlying live query returns a single row', async () => {
    const mockSession = createPredictionSessionMock(async () => ({
      modelName: 'mock',
      prediction: 0.9,
      timestamp: new Date().toISOString(),
    }));
    const cache = new TTLCache<string, number | string | boolean | null>(5000);
    const interceptor = new PrismaQueryInterceptor(
      [{
        traitName: 'churnRisk',
        entityName: 'Customer',
        featureNames: ['spend'],
        supportsLiveInference: true,
      }],
      { mode: 'live', predictionSession: mockSession, cache }
    );
    const client = makeMockClient();
    interceptor.extendClient(client);

    const ext = getExtension(client);
    const result = await ext.query.$allModels.findFirst({
      model: 'Customer',
      args: { where: { trait: { churnRisk: { gt: 0.75 } } } },
      query: async (_args: RuntimeQueryArgs) => ({ id: 1, spend: 200 }),
    });

    expect(result).toEqual({ id: 1, spend: 200 });
  });
});

// ---------------------------------------------------------------------------
// matchesCondition (indirectly via live filter)
// ---------------------------------------------------------------------------

describe('trait: filter — condition operators', () => {
  it.each([
    [{ gt: 0.5 }, 0.9, true],
    [{ gt: 0.5 }, 0.5, false],
    [{ gte: 0.5 }, 0.5, true],
    [{ lt: 0.5 }, 0.3, true],
    [{ lt: 0.5 }, 0.5, false],
    [{ lte: 0.5 }, 0.5, true],
    [{ equals: 1 }, 1, true],
    [{ equals: 1 }, 2, false],
  ] as const)('condition %j on value %s → %s', async (condition, prediction, expected) => {
    const mockSession = createPredictionSessionMock(async () => ({
      modelName: 'mock',
      prediction,
      timestamp: new Date().toISOString(),
    }));
    const cache = new TTLCache<string, number | string | boolean | null>(5000);
    const interceptor = new PrismaQueryInterceptor(
      [{
        traitName: 'score',
        entityName: 'Item',
        featureNames: ['x'],
        supportsLiveInference: true,
      }],
      { mode: 'live', predictionSession: mockSession, cache }
    );
    const client = makeMockClient();
    interceptor.extendClient(client);

    const ext = getExtension(client);
    const mockQuery = (_args: RuntimeQueryArgs) => Promise.resolve([{ id: 1, x: 5 }]);
    const results = await ext.query.$allModels.findMany({
      model: 'Item',
      args: { where: { trait: { score: condition } } },
      query: mockQuery,
    });

    if (expected) {
      expect(results).toHaveLength(1);
    } else {
      expect(results).toHaveLength(0);
    }
  });
});
