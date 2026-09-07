import { getKeyexprError } from '../../../../packages/core/src/shared/keyexpr';

// Suggest one varying segment; keep unrelated branches and verbatim segments distinct.
export const suggestSubscriptions = (keys: string[]) => {
  const groups = new Map<string, Set<string>>();
  for (const key of new Set(keys)) {
    const chunks = key.split('/');
    if (chunks.length > 32) continue;
    for (let index = 1; index < chunks.length - 1; index += 1) {
      if (chunks[index].startsWith('@')) continue;
      const pattern = chunks.map((part, offset) => (offset === index ? '*' : part)).join('/');
      if (getKeyexprError(pattern)) continue;
      const members = groups.get(pattern) ?? new Set<string>();
      members.add(key);
      groups.set(pattern, members);
    }
  }
  return [...groups.entries()]
    .filter(([, members]) => members.size >= 2)
    .map(([expression, members]) => ({ expression, count: members.size }))
    .sort((a, b) => b.count - a.count || a.expression.localeCompare(b.expression))
    .slice(0, 6);
};
