import { describe, expect, it } from 'vitest';
import { suggestSubscriptions } from './discoverySuggestions';

describe('discovery suggestions', () => {
  it('suggests a shared topic across distinct devices', () => {
    expect(
      suggestSubscriptions(['robots/atlas/state', 'robots/orion/state', 'robots/atlas/state'])
    ).toEqual([{ expression: 'robots/*/state', count: 2 }]);
  });
  it('keeps unrelated namespaces and verbatim segments separate', () => {
    expect(
      suggestSubscriptions([
        'robots/@atlas/state',
        'robots/@orion/state',
        'robots/atlas/state',
        'sensors/orion/state'
      ])
    ).toEqual([]);
  });
  it('does not suggest a wildcard from a single observation', () => {
    expect(suggestSubscriptions(['robots/atlas/state', 'robots/atlas/state'])).toEqual([]);
  });
});
