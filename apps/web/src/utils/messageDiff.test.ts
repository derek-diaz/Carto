import { expect, it } from 'vitest';
import { comparePayloads } from './messageDiff';

it('compares nested values, removals, falsy data and escaped JSON pointers', () => {
  expect(
    comparePayloads(
      { robot: { battery: 90 }, gone: true, 'a/b': null },
      { robot: { battery: 12 }, 'a/b': false, added: 0 }
    ).changes
  ).toEqual([
    { path: '/robot/battery', before: '90', after: '12', kind: 'changed' },
    { path: '/gone', before: 'true', after: undefined, kind: 'removed' },
    { path: '/a~1b', before: 'null', after: 'false', kind: 'changed' },
    { path: '/added', before: undefined, after: '0', kind: 'added' }
  ]);
});
it('ignores object property order and limits large comparisons', () => {
  expect(comparePayloads({ a: 1, b: 2 }, { b: 2, a: 1 }).changes).toEqual([]);
  expect(comparePayloads([1, 2, 3], [4, 5, 6], 2)).toMatchObject({
    truncated: true,
    changes: [{ path: '/0' }, { path: '/1' }]
  });
});

it('bounds output for multi-megabyte values and very wide JSON arrays', () => {
  const changes = comparePayloads(
    { data: 'a'.repeat(2 * 1024 * 1024) },
    { data: 'b'.repeat(2 * 1024 * 1024) }
  ).changes;
  expect(changes).toHaveLength(1);
  expect(changes[0].before?.length).toBe(2001);
  expect(changes[0].after?.length).toBe(2001);
  const wide = comparePayloads(Array(50000).fill(0), Array(50000).fill(1));
  expect(wide.truncated).toBe(true);
  expect(wide.changes).toHaveLength(300);
});
