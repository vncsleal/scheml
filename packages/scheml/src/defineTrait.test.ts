import { describe, it, expect } from 'vitest';
import { defineTrait } from './defineTrait';
import { resolveTraitGraph, topologicalSort, TraitGraphError } from './traitGraph';
import type {
  PredictiveTrait,
  AnomalyTrait,
  SimilarityTrait,
  SequentialTrait,
  GenerativeTrait,
} from './traitTypes';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

type Customer = {
  id: string;
  lastLoginAt: Date;
  totalPurchases: number;
  planTier: string;
  churned: boolean;
};

const churnRisk = defineTrait('Customer', {
  type: 'predictive',
  name: 'churnRisk',
  target: 'churned',
  features: ['lastLoginAt', 'totalPurchases', 'planTier'],
  output: { field: 'churnScore', taskType: 'binary_classification' },
  qualityGates: [{ metric: 'f1', threshold: 0.85, comparison: 'gte' }],
});

const anomalyScore = defineTrait('Customer', {
  type: 'anomaly',
  name: 'anomalyScore',
  baseline: ['totalPurchases', 'lastLoginAt'],
  sensitivity: 'medium',
});

const behaviorMatch = defineTrait('Customer', {
  type: 'similarity',
  name: 'behaviorMatch',
  on: ['lastLoginAt', 'totalPurchases'],
});

const ltv = defineTrait('Customer', {
  type: 'sequential',
  name: 'ltv',
  sequence: 'totalPurchases',
  orderBy: 'lastLoginAt',
  target: 'revenue',
  output: { field: 'predictedLtv', taskType: 'regression' },
});

const retentionMessage = defineTrait('Customer', {
  type: 'generative',
  name: 'retentionMessage',
  context: ['planTier', 'lastLoginAt'],
  prompt: 'Write a short retention message for this customer.',
});

// ---------------------------------------------------------------------------
// defineTrait — construction
// ---------------------------------------------------------------------------

describe('defineTrait', () => {
  it('returns the configuration fields unchanged', () => {
    expect(churnRisk.type).toBe('predictive');
    expect(churnRisk.name).toBe('churnRisk');
    expect(churnRisk.target).toBe('churned');
    expect(churnRisk.features).toEqual(['lastLoginAt', 'totalPurchases', 'planTier']);
  });

  it('attaches record() method', () => {
    expect(typeof churnRisk.record).toBe('function');
  });

  it('attaches recordBatch() method', () => {
    expect(typeof churnRisk.recordBatch).toBe('function');
  });

  it('preserves qualityGates', () => {
    expect(churnRisk.qualityGates).toHaveLength(1);
    expect(churnRisk.qualityGates![0].metric).toBe('f1');
  });

  it('constructs anomaly trait', () => {
    expect(anomalyScore.type).toBe('anomaly');
    expect(anomalyScore.baseline).toEqual(['totalPurchases', 'lastLoginAt']);
    expect(anomalyScore.sensitivity).toBe('medium');
  });

  it('constructs similarity trait', () => {
    expect(behaviorMatch.type).toBe('similarity');
    expect(behaviorMatch.on).toEqual(['lastLoginAt', 'totalPurchases']);
  });

  it('constructs sequential trait', () => {
    expect(ltv.type).toBe('sequential');
    expect(ltv.sequence).toBe('totalPurchases');
    expect(ltv.orderBy).toBe('lastLoginAt');
    expect(ltv.target).toBe('revenue');
  });

  it('constructs generative trait', () => {
    expect(retentionMessage.type).toBe('generative');
    expect(retentionMessage.context).toEqual(['planTier', 'lastLoginAt']);
    expect(retentionMessage.prompt).toBeTruthy();
  });

  it('stores entity reference as string for Prisma adapter', () => {
    expect((churnRisk as any).entity).toBe('Customer');
  });

  it('stores entity as object for Drizzle adapter', () => {
    const usersTable = { name: 'users' }; // mock Drizzle table
    const t = defineTrait(usersTable, {
      type: 'similarity',
      name: 'mockSimilarity',
      on: ['id'],
    });
    expect((t as any).entity).toBe(usersTable);
  });

  it('record() returns a Promise', () => {
    // Does not write to disk in unit test (path will be created lazily)
    // Just verify it is a thenable
    const result = churnRisk.record('cust_1', { actual: true });
    expect(result).toBeInstanceOf(Promise);
    // Suppress unhandled rejection — we don't care if ENOENT occurs here
    result.catch(() => {});
  });

  it('recordBatch() returns a Promise', () => {
    const result = churnRisk.recordBatch([
      { id: 'cust_1', actual: true },
      { id: 'cust_2', actual: false },
    ]);
    expect(result).toBeInstanceOf(Promise);
    result.catch(() => {});
  });
});

