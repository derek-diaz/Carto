import { randomUUID } from 'node:crypto';
import type { DiscoveryParams, DiscoverySnapshot, DiscoveredKey } from '../shared/types';
import { getKeyexprError } from '../shared/keyexpr';
import type { ZenohDriver } from '../zenoh/driver';

const MAX_KEYS = 1000;
const PREVIEW_BYTES = 512;
const empty = (): DiscoverySnapshot => ({
  state: 'idle',
  keyexpr: '**',
  durationSeconds: 15,
  received: 0,
  bytes: 0,
  limit: MAX_KEYS,
  omitted: 0,
  keys: []
});

// Discovery has its own bounded index and never retains full payloads or emits stream batches.
export const createDiscovery = (onStopFailure: (error: unknown) => Promise<void>) => {
  let snapshot = empty();
  let keys = new Map<string, DiscoveredKey>();
  let active: { driver: ZenohDriver; id: string } | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const cancel = () => {
    clearTimeout(timer);
    timer = undefined;
    active = null;
    if (['starting', 'running', 'stopping'].includes(snapshot.state))
      snapshot = { ...snapshot, state: 'complete', endedAt: Date.now(), reason: 'disconnected' };
  };
  const get = (): DiscoverySnapshot => ({
    ...snapshot,
    keys: [...keys.values()].map((key) => ({ ...key }))
  });
  const stop = async (reason: 'timeout' | 'stopped' = 'stopped') => {
    const current = active;
    if (!current || snapshot.state === 'stopping') return get();
    clearTimeout(timer);
    snapshot = { ...snapshot, state: 'stopping', endedAt: Date.now(), reason };
    try {
      await current.driver.unsubscribe(current.id);
      if (active === current) {
        active = null;
        snapshot = { ...snapshot, state: 'complete' };
      }
    } catch (error) {
      if (active === current) {
        active = null;
        snapshot = {
          ...snapshot,
          state: 'error',
          error: 'Discovery could not stop cleanly. The connection is being reset.'
        };
        await onStopFailure(error);
      }
    }
    return get();
  };
  const start = async (driver: ZenohDriver, params: DiscoveryParams) => {
    if (active)
      throw new Error('Discovery is already running. Stop it before starting another scan.');
    const expression = typeof params.keyexpr === 'string' ? params.keyexpr.trim() : '';
    const error = getKeyexprError(expression);
    if (error) throw new Error(error);
    if (![15, 30, 60].includes(params.durationSeconds))
      throw new Error('Choose a discovery duration of 15, 30, or 60 seconds.');
    const current = { driver, id: `discovery-${randomUUID()}` };
    active = current;
    keys = new Map();
    snapshot = {
      ...empty(),
      state: 'starting',
      keyexpr: expression,
      durationSeconds: params.durationSeconds,
      startedAt: Date.now()
    };
    try {
      await driver.subscribe({
        subscriptionId: current.id,
        keyexpr: expression,
        onMessage: (message) => {
          if (active !== current || !['starting', 'running'].includes(snapshot.state)) return;
          snapshot.received += 1;
          snapshot.bytes += message.payload.byteLength;
          const previous = keys.get(message.key);
          if (!previous && (keys.size >= MAX_KEYS || message.key.length > 4096)) {
            snapshot.omitted += 1;
            return;
          }
          const bytes = message.payload.subarray(0, PREVIEW_BYTES);
          let preview: string;
          try {
            preview = new TextDecoder('utf-8', { fatal: true }).decode(bytes, {
              stream: bytes.length < message.payload.length
            });
            if (/[\u0000-\u0008\u000e-\u001f]/u.test(preview)) throw new Error('binary');
          } catch {
            preview = `Base64 · ${Buffer.from(bytes).toString('base64')}`;
          }
          keys.set(message.key, {
            key: message.key,
            count: (previous?.count ?? 0) + 1,
            bytes: (previous?.bytes ?? 0) + message.payload.byteLength,
            lastSeen: Date.now(),
            lastSize: message.payload.byteLength,
            preview: message.kind === 'delete' ? 'Key deleted' : preview,
            previewBase64:
              message.kind === 'delete' ? undefined : Buffer.from(bytes).toString('base64'),
            previewTruncated: bytes.length < message.payload.length,
            wireEncoding: message.wireEncoding?.slice(0, 256),
            kind: message.kind
          });
        }
      });
      if (active !== current || snapshot.state !== 'starting') {
        await driver.unsubscribe(current.id);
        return get();
      }
      snapshot.state = 'running';
      snapshot.startedAt = Date.now();
      timer = setTimeout(() => {
        void stop('timeout');
      }, params.durationSeconds * 1000);
    } catch (error) {
      if (active === current) {
        active = null;
        snapshot = {
          ...snapshot,
          state: 'error',
          endedAt: Date.now(),
          error: error instanceof Error ? error.message : String(error)
        };
      }
      throw error;
    }
    return get();
  };
  return {
    start,
    stop,
    get,
    cancel,
    reset: () => {
      cancel();
      keys.clear();
      snapshot = empty();
    }
  };
};
