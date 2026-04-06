import { describe, it, expect } from 'vitest';
import { TTLCache } from '../../src/cache';

describe('TTLCache', () => {
  it('stores and retrieves values before expiry', () => {
    const cache = new TTLCache<string, number>(1000);
    cache.set('a', 1);
    expect(cache.get('a')).toBe(1);
    expect(cache.has('a')).toBe(true);
  });

  it('deletes values', () => {
    const cache = new TTLCache<string, number>(1000);
    cache.set('a', 1);
    cache.delete('a');
    expect(cache.get('a')).toBeUndefined();
  });

  it('clears all values', () => {
    const cache = new TTLCache<string, number>(1000);
    cache.set('a', 1);
    cache.set('b', 2);
    cache.clear();
    expect(cache.size()).toBe(0);
  });
});
