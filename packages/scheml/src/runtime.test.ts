import { describe, it, expect, vi } from 'vitest';
import { PrismaQueryInterceptor } from './adapters/prisma';
import { TTLCache } from './cache';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a minimal mock Prisma client that records `$extends` calls
 * and returns a proxy applying the extension.
 */
function makeMockClient(rows: Record<string, unknown>[] = []) {
  const extendsCalls: unknown[] = [];

  const client = {
    _rows: rows,
    $extends(ext: unknown) {
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

    const ext = client._extendsCalls[0] as any;
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

    const ext = client._extendsCalls[0] as any;
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

    const ext = client._extendsCalls[0] as any;
    expect(ext.query).toBeDefined();
    expect(ext.query.$allModels).toBeDefined();
    expect(typeof ext.query.$allModels.findMany).toBe('function');
    expect(typeof ext.query.$allModels.findFirst).toBe('function');
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

    const ext = client._extendsCalls[0] as any;
    const capturedArgs: any[] = [];
    const mockQuery = (a: any) => {
      capturedArgs.push(a);
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

    const ext = client._extendsCalls[0] as any;
    const capturedArgs: any[] = [];
    const mockQuery = (a: any) => {
      capturedArgs.push(a);
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

    const ext = client._extendsCalls[0] as any;
    const capturedArgs: any[] = [];
    const mockQuery = (a: any) => {
      capturedArgs.push(a);
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

    const ext = client._extendsCalls[0] as any;
    const capturedArgs: any[] = [];
    const mockQuery = (a: any) => {
      capturedArgs.push(a);
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
    const mockSession = {
      predict: vi.fn().mockImplementation((_name: string, row: any, _resolvers: any) =>
        Promise.resolve({ prediction: row.spend > 100 ? 0.9 : 0.2 })
      ),
    };
    const cache = new TTLCache<string, number | string | boolean | null>(5000);
    const interceptor = new PrismaQueryInterceptor(
      [{
        traitName: 'churnRisk',
        entityName: 'Customer',
        featureNames: ['spend'],
        supportsLiveInference: true,
      }],
      { mode: 'live', predictionSession: mockSession as any, cache }
    );
    const client = makeMockClient();
    interceptor.extendClient(client);

    const ext = client._extendsCalls[0] as any;
    const rawRows = [
      { id: 1, spend: 200 }, // prediction → 0.9 (passes gt: 0.75)
      { id: 2, spend: 50 },  // prediction → 0.2 (fails gt: 0.75)
    ];
    const mockQuery = (_a: any) => Promise.resolve(rawRows);

    const results = await ext.query.$allModels.findMany({
      model: 'Customer',
      args: { where: { trait: { churnRisk: { gt: 0.75 } } } },
      query: mockQuery,
    });

    expect(results).toHaveLength(1);
    expect(results[0].id).toBe(1);
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
    const mockSession = {
      predict: vi.fn().mockResolvedValue({ prediction }),
    };
    const cache = new TTLCache<string, number | string | boolean | null>(5000);
    const interceptor = new PrismaQueryInterceptor(
      [{
        traitName: 'score',
        entityName: 'Item',
        featureNames: ['x'],
        supportsLiveInference: true,
      }],
      { mode: 'live', predictionSession: mockSession as any, cache }
    );
    const client = makeMockClient();
    interceptor.extendClient(client);

    const ext = client._extendsCalls[0] as any;
    const mockQuery = (_a: any) => Promise.resolve([{ id: 1, x: 5 }]);
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
