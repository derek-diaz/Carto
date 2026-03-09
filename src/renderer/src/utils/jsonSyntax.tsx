import type { ReactNode } from 'react';

const jsonTokenPattern =
  /"(?:\\u[\da-fA-F]{4}|\\[^u]|[^\\"])*"|\btrue\b|\bfalse\b|\bnull\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g;

type JsonTokenType = 'key' | 'string' | 'number' | 'boolean' | 'null';

export const formatJson = (value: unknown): string => {
  try {
    const json = JSON.stringify(value, null, 2);
    if (json !== undefined) return json;
  } catch {
    // fall through to string conversion
  }
  return String(value);
};

const getJsonTokenType = (token: string, source: string, startIndex: number): JsonTokenType => {
  if (token.startsWith('"')) {
    let nextIndex = startIndex + token.length;
    while (nextIndex < source.length && /\s/.test(source[nextIndex])) {
      nextIndex += 1;
    }
    return source[nextIndex] === ':' ? 'key' : 'string';
  }
  if (token === 'true' || token === 'false') return 'boolean';
  if (token === 'null') return 'null';
  return 'number';
};

export const highlightJson = (json: string, keyPrefix = ''): ReactNode[] => {
  const tokens: ReactNode[] = [];
  let startIndex = 0;
  jsonTokenPattern.lastIndex = 0;
  let match = jsonTokenPattern.exec(json);

  while (match) {
    const index = match.index;
    const token = match[0];
    if (index > startIndex) {
      tokens.push(json.slice(startIndex, index));
    }
    const tokenType = getJsonTokenType(token, json, index);
    tokens.push(
      <span className={`json_token json_token--${tokenType}`} key={`${keyPrefix}${index}-${token}`}>
        {token}
      </span>
    );
    startIndex = index + token.length;
    match = jsonTokenPattern.exec(json);
  }

  if (startIndex < json.length) {
    tokens.push(json.slice(startIndex));
  }
  return tokens;
};
