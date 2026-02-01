import type { WebContents } from 'electron';
import { randomUUID } from 'node:crypto';
import type {
  CartoMessage,
  Capabilities,
  ConnectionStatus,
  ConnectParams,
  PublishEncoding,
  PublishParams,
  RecentKeyStats
} from '../../shared/types';
import { getKeyexprError } from '../../shared/keyexpr';
import { createRingBuffer, type RingBuffer } from './ringBuffer';
import { createRecentKeysIndex, type RecentKeysIndex } from './recentKeys';
import type { DriverMessage, ZenohDriver } from '../zenoh/driver';
import { createRemoteApiWsDriver } from '../zenoh/remoteApiWsDriver';

const DEFAULT_BUFFER_SIZE = 200;

type SubscriptionState = {
  id: string;
  keyexpr: string;
  paused: boolean;
  bufferSize: number;
  buffer: RingBuffer<CartoMessage>;
  recentKeys: RecentKeysIndex;
};

export type CartoBackend = {
  setWebContents: (webContents: WebContents) => void;
  connect: (params: ConnectParams) => Promise<void>;
  disconnect: () => Promise<void>;
  subscribe: (keyexpr: string, bufferSize?: number) => Promise<string>;
  unsubscribe: (subscriptionId: string) => Promise<void>;
  pause: (subscriptionId: string, paused: boolean) => Promise<void>;
  clearBuffer: (subscriptionId: string) => Promise<void>;
  publish: (params: PublishParams) => Promise<void>;
  getRecentKeys: (filter?: string, subscriptionId?: string) => RecentKeyStats[];
};

