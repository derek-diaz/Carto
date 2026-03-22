import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Worker } from 'node:worker_threads';
import type {
  AuthConfig,
  Capabilities,
  CartoMessageBatchEvent,
  CartoMessage,
  ConnectionHealth,
  ConnectionStatus,
  ConnectionTestParams,
  ConnectionTestResult,
  ConnectParams,
  PublishEncoding,
  PublishParams,
  RecentKeyStats,
  ReconnectConfig,
  TlsConfig
} from '../shared/types';
import { getKeyexprError } from '../shared/keyexpr';
import { createRingBuffer, type RingBuffer } from './ringBuffer';
import { createRecentKeysIndex, type RecentKeysIndex } from './recentKeys';
import type { CartoEventSink } from './eventSink';
import type { DriverMessage, ZenohDriver } from '../zenoh/driver';
import { createRemoteApiWsDriver } from '../zenoh/remoteApiWsDriver';
import {
  getGlobalWsOptions,
  setGlobalWsOptions,
  type CartoWsOptions
} from '../zenoh/nodeWebSocket';

const DEFAULT_BUFFER_SIZE = 200;
const DEFAULT_HEALTH_INTERVAL_MS = 5000;
const DEFAULT_RECONNECT_BASE_DELAY_MS = 1000;
const DEFAULT_RECONNECT_MAX_DELAY_MS = 15000;
const DEFAULT_TEST_TIMEOUT_MS = 6000;
const MAX_PAYLOAD_PREVIEW_BYTES = 1024;
const MAX_BASE64_PREVIEW_BYTES = 384;
const MAX_PREVIEW_TEXT_CHARS = 140;
const MAX_SEARCH_TEXT_CHARS = 256;
const RENDERER_FLUSH_INTERVAL_MS = 16;
const MAX_RENDER_QUEUE_MESSAGES_PER_SUB = 64;
const DETAIL_DECODE_TIMEOUT_MS = 5000;
const MAX_DETAIL_CACHE_MESSAGES_PER_SUB = 256;
const MAX_DETAIL_CACHE_BYTES_PER_SUB = 192 * 1024 * 1024;

const AUTO_RECONNECT_DEFAULT: ReconnectConfig = {
  enabled: true,
  baseDelayMs: DEFAULT_RECONNECT_BASE_DELAY_MS,
  maxDelayMs: DEFAULT_RECONNECT_MAX_DELAY_MS,
  jitter: true
};

const DETAIL_DECODE_WORKER_SOURCE = `
const { parentPort } = require('node:worker_threads');
const textDecoder = new TextDecoder();

const isMostlyPrintable = (value) => {
  if (value.length === 0) return true;
  let controlChars = 0;
  for (let i = 0; i < value.length; ) {
    const code = value.codePointAt(i);
    if (code === undefined) break;
    if (code < 32 && code !== 9 && code !== 10 && code !== 13) {
      controlChars += 1;
    }
    i += code > 0xffff ? 2 : 1;
  }
  return controlChars / value.length < 0.1;
};

const decodeDetail = (payload) => {
  if (payload.byteLength === 0) {
    return { encoding: 'binary', base64: '' };
  }
  let text;
  try {
    text = textDecoder.decode(payload);
  } catch {
    text = undefined;
  }

  if (!text) {
    return { encoding: 'binary', base64: Buffer.from(payload).toString('base64') };
  }

  const trimmed = text.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      return { encoding: 'json', json: JSON.parse(trimmed) };
    } catch {}
  }

  if (isMostlyPrintable(text)) {
    return { encoding: 'text', text };
  }
  return { encoding: 'binary', base64: Buffer.from(payload).toString('base64') };
};

parentPort.on('message', (message) => {
  const { requestId, payload } = message || {};
  try {
    const bytes = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);
    const result = decodeDetail(bytes);
    parentPort.postMessage({ requestId, result });
  } catch (error) {
    parentPort.postMessage({ requestId, error: error instanceof Error ? error.message : String(error) });
  }
});
`;

