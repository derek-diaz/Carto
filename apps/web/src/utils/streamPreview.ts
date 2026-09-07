// Summarize only complete JSON values available in the retained preview. Never
// fetch full payloads for rows or repair an incomplete value into guessed data.
export function summarizeJsonPreview(source: string): string | null {
  const text = source.trim();
  if (!text.startsWith('{')) return null;
  let value: unknown;
  let incomplete = false;
  try {
    value = JSON.parse(text);
  } catch {
    // A bounded preview may end halfway through a field. Track strings and nested
    // containers to find the last complete top-level field boundary.
    let depth = 0;
    let quoted = false;
    let escaped = false;
    let boundary = -1;
    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      if (quoted) {
        if (escaped) escaped = false;
        else if (char === '\\') escaped = true;
        else if (char === '"') quoted = false;
      } else if (char === '"') quoted = true;
      else if (char === '{' || char === '[') depth++;
      else if (char === '}' || char === ']') depth--;
      else if (char === ',' && depth === 1) boundary = i;
    }
    if (boundary < 0) return null;
    try {
      value = JSON.parse(`${text.slice(0, boundary)}}`);
    } catch {
      return null;
    }
    incomplete = true;
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const entries = Object.entries(value);
  if (!entries.length) return '{}';
  const display = (item: unknown) => {
    if (Array.isArray(item)) return `[${item.length} items]`;
    if (item !== null && typeof item === 'object') return `{${Object.keys(item).length} fields}`;
    if (typeof item === 'string' && item.length > 40)
      return JSON.stringify(`${item.slice(0, 40)}…`);
    return JSON.stringify(item);
  };
  return `{ ${entries
    .slice(0, 4)
    .map(([key, item]) => `${JSON.stringify(key)}: ${display(item)}`)
    .join(', ')}${entries.length > 4 || incomplete ? ', …' : ''} }`;
}
