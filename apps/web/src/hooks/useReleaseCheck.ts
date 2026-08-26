import { useCallback, useEffect, useState } from 'react';
import {
  compareRelease,
  fetchLatestRelease,
  type CartoRelease,
  type ReleaseComparison
} from '../utils/releaseCheck';

const RELEASE_CACHE_KEY = 'carto.releaseCheck.v1';
const RELEASE_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const RELEASE_CHECK_TIMEOUT_MS = 8000;

export type ReleaseCheckState = {
  status: 'checking' | 'ready' | 'error';
  comparison: ReleaseComparison;
  release?: CartoRelease;
  checkedAt?: number;
  error?: string;
};

type CachedRelease = {
  currentVersion: string;
  checkedAt: number;
  release: CartoRelease;
};

const readCachedRelease = (currentVersion: string): CachedRelease | null => {
  if (!('localStorage' in globalThis)) return null;
  try {
    const parsed = JSON.parse(
      globalThis.localStorage.getItem(RELEASE_CACHE_KEY) ?? 'null'
    ) as CachedRelease | null;
    if (!parsed || parsed.currentVersion !== currentVersion) return null;
    if (!parsed.release?.tagName || !parsed.release?.url) return null;
    if (Date.now() - parsed.checkedAt > RELEASE_CACHE_TTL_MS) return null;
    return parsed;
  } catch {
    return null;
  }
};

const persistRelease = (currentVersion: string, checkedAt: number, release: CartoRelease) => {
  if (!('localStorage' in globalThis)) return;
  globalThis.localStorage.setItem(
    RELEASE_CACHE_KEY,
    JSON.stringify({ currentVersion, checkedAt, release } satisfies CachedRelease)
  );
};

export const useReleaseCheck = (currentVersion: string) => {
  const [state, setState] = useState<ReleaseCheckState>(() => {
    const cached = readCachedRelease(currentVersion);
    if (!cached) return { status: 'checking', comparison: 'unknown' };
    return {
      status: 'ready',
      comparison: compareRelease(currentVersion, cached.release),
      release: cached.release,
      checkedAt: cached.checkedAt
    };
  });

  const checkNow = useCallback(async () => {
    setState((current) => ({ ...current, status: 'checking', error: undefined }));
    const controller = new AbortController();
    const timeout = globalThis.setTimeout(() => controller.abort(), RELEASE_CHECK_TIMEOUT_MS);
    try {
      const release = await fetchLatestRelease(controller.signal);
      const checkedAt = Date.now();
      persistRelease(currentVersion, checkedAt, release);
      setState({
        status: 'ready',
        comparison: compareRelease(currentVersion, release),
        release,
        checkedAt
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setState((current) => ({ ...current, status: 'error', error: message }));
    } finally {
      globalThis.clearTimeout(timeout);
    }
  }, [currentVersion]);

  useEffect(() => {
    const cached = readCachedRelease(currentVersion);
    if (!cached) void checkNow();
    const interval = globalThis.setInterval(() => void checkNow(), RELEASE_CACHE_TTL_MS);
    return () => globalThis.clearInterval(interval);
  }, [checkNow, currentVersion]);

  return { state, checkNow };
};