const getErrorMessage = (error: unknown): string => {
  if (error instanceof Error) return error.message;
  if (error === undefined || error === null) return 'Unknown error.';
  if (typeof error === 'string') return error;
  if (typeof error === 'number' || typeof error === 'boolean' || typeof error === 'bigint') {
    return String(error);
  }
  if (typeof error === 'symbol') return error.description ?? error.toString();
  if (typeof error === 'object') {
    try {
      const json = JSON.stringify(error);
      if (json && json !== '{}' && json !== '[]') {
        return json;
      }
    } catch {
      // fall through to tag
    }
    return Object.prototype.toString.call(error);
  }
  return Object.prototype.toString.call(error);
};

type SubscriptionState = {
  id: string;
  keyexpr: string;
  paused: boolean;
  bufferSize: number;
  buffer: RingBuffer<CartoMessage>;
  recentKeys: RecentKeysIndex;
  detailPayloads: Map<string, Uint8Array>;
  detailOrder: string[];
  detailBytes: number;
};

export type CartoBackend = {
  setEventSink: (eventSink: CartoEventSink | null) => void;
  getStatus: () => ConnectionStatus;
  connect: (params: ConnectParams) => Promise<void>;
  testConnection: (params: ConnectionTestParams) => Promise<ConnectionTestResult>;
  disconnect: () => Promise<void>;
  subscribe: (keyexpr: string, bufferSize?: number) => Promise<string>;
  unsubscribe: (subscriptionId: string) => Promise<void>;
  pause: (subscriptionId: string, paused: boolean) => Promise<void>;
  clearBuffer: (subscriptionId: string) => Promise<void>;
  getMessage: (subscriptionId: string, messageId: string) => Promise<CartoMessage | null>;
  publish: (params: PublishParams) => Promise<void>;
  getRecentKeys: (filter?: string, subscriptionId?: string) => RecentKeyStats[];
};

