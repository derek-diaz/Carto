// Synchronous rules shared by browser and server; the SDK also validates declarations.
export const getKeyexprError = (keyexpr: string): string | null => {
  const value = keyexpr.trim();
  if (!value) return 'Key expression is required.';
  if (/[?#\u0000]/u.test(value))
    return 'Key expressions cannot contain "?", "#", or null characters.';
  const chunks = value.split('/');
  if (chunks.some((chunk) => !chunk))
    return 'Remove leading, trailing, or repeated "/" separators.';
  for (let index = 0; index < chunks.length; index += 1) {
    const chunk = chunks[index];
    if (chunk === '**' && (chunks[index + 1] === '**' || chunks[index + 1] === '*')) {
      return 'Use canonical wildcards: replace "**/**" with "**" and "**/*" with "*/**".';
    }
    if (chunk === '*' || chunk === '**') continue;
    if (chunk === '$*' || chunk.includes('$*$*'))
      return 'Use "*" for a whole chunk and collapse adjacent "$*" wildcards.';
    if (/[$*]/u.test(chunk.replaceAll('$*', '')))
      return 'Use "*" or "**" for a whole chunk, or "$*" within a name (sensor$*).';
  }
  return null;
};

const chunkMatches = (pattern: string, key: string): boolean => {
  if (key.startsWith('@') || pattern.startsWith('@')) return pattern === key;
  if (pattern === '*') return true;
  const parts = pattern.split('$*');
  if (parts.length === 1) return pattern === key;
  if (!key.startsWith(parts[0])) return false;
  let position = parts[0].length;
  for (const part of parts.slice(1, -1)) {
    const found = key.indexOf(part, position);
    if (found < 0) return false;
    position = found + part.length;
  }
  const suffix = parts[parts.length - 1];
  return key.endsWith(suffix) && key.length - suffix.length >= position;
};

export const keyexprMatches = (pattern: string, key: string): boolean => {
  if (getKeyexprError(pattern) || getKeyexprError(key) || /[$*]/u.test(key)) return false;
  const patterns = pattern.trim().split('/');
  const keys = key.trim().split('/');
  let previous = new Array<boolean>(keys.length + 1).fill(false);
  previous[0] = true;
  for (const chunk of patterns) {
    const next = new Array<boolean>(keys.length + 1).fill(false);
    next[0] = chunk === '**' && previous[0];
    for (let index = 1; index <= keys.length; index += 1) {
      next[index] =
        chunk === '**'
          ? previous[index] || (next[index - 1] && !keys[index - 1].startsWith('@'))
          : previous[index - 1] && chunkMatches(chunk, keys[index - 1]);
    }
    previous = next;
  }
  return previous[keys.length];
};
