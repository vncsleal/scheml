import { describe, it, expect } from 'vitest';
import { analyzeFeatureResolver, validateHydration } from '../../src/analysis';

// ---------------------------------------------------------------------------
// analyzeFeatureResolver
// ---------------------------------------------------------------------------

describe('analyzeFeatureResolver', () => {
  it('marks direct property access as extractable', () => {
    const result = analyzeFeatureResolver('(u) => u.age');
    expect(result.isExtractable).toBe(true);
  });

  it('uses provided functionName', () => {
    const result = analyzeFeatureResolver('(u) => u.age', 'ageResolver');
    expect(result.name).toBe('ageResolver');
  });

  it('falls back to "resolver" when no name provided', () => {
    const result = analyzeFeatureResolver('(u) => u.age');
    expect(result.name).toBe('resolver');
  });

  it('extracts access paths from direct property reads', () => {
    const result = analyzeFeatureResolver('(u) => u.createdAt');
    expect(result.accessPaths).toEqual([
      { segments: ['createdAt'], isOptional: false, isArrayLength: false },
    ]);
  });

  it('reports method calls as warnings', () => {
    const result = analyzeFeatureResolver('(u) => u.name.trim()');
    expect(result.issues).toHaveLength(1);
    const issue = result.issues[0];
    expect(issue.severity).toBe('warning');
    expect(issue.code).toBe('METHOD_CALL');
  });
});

// ---------------------------------------------------------------------------
// validateHydration
// ---------------------------------------------------------------------------

describe('validateHydration', () => {
  it('returns valid:true and no errors for empty accessPaths', () => {
    const result = validateHydration([], {});
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('returns valid:true when a single-segment path resolves on the entity', () => {
    const paths = [{ segments: ['age'], isOptional: false, isArrayLength: false }];
    const result = validateHydration(paths, { age: 30 });
    expect(result.valid).toBe(true);
  });

  it('returns valid:false when multi-segment traversal hits undefined mid-path', () => {
    // segments: ['a', 'b'] on {} → current['a'] = undefined, then 'b' is accessed on undefined
    const paths = [{ segments: ['a', 'b'], isOptional: false, isArrayLength: false }];
    const result = validateHydration(paths, {});
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toContain('a.b');
  });

  it('returns valid:false when intermediate path is null and not in allowNull', () => {
    // segments: ['a', 'b'] on { a: null } → current['a'] = null, then null is traversed
    const paths = [{ segments: ['a', 'b'], isOptional: false, isArrayLength: false }];
    const result = validateHydration(paths, { a: null });
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('a.b');
  });

  it('returns valid:true when intermediate null path is in allowNull', () => {
    const paths = [{ segments: ['a', 'b'], isOptional: false, isArrayLength: false }];
    const result = validateHydration(paths, { a: null }, new Set(['a.b']));
    expect(result.valid).toBe(true);
  });

  it('returns valid:false when isArrayLength is true and final value is not an array', () => {
    const paths = [{ segments: ['tags'], isOptional: false, isArrayLength: true }];
    const result = validateHydration(paths, { tags: 'not-an-array' });
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('length');
  });

  it('returns valid:true when isArrayLength is true and final value is an array', () => {
    const paths = [{ segments: ['tags'], isOptional: false, isArrayLength: true }];
    const result = validateHydration(paths, { tags: ['a', 'b'] });
    expect(result.valid).toBe(true);
  });

  it('returns valid:false when current is not an object and traversal continues', () => {
    // segments: ['name', 'len'] on { name: 42 } → current['name'] = 42, try to go deeper
    const paths = [{ segments: ['name', 'len'], isOptional: false, isArrayLength: false }];
    const result = validateHydration(paths, { name: 42 });
    expect(result.valid).toBe(false);
  });
});
