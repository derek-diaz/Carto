import type { Capabilities } from '../../shared/types';
import type { ConnectOptions, PublishOptions, SubscribeOptions, ZenohDriver } from './driver';
import { NodeWebSocket } from './nodeWebSocket';

type SubscriptionHandle = {
  close: () => Promise<void>;
};

type ZenohSession = {
  close?: () => Promise<void> | void;
  info?: () => Promise<unknown> | unknown;
  getInfo?: () => Promise<unknown> | unknown;
  declareSubscriber?: (keyexpr: string, handler: { handler: (sample: unknown) => void }) => Promise<unknown>;
  subscribe?: (keyexpr: string, handler: (sample: unknown) => void) => Promise<unknown>;
  createSubscriber?: (keyexpr: string, handler: (sample: unknown) => void) => Promise<unknown>;
  put?: (keyexpr: string, payload: Uint8Array, options?: { encoding?: string }) => Promise<void>;
  declarePublisher?: (keyexpr: string) => Promise<unknown>;
};

type ZenohModule = {
  open?: (config: Record<string, unknown>) => Promise<ZenohSession>;
  default?: {
    open?: (config: Record<string, unknown>) => Promise<ZenohSession>;
  };
};

export const createRemoteApiWsDriver = (): ZenohDriver => {
  let session: ZenohSession | null = null;
  const subscriptions = new Map<string, SubscriptionHandle>();

  const loadZenohModule = async (): Promise<ZenohModule> => {
    try {
      const modulePath = '@eclipse-zenoh/zenoh-ts';
      return (await import(/* @vite-ignore */ modulePath)) as ZenohModule;
    } catch (error) {
      const details = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Unable to import @eclipse-zenoh/zenoh-ts. Ensure the dependency is installed. Details: ${details}`
      );
    }
  };

  const buildConnectionHint = (details: string): string | null => {
    if (details.includes('Invalid Key Expr') || details.includes('HTTP/1.1 200 OK')) {
      return 'The endpoint responded like a normal HTTP service (often the REST plugin), not the remote-api WebSocket. Check your router config for the remote-api plugin port and use that WS endpoint.';
    }
    return null;
  };

  const ensureWebSocket = async (): Promise<void> => {
    if (typeof (globalThis as { WebSocket?: unknown }).WebSocket === 'function') {
      return;
    }
    const globalWithWebSocket = globalThis as unknown as { WebSocket?: typeof NodeWebSocket };
    globalWithWebSocket.WebSocket = NodeWebSocket;
  };

  const buildConfig = (endpoint: string, configJson?: string): Record<string, unknown> => {
    let config: Record<string, unknown> = {};
    if (configJson?.trim()) {
      try {
        const parsed = JSON.parse(configJson);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          config = parsed as Record<string, unknown>;
        } else {
          throw new Error('Config JSON must be an object.');
        }
      } catch (error) {
        const details = error instanceof Error ? error.message : String(error);
        throw new Error(`Invalid config JSON. ${details}`);
      }
    }

    const nextConfig: Record<string, unknown> = { ...config };
    const locator = typeof nextConfig.locator === 'string' ? nextConfig.locator : endpoint;
    const messageResponseTimeoutMs =
      typeof nextConfig.messageResponseTimeoutMs === 'number' &&
      Number.isFinite(nextConfig.messageResponseTimeoutMs)
        ? nextConfig.messageResponseTimeoutMs
        : 5000;

    return {
      ...nextConfig,
      locator,
      messageResponseTimeoutMs
    };
  };

  const buildCapabilities = (info: unknown): Capabilities => {
    const capabilities: Capabilities = {
      driver: 'remote-api-ws',
      features: ['subscribe', 'recent-keys', 'pause', 'publish']
    };

    if (info && typeof info === 'object') {
      const record = info as Record<string, unknown>;
      const asString = (value: unknown): string | undefined => {
        if (typeof value === 'string' && value.trim()) return value;
        if (typeof value === 'number' && Number.isFinite(value)) return String(value);
        return undefined;
      };
      const fromRecord = (keys: string[]): string | undefined => {
        for (const key of keys) {
          const value = asString(record[key]);
          if (value) return value;
        }
        return undefined;
      };
      const nestedString = (parent: unknown, keys: string[]): string | undefined => {
        if (!parent || typeof parent !== 'object') return undefined;
        const nested = parent as Record<string, unknown>;
        for (const key of keys) {
          const value = asString(nested[key]);
          if (value) return value;
        }
        return undefined;
      };

      const zenohVersion =
        fromRecord(['zenoh_version', 'zenohVersion', 'zenoh-version']) ||
        nestedString(record.zenoh, ['version', 'build_version', 'buildVersion']) ||
        nestedString(record.zenoh_version, ['version']);
      let remoteApiVersion =
        fromRecord(['remote_api_version', 'remoteApiVersion', 'remote-api-version']) ||
        nestedString(record.remote_api, ['version', 'api_version']) ||
        nestedString(record.remoteApi, ['version', 'apiVersion']);
      const topLevelVersion = fromRecord(['version', 'api_version', 'apiVersion']);
      if (!remoteApiVersion && topLevelVersion && !zenohVersion) {
        remoteApiVersion = topLevelVersion;
      }

      if (zenohVersion) {
        capabilities.zenoh = zenohVersion;
      }
      if (remoteApiVersion) {
        capabilities.remoteApi = remoteApiVersion;
      }
      capabilities.info = record;
    }

    return capabilities;
  };

  const tryInfo = async (value: ZenohSession): Promise<unknown> => {
    try {
      if (value.info) {
        return await value.info();
      }
      if (value.getInfo) {
        return await value.getInfo();
      }
      return undefined;
    } catch {
      return undefined;
    }
  };

  const resolveCandidate = (sample: unknown, candidate: unknown): unknown => {
    if (typeof candidate === 'function') {
      try {
        return (candidate as () => unknown).call(sample);
      } catch {
        return undefined;
      }
    }
    return candidate;
  };

  const callNumberMethod = (record: Record<string, unknown>, key: string): number | undefined => {
    const method = record[key];
    if (typeof method !== 'function') return undefined;
    const value = (method as () => number).call(record);
    return Number.isFinite(value) ? value : undefined;
  };

  const callDateMethod = (record: Record<string, unknown>, key: string): number | undefined => {
    const method = record[key];
    if (typeof method !== 'function') return undefined;
    const value = (method as () => Date).call(record);
    if (!(value instanceof Date)) return undefined;
    const ms = value.getTime();
    return Number.isFinite(ms) ? ms : undefined;
  };

  const parseTimestamp = (value: unknown): number | undefined => {
    if (typeof value === 'number') return value;
    if (typeof value === 'string') {
      const parsed = Date.parse(value);
      return Number.isNaN(parsed) ? undefined : parsed;
    }
    if (value && typeof value === 'object') {
      const record = value as Record<string, unknown>;
      const ms = callNumberMethod(record, 'getMsSinceUnixEpoch');
      if (ms !== undefined) return ms;
      return callDateMethod(record, 'asDate');
    }
    return undefined;
  };

  const asKeyString = (value: unknown): string | null => {
    if (typeof value === 'string') return value;
    if (value && typeof value === 'object') {
      const record = value as Record<string, unknown>;
      if (typeof record.inner_ === 'string') {
        return record.inner_;
      }
      const toStringFn = record.toString;
      if (typeof toStringFn === 'function') {
        return String(toStringFn.call(value));
      }
    }
    return null;
  };

  const extractKey = (sample: unknown, fallback: string): string => {
    if (!sample || typeof sample !== 'object') return fallback;
    const record = sample as Record<string, unknown>;
    const key = resolveCandidate(sample, record.keyexpr ?? record.key);
    return asKeyString(key) ?? fallback;
  };

  const extractPayload = (sample: unknown): Uint8Array => {
    if (!sample || typeof sample !== 'object') return new Uint8Array();
    const record = sample as Record<string, unknown>;
    const payload = resolveCandidate(
      sample,
      record.payload ?? record.value ?? record.data ?? record.bytes ?? record.payload_
    );
    return toUint8Array(payload);
  };

  const extractTimestamp = (sample: unknown): number | undefined => {
    if (!sample || typeof sample !== 'object') return undefined;
    const record = sample as Record<string, unknown>;
    const ts = resolveCandidate(sample, record.ts ?? record.timestamp);
    return parseTimestamp(ts);
  };

  const closeSubscription = async (subscription: unknown): Promise<void> => {
    const record = subscription as Record<string, unknown>;
    try {
      if (typeof record.undeclare === 'function') {
        await (record.undeclare as () => Promise<void>)();
        return;
      }
      if (typeof record.close === 'function') {
        await (record.close as () => Promise<void>)();
        return;
      }
      if (typeof record.unsubscribe === 'function') {
        await (record.unsubscribe as () => Promise<void>)();
      }
    } catch (error) {
      if (isRemoteApiTimeout(error)) {
        return;
      }
      throw error;
    }
  };

  const closePublisher = async (publisher: unknown): Promise<void> => {
    const record = publisher as Record<string, unknown>;
    if (typeof record.undeclare === 'function') {
      await (record.undeclare as () => Promise<void>)();
      return;
    }
    if (typeof record.close === 'function') {
      await (record.close as () => Promise<void>)();
    }
  };

  const closeAllSubscriptions = async (): Promise<void> => {
    const handles = [...subscriptions.values()];
    subscriptions.clear();
    const results = await Promise.allSettled(handles.map((handle) => handle.close()));
    for (const result of results) {
      if (result.status === 'rejected' && !isRemoteApiTimeout(result.reason)) {
        throw result.reason;
      }
    }
  };

  const connect = async (options: ConnectOptions): Promise<Capabilities> => {
    await ensureWebSocket();
    const module = await loadZenohModule();
    const open = module.open ?? module.default?.open;
    if (!open) {
      throw new Error(
        'Unable to find open() in @eclipse-zenoh/zenoh-ts. Check the installed version.'
      );
    }

    const config = buildConfig(options.endpoint, options.configJson);
    try {
      session = await open(config);
    } catch (error) {
      const details = error instanceof Error ? error.message : String(error);
      const hint = buildConnectionHint(details);
      const connectionError = new Error(
        `Failed to connect to ${options.endpoint}. Ensure zenoh-plugin-remote-api is enabled and the WS endpoint is reachable. Details: ${details}${
          hint ? ` Hint: ${hint}` : ''
        }`
      ) as Error & { hint?: string; details?: string };
      connectionError.hint = hint ?? undefined;
      connectionError.details = details;
      throw connectionError;
    }

    const info = await tryInfo(session);
    return buildCapabilities(info);
  };

  const disconnect = async (): Promise<void> => {
    await closeAllSubscriptions();
    if (session?.close) {
      await session.close();
    }
    session = null;
  };

  const healthCheck = async (): Promise<void> => {
    if (!session) {
      throw new Error('Not connected to Zenoh.');
    }
    if (session.info) {
      await session.info();
      return;
    }
    if (session.getInfo) {
      await session.getInfo();
    }
  };

  const subscribe = async (options: SubscribeOptions): Promise<void> => {
    if (!session) {
      throw new Error('Not connected to Zenoh.');
    }

    const handler = (sample: unknown): void => {
      const key = extractKey(sample, options.keyexpr);
      const payload = extractPayload(sample);
      const ts = extractTimestamp(sample);
      options.onMessage({ key, payload, ts });
    };

    const subscription =
      (await session.declareSubscriber?.(options.keyexpr, { handler })) ??
      (await session.subscribe?.(options.keyexpr, handler)) ??
      (await session.createSubscriber?.(options.keyexpr, handler));

    if (!subscription) {
      throw new Error('Zenoh session does not support subscriptions.');
    }

    subscriptions.set(options.subscriptionId, {
      close: () => closeSubscription(subscription)
    });
  };

  const unsubscribe = async (subscriptionId: string): Promise<void> => {
    const handle = subscriptions.get(subscriptionId);
    if (!handle) return;
    try {
      await handle.close();
    } finally {
      subscriptions.delete(subscriptionId);
    }
  };

  const publish = async (options: PublishOptions): Promise<void> => {
    if (!session) {
      throw new Error('Not connected to Zenoh.');
    }

    const putOptions = options.encoding ? { encoding: options.encoding } : undefined;
    if (session.put) {
      await session.put(options.keyexpr, options.payload, putOptions);
      return;
    }

    const publisher =
      (await session.declarePublisher?.(options.keyexpr)) ??
      (await (session as unknown as { createPublisher?: (keyexpr: string) => Promise<unknown> })
        .createPublisher?.(options.keyexpr));
    if (!publisher || typeof (publisher as { put?: unknown }).put !== 'function') {
      throw new Error('Zenoh session does not support publishing.');
    }

    await (publisher as { put: (payload: Uint8Array, opts?: { encoding?: string }) => Promise<void> }).put(
      options.payload,
      putOptions
    );
    await closePublisher(publisher);
  };

  return {
    connect,
    disconnect,
    subscribe,
    unsubscribe,
    publish,
    healthCheck
  };
};

const textEncoder = new TextEncoder();

const toUint8Array = (payload: unknown): Uint8Array => {
  if (payload instanceof Uint8Array) {
    return payload;
  }
  if (payload instanceof ArrayBuffer) {
    return new Uint8Array(payload);
  }
  if (ArrayBuffer.isView(payload)) {
    return new Uint8Array(payload.buffer);
  }
  if (typeof payload === 'string') {
    return textEncoder.encode(payload);
  }
  if (payload && typeof payload === 'object') {
    const record = payload as Record<string, unknown>;
    const toBytes = record.toBytes as (() => Uint8Array) | undefined;
    if (toBytes) {
      try {
        return toBytes.call(payload);
      } catch {
        return new Uint8Array();
      }
    }
  }
  return new Uint8Array();
};

const REMOTE_API_TIMEOUT_RE = /remote api request timeout/i;

const isRemoteApiTimeout = (error: unknown): boolean => {
  if (!error) return false;
  const message = error instanceof Error ? error.message : String(error);
  return REMOTE_API_TIMEOUT_RE.test(message);
};
