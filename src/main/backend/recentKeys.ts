import type { RecentKeyStats } from '../../shared/types';

export class RecentKeysIndex {
  private entries = new Map<string, RecentKeyStats>();
  private maxEntries: number;

  constructor(maxEntries = 1000) {
    this.maxEntries = maxEntries;
  }

  update(key: string, sizeBytes: number, ts: number): void {
    const current = this.entries.get(key);
    if (current) {
      current.count += 1;
      current.lastSeen = ts;
      current.bytes += sizeBytes;
      current.lastSize = sizeBytes;
    } else {
      this.entries.set(key, {
        key,
        count: 1,
        lastSeen: ts,
        bytes: sizeBytes,
        lastSize: sizeBytes
      });
    }

    if (this.entries.size > this.maxEntries) {
      this.pruneOldest();
    }
  }

  list(filter?: string): RecentKeyStats[] {
    const needle = filter?.trim().toLowerCase();
    const values = [...this.entries.values()].filter((entry) => {
      if (!needle) return true;
      return entry.key.toLowerCase().includes(needle);
    });

    return values.sort((a, b) => b.lastSeen - a.lastSeen);
  }

  clear(): void {
    this.entries.clear();
  }

  private pruneOldest(): void {
    let oldestKey: string | null = null;
    let oldestTs = Number.POSITIVE_INFINITY;
    for (const [key, entry] of this.entries.entries()) {
      if (entry.lastSeen < oldestTs) {
        oldestTs = entry.lastSeen;
        oldestKey = key;
      }
    }
    if (oldestKey) {
      this.entries.delete(oldestKey);
    }
  }
}