// ---------------------------------------------------------------------------
// resolveTraitGraph — valid graphs
// ---------------------------------------------------------------------------

describe('resolveTraitGraph', () => {
  it('accepts a list with no dependencies', () => {
    expect(() =>
      resolveTraitGraph([churnRisk, anomalyScore, behaviorMatch])
    ).not.toThrow();
  });

  it('accepts a valid linear dependency chain', () => {
    const a = defineTrait('User', { type: 'anomaly', name: 'a', baseline: ['x'], sensitivity: 'low' });
    const b = defineTrait('User', {
      type: 'anomaly',
      name: 'b',
      baseline: ['x'],
      sensitivity: 'low',
      traits: [a],
    });
    const c = defineTrait('User', {
      type: 'anomaly',
      name: 'c',
      baseline: ['x'],
      sensitivity: 'low',
      traits: [b],
    });
    expect(() => resolveTraitGraph([a, b, c])).not.toThrow();
  });

  it('accepts a diamond dependency (two paths to same node)', () => {
    const base = defineTrait('User', { type: 'anomaly', name: 'base', baseline: ['x'], sensitivity: 'low' });
    const left = defineTrait('User', {
      type: 'anomaly',
      name: 'left',
      baseline: ['x'],
      sensitivity: 'low',
      traits: [base],
    });
    const right = defineTrait('User', {
      type: 'anomaly',
      name: 'right',
      baseline: ['x'],
      sensitivity: 'low',
      traits: [base],
    });
    const top = defineTrait('User', {
      type: 'anomaly',
      name: 'top',
      baseline: ['x'],
      sensitivity: 'low',
      traits: [left, right],
    });
    expect(() => resolveTraitGraph([base, left, right, top])).not.toThrow();
  });

  // -------------------------------------------------------------------------
  // Cycle detection
  // -------------------------------------------------------------------------

  it('throws CYCLE_DETECTED for a direct self-reference', () => {
    const selfRef: any = defineTrait('User', {
      type: 'anomaly',
      name: 'selfRef',
      baseline: ['x'],
      sensitivity: 'low',
    });
    // Mutate post-construction to simulate self-cycle
    selfRef.traits = [selfRef];

    expect(() => resolveTraitGraph([selfRef])).toThrow(TraitGraphError);
    try {
      resolveTraitGraph([selfRef]);
    } catch (e) {
      expect((e as TraitGraphError).code).toBe('CYCLE_DETECTED');
    }
  });

  it('throws CYCLE_DETECTED for a two-node cycle', () => {
    const nodeA: any = defineTrait('User', {
      type: 'anomaly',
      name: 'nodeA',
      baseline: ['x'],
      sensitivity: 'low',
    });
    const nodeB: any = defineTrait('User', {
      type: 'anomaly',
      name: 'nodeB',
      baseline: ['x'],
      sensitivity: 'low',
      traits: [nodeA],
    });
    // Create cycle: A → B → A
    nodeA.traits = [nodeB];

    expect(() => resolveTraitGraph([nodeA, nodeB])).toThrow(TraitGraphError);
    try {
      resolveTraitGraph([nodeA, nodeB]);
    } catch (e) {
      expect((e as TraitGraphError).code).toBe('CYCLE_DETECTED');
    }
  });

  // -------------------------------------------------------------------------
  // Reference-before-definition
  // -------------------------------------------------------------------------

  it('throws TRAIT_REFERENCED_BEFORE_DEFINITION for a trait not in the passed list', () => {
    const outsider = defineTrait('User', {
      type: 'anomaly',
      name: 'outsider',
      baseline: ['x'],
      sensitivity: 'low',
    });
    const consumer = defineTrait('User', {
      type: 'anomaly',
      name: 'consumer',
      baseline: ['x'],
      sensitivity: 'low',
      traits: [outsider],
    });
    // Only pass consumer, not outsider — outsider is "not declared"
    expect(() => resolveTraitGraph([consumer])).toThrow(TraitGraphError);
    try {
      resolveTraitGraph([consumer]);
    } catch (e) {
      expect((e as TraitGraphError).code).toBe('TRAIT_REFERENCED_BEFORE_DEFINITION');
    }
  });

  it('throws TRAIT_REFERENCED_BEFORE_DEFINITION for a null entry in the traits array', () => {
    const t: any = defineTrait('User', {
      type: 'anomaly',
      name: 't',
      baseline: ['x'],
      sensitivity: 'low',
      traits: [null],
    });
    expect(() => resolveTraitGraph([t])).toThrow(TraitGraphError);
    try {
      resolveTraitGraph([t]);
    } catch (e) {
      expect((e as TraitGraphError).code).toBe('TRAIT_REFERENCED_BEFORE_DEFINITION');
    }
  });
});