export const createCartoBackend = (): CartoBackend => {
  let driver: ZenohDriver | null = null;
  let webContents: WebContents | null = null;
  const subscriptions = new Map<string, SubscriptionState>();
  const recentKeys = createRecentKeysIndex();
  let capabilities: Capabilities | null = null;

  const emitStatus = (status: ConnectionStatus): void => {
    webContents?.send('carto.status', status);
  };

  const logDriverError = (action: string, error: unknown): void => {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[carto] ${action} failed: ${message}`);
  };

  const handleMessage = (subscriptionId: string, msg: DriverMessage): void => {
    const state = subscriptions.get(subscriptionId);
    if (!state) return;

    const decoded = decodePayload(msg.payload);
    const ts = msg.ts ?? Date.now();
    const cartoMsg: CartoMessage = {
      id: randomUUID(),
      ts,
      key: msg.key,
      encoding: decoded.encoding,
      sizeBytes: msg.payload.byteLength,
      json: decoded.json,
      text: decoded.text,
      base64: decoded.base64
    };

    state.buffer.push(cartoMsg);
    state.recentKeys.update(cartoMsg.key, cartoMsg.sizeBytes, cartoMsg.ts);
    recentKeys.update(cartoMsg.key, cartoMsg.sizeBytes, cartoMsg.ts);

    if (!state.paused) {
      webContents?.send('carto.message', { subscriptionId, msg: cartoMsg });
    }
  };

  const setWebContents = (contents: WebContents): void => {
    webContents = contents;
  };

  const disconnect = async (): Promise<void> => {
    for (const subscriptionId of subscriptions.keys()) {
      try {
        await unsubscribe(subscriptionId);
      } catch (error) {
        logDriverError('unsubscribe', error);
      }
    }

    if (driver) {
      try {
        await driver.disconnect();
      } catch (error) {
        logDriverError('disconnect', error);
      }
    }

    driver = null;
    capabilities = null;
    recentKeys.clear();
    emitStatus({ connected: false });
  };

  const connect = async (params: ConnectParams): Promise<void> => {
    await disconnect();

    const driverInstance: ZenohDriver = createRemoteApiWsDriver();
    let capabilitiesResult: Capabilities | null = null;
    const { endpoint, configJson } = params;

    try {
      capabilitiesResult = await driverInstance.connect({
        endpoint,
        configJson,
        onStatus: (status) => emitStatus(status)
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      emitStatus({ connected: false, error: message });
      throw error;
    }

    driver = driverInstance;
    capabilities = capabilitiesResult;
    emitStatus({
      connected: true,
      capabilities: capabilities ?? undefined
    });
  };

  const subscribe = async (keyexpr: string, bufferSize?: number): Promise<string> => {
    if (!driver) {
      throw new Error('Not connected to Zenoh.');
    }

    const trimmedKeyexpr = keyexpr.trim();
    const keyexprError = getKeyexprError(trimmedKeyexpr);
    if (keyexprError) {
      throw new Error(keyexprError);
    }

    const subscriptionId = randomUUID();
    const size = bufferSize ?? DEFAULT_BUFFER_SIZE;
    const state: SubscriptionState = {
      id: subscriptionId,
      keyexpr: trimmedKeyexpr,
      paused: false,
      bufferSize: size,
      buffer: createRingBuffer<CartoMessage>(size),
      recentKeys: createRecentKeysIndex()
    };
    subscriptions.set(subscriptionId, state);

    try {
      await driver.subscribe({
        subscriptionId,
        keyexpr: trimmedKeyexpr,
        onMessage: (msg) => handleMessage(subscriptionId, msg)
      });
    } catch (error) {
      subscriptions.delete(subscriptionId);
      throw error;
    }

    return subscriptionId;
  };

  const unsubscribe = async (subscriptionId: string): Promise<void> => {
    if (!subscriptions.has(subscriptionId)) return;
    try {
      if (driver) {
        await driver.unsubscribe(subscriptionId);
      }
    } catch (error) {
      if (!isRemoteApiTimeout(error)) {
        throw error;
      }
      logDriverError('unsubscribe', error);
    } finally {
      subscriptions.delete(subscriptionId);
    }
  };

  const pause = async (subscriptionId: string, paused: boolean): Promise<void> => {
    const state = subscriptions.get(subscriptionId);
    if (!state) return;
    state.paused = paused;
    if (driver?.pause) {
      await driver.pause(subscriptionId, paused);
    }
  };

  const clearBuffer = async (subscriptionId: string): Promise<void> => {
    const state = subscriptions.get(subscriptionId);
    if (!state) return;
    state.buffer.clear();
  };

  const publish = async (params: PublishParams): Promise<void> => {
    if (!driver) {
      throw new Error('Not connected to Zenoh.');
    }

    const trimmedKeyexpr = params.keyexpr.trim();
    const keyexprError = getKeyexprError(trimmedKeyexpr);
    if (keyexprError) {
      throw new Error(keyexprError);
    }

    const { payload, encoding } = params;
    const { bytes, encodingHint } = encodePublishPayload(payload, encoding);
    await driver.publish({ keyexpr: trimmedKeyexpr, payload: bytes, encoding: encodingHint });
  };

  const getRecentKeys = (filter?: string, subscriptionId?: string): RecentKeyStats[] => {
    if (subscriptionId) {
      const state = subscriptions.get(subscriptionId);
      if (!state) return [];
      return state.recentKeys.list(filter);
    }
    return recentKeys.list(filter);
  };

  return {
    setWebContents,
    connect,
    disconnect,
    subscribe,
    unsubscribe,
    pause,
    clearBuffer,
    publish,
    getRecentKeys
  };
};

type DecodedPayload = {
  encoding: 'json' | 'text' | 'binary';
  json?: unknown;
  text?: string;
  base64?: string;
};

const textDecoder = new TextDecoder();
const textEncoder = new TextEncoder();

const decodePayload = (payload: Uint8Array): DecodedPayload => {
  if (payload.byteLength === 0) {
    return { encoding: 'binary', base64: '' };
  }

  let text: string | undefined;
  try {
    text = textDecoder.decode(payload);
  } catch {
    text = undefined;
  }

  const base64 = Buffer.from(payload).toString('base64');
  if (!text) {
    return { encoding: 'binary', base64 };
  }

  const trimmed = text.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const json = JSON.parse(trimmed) as unknown;
      return { encoding: 'json', json, base64 };
    } catch {
      // fall through to text detection
    }
  }

  if (isMostlyPrintable(text)) {
    return { encoding: 'text', text, base64 };
  }

  return { encoding: 'binary', base64 };
};

const isMostlyPrintable = (value: string): boolean => {
  let controlChars = 0;
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code < 32 && code !== 9 && code !== 10 && code !== 13) {
      controlChars += 1;
    }
  }
  return controlChars / value.length < 0.1;
};

const encodePublishPayload = (
  raw: string,
  encoding: PublishEncoding
): { bytes: Uint8Array; encodingHint?: string } => {
  if (encoding === 'json') {
    let normalized = raw;
    try {
      const parsed = JSON.parse(raw);
      normalized = JSON.stringify(parsed);
    } catch (error) {
      const details = error instanceof Error ? error.message : String(error);
      throw new Error(`Invalid JSON payload. ${details}`);
    }
    return { bytes: textEncoder.encode(normalized), encodingHint: 'application/json' };
  }

  if (encoding === 'base64') {
    const trimmed = raw.trim();
    if (!trimmed) {
      return { bytes: new Uint8Array(), encodingHint: 'application/octet-stream' };
    }
    const normalized = trimmed.replace(/\s+/g, '');
    if (normalized.length % 4 !== 0 || /[^A-Za-z0-9+/=]/.test(normalized)) {
      throw new Error('Invalid base64 payload.');
    }
    const buffer = Buffer.from(normalized, 'base64');
    return { bytes: new Uint8Array(buffer), encodingHint: 'application/octet-stream' };
  }

  return { bytes: textEncoder.encode(raw), encodingHint: 'text/plain' };
};

const REMOTE_API_TIMEOUT_RE = /remote api request timeout/i;

const isRemoteApiTimeout = (error: unknown): boolean => {
  if (!error) return false;
  const message = error instanceof Error ? error.message : String(error);
  return REMOTE_API_TIMEOUT_RE.test(message);
};
