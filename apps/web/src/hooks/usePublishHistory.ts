import { useEffect, useState } from 'react';
import { publishFormats, type PublishDraft } from '../utils/publishComposer';
const KEYS = 'carto.keyexpr.publish.history';
const DETAILS = 'carto.keyexpr.publish.details';
const EVENT = 'carto.history.updated';
let session: PublishDraft[] = [];
const read = () => {
  try {
    if (session.length) return session;
    const keys: unknown = JSON.parse(localStorage.getItem(KEYS) ?? '[]');
    const details = JSON.parse(localStorage.getItem(DETAILS) ?? '{}');
    if (!Array.isArray(keys)) return session;
    return keys
      .filter((key): key is string => typeof key === 'string')
      .slice(0, 8)
      .map((key) => {
        const cached = session.find((entry) => entry.keyexpr === key);
        const stored = details?.[key];
        if (cached) return cached;
        return stored &&
          typeof stored.payload === 'string' &&
          publishFormats.includes(stored.encoding)
          ? ({
              keyexpr: key,
              encoding: stored.encoding,
              payload: stored.payload,
              protoTypeId: typeof stored.protoTypeId === 'string' ? stored.protoTypeId : undefined,
              wireEncoding:
                typeof stored.wireEncoding === 'string' ? stored.wireEncoding : undefined,
              publishedAt: typeof stored.publishedAt === 'number' ? stored.publishedAt : undefined
            } as PublishDraft)
          : null;
      })
      .filter((entry): entry is PublishDraft => entry !== null);
  } catch {
    return session;
  }
};
export function usePublishHistory() {
  const [entries, setEntries] = useState(read);
  useEffect(() => {
    const refresh = (event: Event) => {
      const kind = (event as CustomEvent<{ type?: string }>).detail?.type;
      if (kind && kind !== 'publish') return;
      // Settings imports/clears take precedence over this session cache.
      session = [];
      setEntries(read());
    };
    window.addEventListener(EVENT, refresh);
    return () => window.removeEventListener(EVENT, refresh);
  }, []);
  const remember = (draft: PublishDraft) => {
    const next = [
      { ...draft, keyexpr: draft.keyexpr.trim(), publishedAt: Date.now() },
      ...entries.filter((entry) => entry.keyexpr !== draft.keyexpr.trim())
    ].slice(0, 8);
    session = next;
    setEntries(next);
    try {
      localStorage.setItem(KEYS, JSON.stringify(next.map((entry) => entry.keyexpr)));
      // Large snapshots stay in memory; avoid exhausting browser preference storage.
      localStorage.setItem(
        DETAILS,
        JSON.stringify(
          Object.fromEntries(
            next
              .filter((entry) => entry.payload.length <= 128 * 1024)
              .map((entry) => [entry.keyexpr, entry])
          )
        )
      );
    } catch {
      /* A successful send stays successful when preferences cannot be saved. */
    }
  };
  let targets = entries.map((entry) => entry.keyexpr);
  try {
    const stored = JSON.parse(localStorage.getItem(KEYS) ?? '[]');
    if (Array.isArray(stored))
      targets = [
        ...new Set([...targets, ...stored.filter((key): key is string => typeof key === 'string')])
      ].slice(0, 8);
  } catch {
    /* Session targets remain available. */
  }
  return { entries, targets, remember };
}
