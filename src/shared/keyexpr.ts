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