export const createCartoBackend = (): CartoBackend => {
  let driver: ZenohDriver | null = null;
  let eventSink: CartoEventSink | null = null;
  const subscriptions = new Map<string, SubscriptionState>();
  const recentKeys = createRecentKeysIndex();
  let capabilities: Capabilities | null = null;
  let connectParams: ConnectParams | null = null;
  let reconnectConfig: ReconnectConfig = { ...AUTO_RECONNECT_DEFAULT };
  let healthIntervalMs = DEFAULT_HEALTH_INTERVAL_MS;
  let reconnectAttempt = 0;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let healthTimer: ReturnType<typeof setInterval> | null = null;
  let lastTrafficAt = 0;
  let rendererFlushTimer: ReturnType<typeof setTimeout> | null = null;
  let rendererQueue = new Map<string, CartoMessage[]>();
  let detailDecodeWorker: Worker | null = null;
  let detailDecodeRequestId = 0;
  const detailDecodePending = new Map<
    number,
    {
      resolve: (value: DecodedPayloadDetail) => void;
      reject: (error: unknown) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  let connectToken = 0;
  let explicitDisconnect = false;
  let status: ConnectionStatus = {
    connected: false,
    health: { state: 'disconnected' }
  };

  const clearDetailDecodeWorker = (): void => {
    if (detailDecodeWorker) {
      detailDecodeWorker.removeAllListeners();
      void detailDecodeWorker.terminate().catch(() => {});
      detailDecodeWorker = null;
    }
    for (const pending of detailDecodePending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error('Detail decode worker was reset.'));
    }
    detailDecodePending.clear();
  };

  const ensureDetailDecodeWorker = (): Worker => {
    if (detailDecodeWorker) return detailDecodeWorker;
    const worker = new Worker(DETAIL_DECODE_WORKER_SOURCE, { eval: true });
    worker.on('message', (message: unknown) => {
      const payload = message as {
        requestId?: number;
        result?: DecodedPayloadDetail;
        error?: string;
      };
      const requestId = payload.requestId;
      if (typeof requestId !== 'number') return;
      const pending = detailDecodePending.get(requestId);
      if (!pending) return;
      detailDecodePending.delete(requestId);
      clearTimeout(pending.timer);
      if (payload.error) {
        pending.reject(new Error(payload.error));
        return;
      }
      pending.resolve(payload.result ?? { encoding: 'binary', base64: '' });
    });
    worker.on('error', () => {
      clearDetailDecodeWorker();
    });
    worker.on('exit', () => {
      clearDetailDecodeWorker();
    });
    detailDecodeWorker = worker;
    return worker;
  };

  const decodePayloadDetailInWorker = (payload: Uint8Array): Promise<DecodedPayloadDetail> => {
    return new Promise((resolve, reject) => {
      let worker: Worker;
      try {
        worker = ensureDetailDecodeWorker();
      } catch (error) {
        reject(error);
        return;
      }
      detailDecodeRequestId += 1;
      const requestId = detailDecodeRequestId;
      const timer = setTimeout(() => {
        const pending = detailDecodePending.get(requestId);
        if (!pending) return;
        detailDecodePending.delete(requestId);
        pending.reject(new Error('Detail decode timed out.'));
      }, DETAIL_DECODE_TIMEOUT_MS);
      detailDecodePending.set(requestId, { resolve, reject, timer });
      worker.postMessage({
        requestId,
        payload: Buffer.from(payload)
      });
    });
  };

  const clearRendererQueue = (): void => {
    rendererQueue.clear();
    if (rendererFlushTimer) {
      clearTimeout(rendererFlushTimer);
      rendererFlushTimer = null;
    }
  };

  const flushRendererQueue = (): void => {
    rendererFlushTimer = null;
    if (rendererQueue.size === 0) return;

    const queued = rendererQueue;
    rendererQueue = new Map<string, CartoMessage[]>();

    for (const [subscriptionId, msgs] of queued.entries()) {
      if (msgs.length === 0) continue;
      const payload: CartoMessageBatchEvent = { subscriptionId, msgs };
      eventSink?.sendMessage(payload);
    }
  };

  const scheduleRendererFlush = (): void => {
    if (rendererFlushTimer) return;
    rendererFlushTimer = setTimeout(flushRendererQueue, RENDERER_FLUSH_INTERVAL_MS);
  };

  const enqueueRendererMessage = (
    subscriptionId: string,
    message: CartoMessage,
    bufferSize: number
  ): void => {
    const current = rendererQueue.get(subscriptionId) ?? [];
    current.push(message);
    const cap = Math.max(1, Math.min(bufferSize, MAX_RENDER_QUEUE_MESSAGES_PER_SUB));
    if (current.length > cap) {
      current.splice(0, current.length - cap);
    }
    rendererQueue.set(subscriptionId, current);
    scheduleRendererFlush();
  };

  const emitStatus = (): void => {
    eventSink?.sendStatus(status);
  };

  const updateHealth = (partial: Partial<ConnectionHealth>): void => {
    const baseHealth: ConnectionHealth =
      status.health ?? (status.connected ? { state: 'connected' } : { state: 'disconnected' });
    status = { ...status, health: { ...baseHealth, ...partial } };
    emitStatus();
  };

  const setConnectionState = (
    connected: boolean,
    healthPatch: Partial<ConnectionHealth>,
    statusPatch: Partial<ConnectionStatus> = {}
  ): void => {
    const baseHealth: ConnectionHealth =
      status.health ?? (connected ? { state: 'connected' } : { state: 'disconnected' });
    status = {
      ...status,
      ...statusPatch,
      connected,
      health: { ...baseHealth, ...healthPatch }
    };
    emitStatus();
  };

  const logDriverError = (action: string, error: unknown): void => {
    const message = getErrorMessage(error);
    console.warn(`[carto] ${action} failed: ${message}`);
  };

  const getErrorHint = (error: unknown): string | undefined => {
    const hint = (error as { hint?: unknown } | null | undefined)?.hint;
    if (typeof hint === 'string' && hint.trim()) return hint;
    const message = getErrorMessage(error);
    const hintIndex = message.indexOf('Hint:');
    if (hintIndex >= 0) {
      return message.slice(hintIndex + 5).trim();
    }
    return undefined;
  };

  const cacheDetailPayload = (
    state: SubscriptionState,
    messageId: string,
    payload: Uint8Array
  ): void => {
    if (payload.byteLength > MAX_DETAIL_CACHE_BYTES_PER_SUB) {
      return;
    }
    const copy = Uint8Array.from(payload);
    state.detailPayloads.set(messageId, copy);
    state.detailOrder.push(messageId);
    state.detailBytes += copy.byteLength;
    const messageCap = Math.max(1, Math.min(state.bufferSize, MAX_DETAIL_CACHE_MESSAGES_PER_SUB));

    while (
      state.detailOrder.length > messageCap ||
      state.detailBytes > MAX_DETAIL_CACHE_BYTES_PER_SUB
    ) {
      const evictedId = state.detailOrder.shift();
      if (!evictedId) break;
      const evictedPayload = state.detailPayloads.get(evictedId);
      if (!evictedPayload) continue;
      state.detailPayloads.delete(evictedId);
      state.detailBytes = Math.max(0, state.detailBytes - evictedPayload.byteLength);
    }
  };

  const handleMessage = (subscriptionId: string, msg: DriverMessage): void => {
    const state = subscriptions.get(subscriptionId);
    if (!state) return;
    lastTrafficAt = Date.now();

    const decoded = decodePayload(msg.payload);
    const ts = msg.ts ?? Date.now();
    const id = randomUUID();
    const cartoMsg: CartoMessage = {
      id,
      ts,
      key: msg.key,
      encoding: decoded.encoding,
      sizeBytes: msg.payload.byteLength,
      previewBytes: decoded.previewBytes,
      payloadTruncated: decoded.payloadTruncated || undefined,
      previewText: decoded.previewText,
      searchText: decoded.searchText
    };

    state.buffer.push(cartoMsg);
    cacheDetailPayload(state, id, msg.payload);
    state.recentKeys.update(cartoMsg.key, cartoMsg.sizeBytes, cartoMsg.ts);
    recentKeys.update(cartoMsg.key, cartoMsg.sizeBytes, cartoMsg.ts);

    if (!state.paused) {
      enqueueRendererMessage(subscriptionId, cartoMsg, state.bufferSize);
    }
  };

  const setEventSink = (nextEventSink: CartoEventSink | null): void => {
    clearRendererQueue();
    eventSink = nextEventSink;
    emitStatus();
  };

  const nextConnectToken = (): number => {
    connectToken += 1;
    return connectToken;
  };

  const isActiveToken = (token: number): boolean => token === connectToken && !explicitDisconnect;

  const clearReconnectTimer = (): void => {
    if (!reconnectTimer) return;
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  };

  const clearHealthTimer = (): void => {
    if (!healthTimer) return;
    clearInterval(healthTimer);
    healthTimer = null;
  };

  const normalizeReconnectConfig = (config?: ReconnectConfig): ReconnectConfig => {
    if (!config) return { ...AUTO_RECONNECT_DEFAULT };
    if (!config.enabled) return { enabled: false };

    const baseDelayMs =
      typeof config.baseDelayMs === 'number' && Number.isFinite(config.baseDelayMs)
        ? Math.max(250, config.baseDelayMs)
        : DEFAULT_RECONNECT_BASE_DELAY_MS;
    const maxDelayMs =
      typeof config.maxDelayMs === 'number' && Number.isFinite(config.maxDelayMs)
        ? Math.max(baseDelayMs, config.maxDelayMs)
        : DEFAULT_RECONNECT_MAX_DELAY_MS;
    const maxAttempts =
      typeof config.maxAttempts === 'number' && config.maxAttempts > 0
        ? Math.floor(config.maxAttempts)
        : undefined;
    const jitter = config.jitter ?? true;

    return {
      enabled: true,
      baseDelayMs,
      maxDelayMs,
      maxAttempts,
      jitter
    };
  };

  const normalizeHealthInterval = (value?: number): number => {
    if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_HEALTH_INTERVAL_MS;
    if (value <= 0) return 0;
    return value;
  };

  const computeBackoffDelay = (retryCount: number): number => {
    const baseDelay = reconnectConfig.baseDelayMs ?? DEFAULT_RECONNECT_BASE_DELAY_MS;
    const maxDelay = reconnectConfig.maxDelayMs ?? DEFAULT_RECONNECT_MAX_DELAY_MS;
    const exponent = Math.max(0, retryCount - 1);
    let delay = Math.min(maxDelay, baseDelay * 2 ** exponent);
    if (reconnectConfig.jitter) {
      const jitterFactor = 0.7 + Math.random() * 0.6;
      delay = Math.round(delay * jitterFactor);
    }
    return delay;
  };

  const readFileIfSet = async (path?: string): Promise<Buffer | undefined> => {
    const trimmed = path?.trim();
    if (!trimmed) return undefined;
    return readFile(trimmed);
  };

  const buildAuthHeaders = (auth?: AuthConfig): Record<string, string> => {
    if (!auth || auth.type === 'none') return {};
    if (auth.type === 'basic') {
      const username = auth.username ?? '';
      const password = auth.password ?? '';
      if (!username && !password) return {};
      const token = Buffer.from(`${username}:${password}`, 'utf8').toString('base64');
      return { Authorization: `Basic ${token}` };
    }
    if (auth.type === 'bearer') {
      const token = auth.token?.trim();
      if (!token) return {};
      return { Authorization: `Bearer ${token}` };
    }
    if (auth.type === 'header') {
      const headerName = auth.headerName?.trim();
      if (!headerName) return {};
      return { [headerName]: auth.headerValue ?? '' };
    }
    return {};
  };

  const buildTlsOptions = async (tls?: TlsConfig): Promise<CartoWsOptions> => {
    if (!tls) return {};
    const [ca, cert, key] = await Promise.all([
      readFileIfSet(tls.caPath),
      readFileIfSet(tls.certPath),
      readFileIfSet(tls.keyPath)
    ]);
    const options: CartoWsOptions = {};
    if (ca) options.ca = ca;
    if (cert) options.cert = cert;
    if (key) options.key = key;
    if (typeof tls.rejectUnauthorized === 'boolean') {
      options.rejectUnauthorized = tls.rejectUnauthorized;
    }
    return options;
  };

  const applyWsOptions = async (auth?: AuthConfig, tls?: TlsConfig): Promise<void> => {
    const headers = buildAuthHeaders(auth);
    const tlsOptions = await buildTlsOptions(tls);
    const options: CartoWsOptions = { ...tlsOptions };
    if (Object.keys(headers).length > 0) {
      options.headers = headers;
    }
    if (Object.keys(options).length === 0) {
      setGlobalWsOptions(null);
      return;
    }
    setGlobalWsOptions(options);
  };

  const disconnectDriver = async (clearCaps: boolean): Promise<void> => {
    const activeDriver = driver;
    driver = null;
    if (clearCaps) {
      capabilities = null;
    }
    if (!activeDriver) return;
    try {
      await activeDriver.disconnect();
    } catch (error) {
      logDriverError('disconnect', error);
    }
  };

  const startHealthCheck = (): void => {
    clearHealthTimer();
    if (!driver || healthIntervalMs <= 0 || !driver.healthCheck) return;
    healthTimer = setInterval(async () => {
      if (!driver || !driver.healthCheck) return;
      try {
        const now = Date.now();
        const hasRecentTraffic =
          subscriptions.size > 0 && lastTrafficAt > 0 && now - lastTrafficAt < healthIntervalMs;
        if (hasRecentTraffic) {
          updateHealth({ lastHeartbeatAt: now });
          return;
        }
        await driver.healthCheck();
        updateHealth({ lastHeartbeatAt: now });
      } catch (error) {
        await handleConnectionLoss(error);
      }
    }, healthIntervalMs);
  };

  const attachSubscription = async (state: SubscriptionState): Promise<void> => {
    if (!driver) {
      throw new Error('Not connected to Zenoh.');
    }

    await driver.subscribe({
      subscriptionId: state.id,
      keyexpr: state.keyexpr,
      onMessage: (msg) => handleMessage(state.id, msg)
    });

    if (state.paused && driver.pause) {
      await driver.pause(state.id, true);
    }
  };

  const resubscribeAll = async (): Promise<void> => {
    if (!driver || subscriptions.size === 0) return;
    const states = [...subscriptions.values()];
    const results = await Promise.allSettled(states.map((state) => attachSubscription(state)));
    results.forEach((result) => {
      if (result.status === 'rejected') {
        logDriverError('resubscribe', result.reason);
      }
    });
  };

  const scheduleReconnect = (reason: string): void => {
    clearReconnectTimer();
    clearHealthTimer();

    const now = Date.now();
    const nextAttempt = reconnectAttempt + 1;
    const maxAttempts = reconnectConfig.maxAttempts;
    if (!reconnectConfig.enabled || explicitDisconnect) {
      setConnectionState(false, {
        state: 'disconnected',
        lastError: reason,
        lastDisconnectedAt: now,
        attempt: undefined,
        nextRetryMs: undefined
      }, {
        error: reason
      });
      return;
    }

    if (maxAttempts && nextAttempt > maxAttempts) {
      setConnectionState(false, {
        state: 'disconnected',
        lastError: reason,
        lastDisconnectedAt: now,
        attempt: undefined,
        nextRetryMs: undefined
      }, {
        error: `${reason} (max reconnect attempts reached)`
      });
      return;
    }

    const delay = computeBackoffDelay(reconnectAttempt || 1);
    setConnectionState(false, {
      state: 'reconnecting',
      attempt: nextAttempt,
      nextRetryMs: delay,
      lastError: reason,
      lastDisconnectedAt: now
    }, {
      error: reason
    });

    reconnectTimer = setTimeout(() => {
      startConnectionAttempt('reconnecting').catch((error) => {
        logDriverError('reconnect', error);
      });
    }, delay);
  };

  const handleConnectionLoss = async (error: unknown): Promise<void> => {
    if (explicitDisconnect) return;
    const state = status.health?.state;
    if (state === 'connecting' || state === 'reconnecting') return;
    const message = getErrorMessage(error);
    await disconnectDriver(false);
    scheduleReconnect(message);
  };

  const startConnectionAttempt = async (state: 'connecting' | 'reconnecting'): Promise<void> => {
    if (!connectParams) {
      throw new Error('Connection parameters are missing.');
    }

    const token = nextConnectToken();
    reconnectAttempt = reconnectAttempt + 1;
    const attemptNumber = reconnectAttempt;

    setConnectionState(false, {
      state,
      attempt: attemptNumber,
      nextRetryMs: undefined,
      lastError: undefined
    }, {
      error: undefined,
      capabilities: capabilities ?? undefined
    });

    const driverInstance = createRemoteApiWsDriver();

    try {
      const caps = await driverInstance.connect({
        endpoint: connectParams.endpoint,
        configJson: connectParams.configJson
      });

      if (!isActiveToken(token)) {
        await driverInstance.disconnect();
        return;
      }

      driver = driverInstance;
      capabilities = caps;
      reconnectAttempt = 0;
      const connectedAt = Date.now();
      lastTrafficAt = connectedAt;

      setConnectionState(
        true,
        {
          state: 'connected',
          attempt: undefined,
          nextRetryMs: undefined,
          lastError: undefined,
          lastConnectedAt: connectedAt
        },
        {
          error: undefined,
          capabilities: caps
        }
      );

      startHealthCheck();
      await resubscribeAll();
    } catch (error) {
      try {
        await driverInstance.disconnect();
      } catch (disconnectError) {
        logDriverError('disconnect', disconnectError);
      }

      if (!isActiveToken(token)) return;
      scheduleReconnect(getErrorMessage(error));
    }
  };

  const testConnection = async (params: ConnectionTestParams): Promise<ConnectionTestResult> => {
    const startedAt = Date.now();
    const previousOptions = getGlobalWsOptions();
    const driverInstance = createRemoteApiWsDriver();
    const timeoutMs =
      typeof params.timeoutMs === 'number' && Number.isFinite(params.timeoutMs)
        ? params.timeoutMs
        : DEFAULT_TEST_TIMEOUT_MS;

    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await applyWsOptions(params.auth, params.tls);

      const connectPromise = driverInstance.connect({
        endpoint: params.endpoint,
        configJson: params.configJson
      });
      const timeoutPromise = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          reject(new Error(`Connection timed out after ${Math.round(timeoutMs / 1000)}s.`));
        }, timeoutMs);
      });

      const caps = await Promise.race([connectPromise, timeoutPromise]);
      return {
        ok: true,
        durationMs: Date.now() - startedAt,
        capabilities: caps
      };
    } catch (error) {
      return {
        ok: false,
        durationMs: Date.now() - startedAt,
        error: getErrorMessage(error),
        hint: getErrorHint(error)
      };
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
      try {
        await driverInstance.disconnect();
      } catch (error) {
        logDriverError('disconnect', error);
      }
      setGlobalWsOptions(previousOptions ?? null);
    }
  };

  const disconnect = async (): Promise<void> => {
    explicitDisconnect = true;
    clearReconnectTimer();
    clearHealthTimer();
    clearRendererQueue();
    clearDetailDecodeWorker();
    nextConnectToken();

    await disconnectDriver(true);
    setGlobalWsOptions(null);
    connectParams = null;
    reconnectAttempt = 0;

    subscriptions.clear();
    recentKeys.clear();

    setConnectionState(false, {
      state: 'disconnected',
      attempt: undefined,
      nextRetryMs: undefined,
      lastError: undefined,
      lastDisconnectedAt: Date.now()
    }, {
      error: undefined,
      capabilities: undefined
    });
  };

  const connect = async (params: ConnectParams): Promise<void> => {
    explicitDisconnect = false;
    connectParams = params;
    reconnectConfig = normalizeReconnectConfig(params.reconnect);
    healthIntervalMs = normalizeHealthInterval(params.healthCheckIntervalMs);
    reconnectAttempt = 0;
    lastTrafficAt = 0;

    clearReconnectTimer();
    clearHealthTimer();
    clearRendererQueue();
    clearDetailDecodeWorker();
    nextConnectToken();

    await disconnectDriver(true);
    subscriptions.clear();
    recentKeys.clear();

    await applyWsOptions(params.auth, params.tls);
    await startConnectionAttempt('connecting');
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
      recentKeys: createRecentKeysIndex(),
      detailPayloads: new Map<string, Uint8Array>(),
      detailOrder: [],
      detailBytes: 0
    };
    subscriptions.set(subscriptionId, state);

    try {
      await attachSubscription(state);
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
      const state = subscriptions.get(subscriptionId);
      if (state) {
        state.detailPayloads.clear();
        state.detailOrder = [];
        state.detailBytes = 0;
      }
      subscriptions.delete(subscriptionId);
      rendererQueue.delete(subscriptionId);
    }
  };

  const pause = async (subscriptionId: string, paused: boolean): Promise<void> => {
    const state = subscriptions.get(subscriptionId);
    if (!state) return;
    state.paused = paused;
    await driver?.pause?.(subscriptionId, paused);
  };

  const clearBuffer = async (subscriptionId: string): Promise<void> => {
    const state = subscriptions.get(subscriptionId);
    if (!state) return;
    state.buffer.clear();
    state.detailPayloads.clear();
    state.detailOrder = [];
    state.detailBytes = 0;
    rendererQueue.delete(subscriptionId);
  };

  const getMessage = async (
    subscriptionId: string,
    messageId: string
  ): Promise<CartoMessage | null> => {
    const state = subscriptions.get(subscriptionId);
    if (!state) return null;
    const summary = state.buffer.toArray().find((entry) => entry.id === messageId);
    if (!summary) return null;
    const payload = state.detailPayloads.get(messageId);
    if (!payload) {
      return {
        ...summary,
        encoding: 'text',
        text: 'Full payload is no longer cached for this row. Increase buffer or select newer rows.'
      };
    }

    let detail: DecodedPayloadDetail;
    try {
      detail = await decodePayloadDetailInWorker(payload);
    } catch {
      detail = decodePayloadDetail(payload);
    }

    return {
      ...summary,
      encoding: detail.encoding,
      payloadTruncated: false,
      previewBytes: summary.sizeBytes,
      json: detail.json,
      text: detail.text,
      base64: detail.base64
    };
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
    setEventSink,
    getStatus: () => status,
    connect,
    testConnection,
    disconnect,
    subscribe,
    unsubscribe,
    pause,
    clearBuffer,
    getMessage,
    publish,
    getRecentKeys
  };
};

