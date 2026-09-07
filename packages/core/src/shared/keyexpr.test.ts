import { describe, expect, it } from 'vitest';
import { getKeyexprError, keyexprMatches } from './keyexpr';

describe('Zenoh key expressions', () => {
  it.each([
    'robots/*/state',
    'robots/**',
    'robots/sensor$*/state',
    '@/router/**',
    'a.b/$*sensor$*'
  ])('accepts %s', (value) => {
    expect(getKeyexprError(value)).toBeNull();
  });
  it.each([
    '/robots',
    'robots/',
    'robots//state',
    'robots/sensor*',
    'a?x=1',
    'a#b',
    'a/$',
    '**/**',
    '**/*',
    'a/$*',
    'a/b$*$*'
  ])('rejects %s', (value) => {
    expect(getKeyexprError(value)).not.toBeNull();
  });
  it.each([
    ['robots/sensor$*/state', 'robots/sensor12/state', true],
    ['robots/*/state', 'robots/state', false],
    ['robots/**/state', 'robots/state', true],
    ['robots/**', 'robots', true],
    ['a.b/*', 'axb/c', false],
    ['a\\b/*', 'a\\b/c', true],
    ['sensor$*end', 'sensor\nend', true],
    ['ab$*bc', 'abc', false],
    ['a$*b$*c', 'a12b34c', true],
    ['a$*b$*c', 'a12c34b', false],
    ['**', '@/router/status', false],
    ['@/**', '@/router/status', true],
    ['**', 'robots/@private/state', false],
    ['robots/**', 'robots//state', false]
  ])('matches %s against %s', (pattern, key, expected) => {
    expect(keyexprMatches(pattern, key)).toBe(expected);
  });
});
