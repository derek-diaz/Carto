import { describe, expect, it } from 'vitest';
import { compareRelease, compareVersions } from './releaseCheck';

describe('release version comparison', () => {
  it('handles v-prefixed stable versions', () => {
    expect(compareVersions('0.8.0', 'v0.8.1')).toBe(-1);
    expect(compareVersions('0.8.1', 'v0.8.1')).toBe(0);
    expect(compareVersions('0.9.0', 'v0.8.1')).toBe(1);
  });

  it('orders prereleases before their stable release', () => {
    expect(compareVersions('1.0.0-beta.2', '1.0.0-beta.10')).toBe(-1);
    expect(compareVersions('1.0.0-rc.1', '1.0.0')).toBe(-1);
  });

  it('describes update, current, and development builds', () => {
    expect(compareRelease('0.8.0', { tagName: 'v0.8.1' })).toBe('available');
    expect(compareRelease('0.8.1', { tagName: 'v0.8.1' })).toBe('current');
    expect(compareRelease('0.9.0', { tagName: 'v0.8.1' })).toBe('ahead');
  });
});