type DecodedPayload = {
  encoding: 'json' | 'text' | 'binary';
  previewBytes: number;
  payloadTruncated: boolean;
  previewText: string;
  searchText: string;
};

type DecodedPayloadDetail = {
  encoding: 'json' | 'text' | 'binary';
  json?: unknown;
  text?: string;
  base64?: string;
};

const textDecoder = new TextDecoder();
const textEncoder = new TextEncoder();
const toBase64 = (bytes: Uint8Array): string => Buffer.from(bytes).toString('base64');
const clampText = (value: string, maxChars: number): string =>
  value.length > maxChars ? value.slice(0, maxChars) : value;
const buildPreviewText = (value: string, truncated: boolean): string => {
  if (!value) return truncated ? '...' : '';
  if (value.length > MAX_PREVIEW_TEXT_CHARS) {
    return `${value.slice(0, MAX_PREVIEW_TEXT_CHARS)}...`;
  }
  return truncated ? `${value}...` : value;
};

const decodePayload = (payload: Uint8Array): DecodedPayload => {
  if (payload.byteLength === 0) {
    return {
      encoding: 'binary',
      previewBytes: 0,
      payloadTruncated: false,
      previewText: '[binary]',
      searchText: '[binary]'
    };
  }

  const preview =
    payload.byteLength > MAX_PAYLOAD_PREVIEW_BYTES
      ? payload.subarray(0, MAX_PAYLOAD_PREVIEW_BYTES)
      : payload;
  const previewBytes = preview.byteLength;
  const payloadTruncated = previewBytes < payload.byteLength;

  let text: string | undefined;
  try {
    text = textDecoder.decode(preview);
  } catch {
    text = undefined;
  }

  if (!text) {
    const binaryPreviewBytes = preview.subarray(0, Math.min(preview.byteLength, MAX_BASE64_PREVIEW_BYTES));
    const base64 = toBase64(binaryPreviewBytes);
    const base64Text = `base64:${base64}`;
    return {
      encoding: 'binary',
      previewBytes,
      payloadTruncated,
      previewText: buildPreviewText(base64Text, payloadTruncated),
      searchText: clampText(base64Text, MAX_SEARCH_TEXT_CHARS)
    };
  }

  const trimmed = text.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    const compactJson = clampText(trimmed, MAX_SEARCH_TEXT_CHARS);
    return {
      encoding: 'json',
      previewBytes,
      payloadTruncated,
      previewText: buildPreviewText(compactJson, payloadTruncated),
      searchText: compactJson
    };
  }

  if (isMostlyPrintable(text)) {
    const content = clampText(text, MAX_SEARCH_TEXT_CHARS);
    return {
      encoding: 'text',
      previewBytes,
      payloadTruncated,
      previewText: buildPreviewText(content, payloadTruncated),
      searchText: content
    };
  }

  const binaryPreviewBytes = preview.subarray(0, Math.min(preview.byteLength, MAX_BASE64_PREVIEW_BYTES));
  const base64 = toBase64(binaryPreviewBytes);
  const base64Text = `base64:${base64}`;
  return {
    encoding: 'binary',
    previewBytes,
    payloadTruncated,
    previewText: buildPreviewText(base64Text, payloadTruncated),
    searchText: clampText(base64Text, MAX_SEARCH_TEXT_CHARS)
  };
};

