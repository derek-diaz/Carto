import type { WebContents } from 'electron';
import type { CartoMessageBatchEvent, ConnectionStatus } from '../../../../packages/core/src/shared/types';
import type { CartoEventSink } from '../../../../packages/core/src/backend/eventSink';

const DISPOSED_FRAME_RE = /render frame was disposed|object has been destroyed/i;
const MAX_SERIALIZE_DEPTH = 8;

const toIpcValue = (value: unknown, seen = new WeakSet<object>(), depth = 0): unknown => {
  if (value === null) return null;
  if (value === undefined) return undefined;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return Number.isNaN(value) ? null : value;
  }
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'function' || typeof value === 'symbol') return undefined;
  if (value instanceof Date) return value.toISOString();
  if (depth >= MAX_SERIALIZE_DEPTH) return String(value);

  if (Array.isArray(value)) {
    return value.map((entry) => toIpcValue(entry, seen, depth + 1) ?? null);
  }

  if (typeof value !== 'object') return String(value);
  if (seen.has(value)) return '[Circular]';
  seen.add(value);

  if (value instanceof Map) {
    return Object.fromEntries(
      [...value.entries()].map(([key, entry]) => [
        String(key),
        toIpcValue(entry, seen, depth + 1)
      ])
    );
  }

  if (value instanceof Set) {
    return [...value.values()].map((entry) => toIpcValue(entry, seen, depth + 1) ?? null);
  }

  const next: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    const serialized = toIpcValue(entry, seen, depth + 1);
    if (serialized !== undefined) {
      next[key] = serialized;
    }
  }
  return next;
};

const toIpcStatus = (status: ConnectionStatus): ConnectionStatus => {
  const capabilities = status.capabilities
    ? {
        ...status.capabilities,
        info: status.capabilities.info
          ? (toIpcValue(status.capabilities.info) as Record<string, unknown>)
          : undefined
      }
    : undefined;

  return {
    connected: status.connected,
    error: status.error,
    health: status.health ? { ...status.health } : undefined,
    capabilities
  };
};

const canSendToRenderer = (contents: WebContents): boolean => {
  try {
    if (contents.isDestroyed() || contents.isCrashed()) return false;
    const frame = contents.mainFrame;
    return Boolean(frame) && !frame.isDestroyed();
  } catch {
    return false;
  }
};

const send = (contents: WebContents, channel: string, payload: unknown): void => {
  if (!canSendToRenderer(contents)) return;
  try {
    contents.send(channel, payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (DISPOSED_FRAME_RE.test(message)) {
      return;
    }
    console.error(`[carto] failed to send ${channel}: ${message}`);
  }
};

export const createElectronEventSink = (contents: WebContents): CartoEventSink => ({
  sendMessage: (payload: CartoMessageBatchEvent) => {
    send(contents, 'carto.message', payload);
  },
  sendStatus: (status: ConnectionStatus) => {
    send(contents, 'carto.status', toIpcStatus(status));
  }
});
