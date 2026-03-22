export const getKeyexprError = (keyexpr: string): string | null => {
  const trimmed = keyexpr.trim();
  if (!trimmed) {
    return 'Key expression is required.';
  }
  if (trimmed.includes('\\')) {
    return 'Key expression cannot contain backslashes. Use "/" separators.';
  }

  const segments = trimmed.split('/');
  for (const segment of segments) {
    if (!segment) continue;
    if (segment.includes('*') && segment !== '*' && segment !== '**') {
      return 'Wildcards must be standalone "*" or "**" path segments.';
    }
  }

  return null;
};

const splitSegments = (value: string): string[] => {
  if (!value) return [];
  return value.split('/').filter((segment) => segment.length > 0);
};

const matchesSegments = (
  patternSegments: string[],
  keySegments: string[],
  patternIndex: number,
  keyIndex: number
): boolean => {
  if (patternIndex >= patternSegments.length) {
    return keyIndex >= keySegments.length;
  }

  const segment = patternSegments[patternIndex];
  if (segment === '**') {
    if (patternIndex === patternSegments.length - 1) {
      return true;
    }
    for (let nextKeyIndex = keyIndex; nextKeyIndex <= keySegments.length; nextKeyIndex += 1) {
      if (matchesSegments(patternSegments, keySegments, patternIndex + 1, nextKeyIndex)) {
        return true;
      }
    }
    return false;
  }

  if (keyIndex >= keySegments.length) {
    return false;
  }

  if (segment === '*') {
    return matchesSegments(patternSegments, keySegments, patternIndex + 1, keyIndex + 1);
  }

  if (segment !== keySegments[keyIndex]) {
    return false;
  }

  return matchesSegments(patternSegments, keySegments, patternIndex + 1, keyIndex + 1);
};

export const keyexprMatches = (pattern: string, key: string): boolean => {
  const patternSegments = splitSegments(pattern.trim());
  const keySegments = splitSegments(key.trim());
  return matchesSegments(patternSegments, keySegments, 0, 0);
};
