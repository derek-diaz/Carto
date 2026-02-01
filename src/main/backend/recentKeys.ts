import type { RecentKeyStats } from '../../shared/types';

export type RecentKeysIndex = {
  update: (key: string, sizeBytes: number, ts: number) => void;
  list: (filter?: string) => RecentKeyStats[];
  clear: () => void;
};

export const createRecentKeysIndex = (maxEntries = 1000): RecentKeysIndex => {
  const entries = new Map<string, RecentKeyStats>();

  const pruneOldest = (): void => {
    let oldestKey: string | null = null;
    let oldestTs = Number.POSITIVE_INFINITY;
    for (const [key, entry] of entries.entries()) {
      if (entry.lastSeen < oldestTs) {
        oldestTs = entry.lastSeen;
        oldestKey = key;
      }
    }
    if (oldestKey) {
      entries.delete(oldestKey);
    }
  };

  const update = (key: string, sizeBytes: number, ts: number): void => {
    const current = entries.get(key);
    if (current) {
      current.count += 1;
      current.lastSeen = ts;
      current.bytes += sizeBytes;
      current.lastSize = sizeBytes;
    } else {
      entries.set(key, {
        key,
        count: 1,
        lastSeen: ts,
        bytes: sizeBytes,
        lastSize: sizeBytes
      });
    }

    if (entries.size > maxEntries) {
      pruneOldest();
    }
  };

  const list = (filter?: string): RecentKeyStats[] => {
    const needle = filter?.trim().toLowerCase();
    const values = [...entries.values()].filter((entry) => {
      if (!needle) return true;
      return entry.key.toLowerCase().includes(needle);
    });

    return values.sort((a, b) => b.lastSeen - a.lastSeen);
  };

  const clear = (): void => {
    entries.clear();
  };

  return {
    update,
    list,
    clear
  };
};
