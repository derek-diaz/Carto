export type FieldChange = {
  path: string;
  before?: string;
  after?: string;
  kind: 'added' | 'removed' | 'changed';
};

export const comparePayloads = (
  before: unknown,
  after: unknown,
  limit = 300
): { changes: FieldChange[]; truncated: boolean } => {
  const changes: FieldChange[] = [];
  let visited = 0;
  let truncated = false;
  const format = (value: unknown) => {
    const text = JSON.stringify(value) ?? String(value);
    return text.length > 2000 ? `${text.slice(0, 2000)}…` : text;
  };
  const visit = (
    left: unknown,
    right: unknown,
    path: string,
    leftExists = true,
    rightExists = true,
    depth = 0
  ) => {
    if (++visited > 10000 || changes.length >= limit) {
      truncated = true;
      return;
    }
    if (leftExists && rightExists && Object.is(left, right)) return;
    if (
      leftExists &&
      rightExists &&
      left !== null &&
      right !== null &&
      typeof left === 'object' &&
      typeof right === 'object' &&
      Array.isArray(left) === Array.isArray(right) &&
      depth < 40
    ) {
      const a = left as Record<string, unknown>;
      const b = right as Record<string, unknown>;
      for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
        visit(
          a[key],
          b[key],
          `${path}/${key.replaceAll('~', '~0').replaceAll('/', '~1')}`,
          Object.hasOwn(a, key),
          Object.hasOwn(b, key),
          depth + 1
        );
        if (truncated) break;
      }
    } else {
      changes.push({
        path: path || '/',
        before: leftExists ? format(left) : undefined,
        after: rightExists ? format(right) : undefined,
        kind: !leftExists ? 'added' : !rightExists ? 'removed' : 'changed'
      });
    }
  };
  visit(before, after, '');
  return { changes, truncated };
};
