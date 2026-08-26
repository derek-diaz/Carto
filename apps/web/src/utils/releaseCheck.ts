export const CARTO_RELEASES_URL = 'https://github.com/derek-diaz/Carto/releases';
export const CARTO_REPOSITORY_URL = 'https://github.com/derek-diaz/Carto';
export const CARTO_LATEST_RELEASE_API =
  'https://api.github.com/repos/derek-diaz/Carto/releases/latest';

export type CartoRelease = {
  tagName: string;
  name: string;
  url: string;
  publishedAt: string;
  notes?: string;
};

export type ReleaseComparison = 'available' | 'current' | 'ahead' | 'unknown';

type ParsedVersion = {
  core: [number, number, number];
  prerelease: string[];
};

const parseVersion = (value: string): ParsedVersion | null => {
  const match = value
    .trim()
    .match(/^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/);
  if (!match) return null;
  return {
    core: [Number(match[1]), Number(match[2] ?? 0), Number(match[3] ?? 0)],
    prerelease: match[4]?.split('.') ?? []
  };
};

const comparePrereleasePart = (left: string, right: string): number => {
  const leftNumber = /^\d+$/.test(left) ? Number(left) : null;
  const rightNumber = /^\d+$/.test(right) ? Number(right) : null;
  if (leftNumber !== null && rightNumber !== null) return Math.sign(leftNumber - rightNumber);
  if (leftNumber !== null) return -1;
  if (rightNumber !== null) return 1;
  return left.localeCompare(right);
};

export const compareVersions = (leftValue: string, rightValue: string): number | null => {
  const left = parseVersion(leftValue);
  const right = parseVersion(rightValue);
  if (!left || !right) return null;

  for (let index = 0; index < left.core.length; index += 1) {
    const difference = left.core[index] - right.core[index];
    if (difference !== 0) return Math.sign(difference);
  }

  if (left.prerelease.length === 0 && right.prerelease.length === 0) return 0;
  if (left.prerelease.length === 0) return 1;
  if (right.prerelease.length === 0) return -1;

  const length = Math.max(left.prerelease.length, right.prerelease.length);
  for (let index = 0; index < length; index += 1) {
    const leftPart = left.prerelease[index];
    const rightPart = right.prerelease[index];
    if (leftPart === undefined) return -1;
    if (rightPart === undefined) return 1;
    const comparison = comparePrereleasePart(leftPart, rightPart);
    if (comparison !== 0) return comparison;
  }
  return 0;
};

export const compareRelease = (
  currentVersion: string,
  release: Pick<CartoRelease, 'tagName'>
): ReleaseComparison => {
  const comparison = compareVersions(currentVersion, release.tagName);
  if (comparison === null) return 'unknown';
  if (comparison < 0) return 'available';
  if (comparison > 0) return 'ahead';
  return 'current';
};

export const fetchLatestRelease = async (signal?: AbortSignal): Promise<CartoRelease> => {
  const response = await fetch(CARTO_LATEST_RELEASE_API, {
    headers: { Accept: 'application/vnd.github+json' },
    signal
  });
  if (!response.ok) {
    throw new Error(`GitHub release check failed (${response.status}).`);
  }

  const data = (await response.json()) as Record<string, unknown>;
  const tagName = typeof data.tag_name === 'string' ? data.tag_name : '';
  const url = typeof data.html_url === 'string' ? data.html_url : '';
  if (!tagName || !url) throw new Error('GitHub returned an invalid release response.');

  return {
    tagName,
    name: typeof data.name === 'string' && data.name.trim() ? data.name : tagName,
    url,
    publishedAt: typeof data.published_at === 'string' ? data.published_at : '',
    notes: typeof data.body === 'string' && data.body.trim() ? data.body : undefined
  };
};
