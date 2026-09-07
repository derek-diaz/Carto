import { describe, expect, it } from 'vitest';
import { createPayloadCache, DEFAULT_PAYLOAD_CACHE_BYTES } from './payloadCache';
const bytes = (size: number, value = 1) => new Uint8Array(size).fill(value);
describe('shared payload retention budget', () => {
  it('evicts by arrival across subscriptions without refreshing age on reads', () => {
    const cache = createPayloadCache({ maxBytes: 8 });
    cache.set('a', '1', bytes(4), 10);
    cache.set('b', '2', bytes(4), 10);
    expect(cache.get('a', '1')).toBeDefined();
    cache.set('c', '3', bytes(4), 10);
    expect(cache.get('a', '1')).toBeUndefined();
    expect(cache.get('b', '2')).toBeDefined();
    expect(cache.get('c', '3')).toBeDefined();
    expect(cache.stats()).toEqual({ bytes: 8, count: 2, subscriptions: 2, maxBytes: 8 });
  });
  it('preserves per-subscription byte and count limits within the shared budget', () => {
    const cache = createPayloadCache({
      maxBytes: 20,
      maxBytesPerSubscription: 8,
      maxMessagesPerSubscription: 2
    });
    cache.set('b', 'b', bytes(4), 10);
    for (let i = 0; i < 3; i++) cache.set('a', String(i), bytes(4), 10);
    expect(cache.get('a', '0')).toBeUndefined();
    expect(cache.get('b', 'b')).toBeDefined();
    expect(cache.stats().bytes).toBe(12);
    for (let i = 0; i < 3; i++) cache.set('empty', String(i), bytes(0), 10);
    expect(cache.get('empty', '0')).toBeUndefined();
    expect(cache.stats().count).toBe(5);
  });
  it('skips oversized samples without purging unrelated history', () => {
    const cache = createPayloadCache({ maxBytes: 8, maxBytesPerSubscription: 4 });
    cache.set('a', '1', bytes(4), 10);
    expect(cache.set('b', '2', bytes(5), 10)).toBe(false);
    expect(cache.stats().bytes).toBe(4);
    expect(cache.get('a', '1')).toBeDefined();
  });
  it('reclaims bytes on trimming, replacement, subscription removal and reset', () => {
    const cache = createPayloadCache({ maxBytes: 16 });
    cache.set('a', '1', bytes(4), 10);
    cache.set('a', '2', bytes(4), 10);
    cache.set('b', '1', bytes(4), 10);
    cache.trim('a', 1);
    expect(cache.stats().bytes).toBe(8);
    cache.set('a', '2', bytes(2), 10);
    expect(cache.stats().bytes).toBe(6);
    cache.clearSubscription('a');
    expect(cache.stats().bytes).toBe(4);
    cache.clear();
    expect(cache.stats()).toEqual({ bytes: 0, count: 0, subscriptions: 0, maxBytes: 16 });
    cache.set('a', '1', bytes(16), 10);
    expect(cache.stats().bytes).toBe(16);
  });
  it('owns retained bytes and preserves snapshots acquired before eviction', () => {
    const cache = createPayloadCache({ maxBytes: 4 });
    const source = bytes(4, 7);
    cache.set('a', '1', source, 10);
    const acquired = cache.get('a', '1');
    source.fill(0);
    cache.set('b', '2', bytes(4, 9), 10);
    expect(acquired).toEqual(bytes(4, 7));
    expect(cache.get('a', '1')).toBeUndefined();
  });
  it('keeps accounting bounded through churn across many subscriptions', () => {
    const cache = createPayloadCache({ maxBytes: 32, maxBytesPerSubscription: 16 });
    for (let i = 0; i < 10000; i++) {
      cache.set(`s${i % 10}`, `m${i}`, bytes(i % 9), 4);
      if (i % 13 === 0) cache.clearSubscription(`s${(i + 3) % 10}`);
      const stats = cache.stats();
      expect(stats.bytes).toBeGreaterThanOrEqual(0);
      expect(stats.bytes).toBeLessThanOrEqual(32);
      expect(stats.count).toBeLessThanOrEqual(40);
    }
    cache.clear();
    expect(cache.stats().bytes).toBe(0);
    expect(cache.stats().count).toBe(0);
  });
  it('defaults to 256 MiB and rejects invalid configured budgets', () => {
    expect(DEFAULT_PAYLOAD_CACHE_BYTES).toBe(256 * 1024 * 1024);
    for (const maxBytes of [undefined, NaN, Infinity, -1, 0])
      expect(createPayloadCache({ maxBytes }).stats().maxBytes).toBe(DEFAULT_PAYLOAD_CACHE_BYTES);
  });
});
