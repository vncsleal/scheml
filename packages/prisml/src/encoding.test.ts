import { describe, it, expect } from 'vitest';
import {
  normalizeScalarValue,
  buildCategoryMapping,
  buildCategories,
  normalizeFeatureVector,
} from './encoding';
import { FeatureSchema } from './types';

describe('normalizeScalarValue', () => {
  describe('numbers', () => {
    it('passes through integers', () => {
      expect(normalizeScalarValue(42, 'price')).toBe(42);
    });

    it('passes through floats', () => {
      expect(normalizeScalarValue(3.14, 'score')).toBeCloseTo(3.14);
    });

    it('passes through zero', () => {
      expect(normalizeScalarValue(0, 'count')).toBe(0);
    });

    it('passes through negative numbers', () => {
      expect(normalizeScalarValue(-5, 'delta')).toBe(-5);
    });

    it('throws on NaN', () => {
      expect(() => normalizeScalarValue(NaN, 'score')).toThrow();
    });

    it('throws on Infinity', () => {
      expect(() => normalizeScalarValue(Infinity, 'score')).toThrow();
    });
  });

  describe('booleans', () => {
    it('encodes true as 1', () => {
      expect(normalizeScalarValue(true, 'isActive')).toBe(1);
    });

    it('encodes false as 0', () => {
      expect(normalizeScalarValue(false, 'isActive')).toBe(0);
    });
  });

  describe('strings (categorical)', () => {
    it('encodes a known category via label encoding', () => {
      const encoding = { type: 'label' as const, mapping: { free: 0, pro: 1, enterprise: 2 } };
      expect(normalizeScalarValue('pro', 'plan', encoding)).toBe(1);
    });

    it('encodes first category as 0', () => {
      const encoding = { type: 'label' as const, mapping: { free: 0, pro: 1 } };
      expect(normalizeScalarValue('free', 'plan', encoding)).toBe(0);
    });

    it('throws UnseenCategoryError for unknown label', () => {
      const encoding = { type: 'label' as const, mapping: { free: 0, pro: 1 } };
      expect(() => normalizeScalarValue('enterprise', 'plan', encoding)).toThrow();
    });

    it('encodes via hash encoding (returns a number)', () => {
      const encoding = { type: 'hash' as const };
      const result = normalizeScalarValue('anything', 'tag', encoding);
      expect(typeof result).toBe('number');
      expect(result).toBeGreaterThanOrEqual(0);
    });

    it('hash encoding is deterministic', () => {
      const encoding = { type: 'hash' as const };
      const a = normalizeScalarValue('stable', 'tag', encoding);
      const b = normalizeScalarValue('stable', 'tag', encoding);
      expect(a).toBe(b);
    });

    it('throws if string value has no encoding', () => {
      expect(() => normalizeScalarValue('hello', 'tag')).toThrow();
    });
  });

  describe('dates', () => {
    it('converts Date to seconds since epoch', () => {
      const d = new Date('2020-01-01T00:00:00.000Z');
      const result = normalizeScalarValue(d, 'createdAt');
      expect(result).toBe(d.getTime() / 1000);
    });
  });

  describe('null / undefined', () => {
    it('applies constant imputation for null', () => {
      const result = normalizeScalarValue(null, 'score', undefined, {
        strategy: 'constant',
        value: -1,
      });
      expect(result).toBe(-1);
    });

    it('applies constant imputation for undefined', () => {
      const result = normalizeScalarValue(undefined, 'score', undefined, {
        strategy: 'constant',
        value: 0,
      });
      expect(result).toBe(0);
    });

    it('throws when null with no imputation rule', () => {
      expect(() => normalizeScalarValue(null, 'score')).toThrow();
    });

    it('supports string constant imputation for categorical features', () => {
      const result = normalizeFeatureVector(
        { plan: null },
        {
          features: [{ name: 'plan', index: 0, originalType: 'string', columnCount: 2 }],
          count: 2,
          order: ['plan'],
        },
        {
          plan: { type: 'onehot', categories: ['free', 'pro'] },
        },
        {
          plan: { strategy: 'constant', value: 'pro' },
        }
      );

      expect(result).toEqual([0, 1]);
    });
  });
});