const decodePayloadDetail = (payload: Uint8Array): DecodedPayloadDetail => {
  if (payload.byteLength === 0) {
    return { encoding: 'binary', base64: '' };
  }

  let text: string | undefined;
  try {
    text = textDecoder.decode(payload);
  } catch {
    text = undefined;
  }

  if (!text) {
    return { encoding: 'binary', base64: toBase64(payload) };
  }

  const trimmed = text.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const json = JSON.parse(trimmed) as unknown;
      return { encoding: 'json', json };
    } catch {
      // fall through to text detection
    }
  }

  if (isMostlyPrintable(text)) {
    return { encoding: 'text', text };
  }

  return { encoding: 'binary', base64: toBase64(payload) };
};

const isMostlyPrintable = (value: string): boolean => {
  if (value.length === 0) return true;
  let controlChars = 0;
  for (let i = 0; i < value.length; ) {
    const code = value.codePointAt(i);
    if (code === undefined) break;
    if (code < 32 && code !== 9 && code !== 10 && code !== 13) {
      controlChars += 1;
    }
    i += code > 0xffff ? 2 : 1;
  }
  return controlChars / value.length < 0.1;
};

const encodePublishPayload = (
  raw: string,
  encoding: PublishEncoding
): { bytes: Uint8Array; encodingHint?: string } => {
  if (encoding === 'json') {
    try {
      const parsed = JSON.parse(raw);
      const normalized = JSON.stringify(parsed);
      return { bytes: textEncoder.encode(normalized), encodingHint: 'application/json' };
    } catch (error) {
      const details = getErrorMessage(error);
      throw new Error(`Invalid JSON payload. ${details}`);
    }
  }

  if (encoding === 'base64') {
    const trimmed = raw.trim();
    if (!trimmed) {
      return { bytes: new Uint8Array(), encodingHint: 'application/octet-stream' };
    }
    const normalized = trimmed.replaceAll(/\s+/g, '');
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
  const message = getErrorMessage(error);
  return REMOTE_API_TIMEOUT_RE.test(message);
};