// ---------------------------------------------------------------------------
// topologicalSort
// ---------------------------------------------------------------------------

describe('topologicalSort', () => {
  it('returns a single trait unchanged', () => {
    const result = topologicalSort([churnRisk]);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('churnRisk');
  });

  it('puts dependencies before dependants', () => {
    const base = defineTrait('User', { type: 'anomaly', name: 'base', baseline: ['x'], sensitivity: 'low' });
    const derived = defineTrait('User', {
      type: 'anomaly',
      name: 'derived',
      baseline: ['x'],
      sensitivity: 'low',
      traits: [base],
    });
    const sorted = topologicalSort([derived, base]);
    const names = sorted.map((t) => t.name);
    expect(names.indexOf('base')).toBeLessThan(names.indexOf('derived'));
  });

  it('handles multiple independent traits in input order', () => {
    const sorted = topologicalSort([churnRisk, anomalyScore, behaviorMatch]);
    expect(sorted.map((t) => t.name)).toEqual(['churnRisk', 'anomalyScore', 'behaviorMatch']);
  });

  it('handles diamond dependency — base appears only once', () => {
    const base = defineTrait('User', { type: 'anomaly', name: 'base', baseline: ['x'], sensitivity: 'low' });
    const left = defineTrait('User', {
      type: 'anomaly',
      name: 'left',
      baseline: ['x'],
      sensitivity: 'low',
      traits: [base],
    });
    const right = defineTrait('User', {
      type: 'anomaly',
      name: 'right',
      baseline: ['x'],
      sensitivity: 'low',
      traits: [base],
    });
    const top = defineTrait('User', {
      type: 'anomaly',
      name: 'top',
      baseline: ['x'],
      sensitivity: 'low',
      traits: [left, right],
    });
    const sorted = topologicalSort([base, left, right, top]);
    const names = sorted.map((t) => t.name);
    // base should appear exactly once
    expect(names.filter((n) => n === 'base')).toHaveLength(1);
    // base before left and right, left and right before top
    expect(names.indexOf('base')).toBeLessThan(names.indexOf('left'));
    expect(names.indexOf('base')).toBeLessThan(names.indexOf('right'));
    expect(names.indexOf('left')).toBeLessThan(names.indexOf('top'));
    expect(names.indexOf('right')).toBeLessThan(names.indexOf('top'));
  });
});