describe('buildCategoryMapping', () => {
  it('builds a label mapping from distinct values', () => {
    const mapping = buildCategoryMapping(['free', 'pro', 'enterprise']);
    expect(Object.keys(mapping)).toHaveLength(3);
    expect(typeof mapping['free']).toBe('number');
    expect(typeof mapping['pro']).toBe('number');
  });

  it('produces sorted, deterministic mappings', () => {
    const m1 = buildCategoryMapping(['pro', 'free', 'enterprise']);
    const m2 = buildCategoryMapping(['enterprise', 'pro', 'free']);
    expect(m1).toEqual(m2);
  });

  it('assigns sequential integers starting at 0', () => {
    const mapping = buildCategoryMapping(['a', 'b', 'c']);
    const values = Object.values(mapping).sort();
    expect(values).toEqual([0, 1, 2]);
  });

  it('de-duplicates values', () => {
    const mapping = buildCategoryMapping(['x', 'x', 'y', 'y']);
    expect(Object.keys(mapping)).toHaveLength(2);
  });

  it('ignores null and undefined values', () => {
    const mapping = buildCategoryMapping(['a', null, undefined, 'b']);
    expect(Object.keys(mapping)).toHaveLength(2);
  });

  it('returns empty object for empty input', () => {
    expect(buildCategoryMapping([])).toEqual({});
  });
});

describe('buildCategories', () => {
  it('returns sorted unique categories', () => {
    expect(buildCategories(['b', 'a', 'b', 'c'])).toEqual(['a', 'b', 'c']);
  });

  it('ignores null and undefined values', () => {
    expect(buildCategories(['x', null, undefined, 'y'])).toEqual(['x', 'y']);
  });

  it('returns empty array for empty input', () => {
    expect(buildCategories([])).toEqual([]);
  });
});

describe('normalizeFeatureVector', () => {
  const schema: FeatureSchema = {
    features: [
      { name: 'price', index: 0, originalType: 'number', columnCount: 1 },
      { name: 'isActive', index: 1, originalType: 'boolean', columnCount: 1 },
      { name: 'plan', index: 2, originalType: 'string', columnCount: 1 },
    ],
    count: 3,
    order: ['price', 'isActive', 'plan'],
  };

  const encodings = {
    plan: { type: 'label' as const, mapping: { free: 0, pro: 1, enterprise: 2 } },
  };

  it('produces a numeric vector in schema order', () => {
    const vector = normalizeFeatureVector(
      { price: 99, isActive: true, plan: 'pro' },
      schema,
      encodings,
      {}
    );
    expect(vector).toHaveLength(3);
    expect(vector[0]).toBe(99);
    expect(vector[1]).toBe(1);
    expect(vector[2]).toBe(1);
  });

  it('all elements in the vector are finite numbers', () => {
    const vector = normalizeFeatureVector(
      { price: 0, isActive: false, plan: 'free' },
      schema,
      encodings,
      {}
    );
    expect(vector.every((v) => typeof v === 'number' && isFinite(v))).toBe(true);
  });

  it('respects index order from schema, not insertion order in input', () => {
    const vector = normalizeFeatureVector(
      { plan: 'enterprise', isActive: false, price: 50 }, // deliberately out of order
      schema,
      encodings,
      {}
    );
    expect(vector[0]).toBe(50);       // price at index 0
    expect(vector[1]).toBe(0);        // isActive at index 1
    expect(vector[2]).toBe(2);        // plan 'enterprise' → 2
  });

  it('throws on unseen category', () => {
    expect(() =>
      normalizeFeatureVector(
        { price: 10, isActive: true, plan: 'unknown_tier' },
        schema,
        encodings,
        {}
      )
    ).toThrow();
  });
});
