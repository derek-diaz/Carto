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

export class RemoteApiWsDriver implements ZenohDriver {
  private session: ZenohSession | null = null;
  private subscriptions = new Map<string, SubscriptionHandle>();

  async connect(options: ConnectOptions): Promise<Capabilities> {
    await this.ensureWebSocket();
    const module = await this.loadZenohModule();
    const open = module.open ?? module.default?.open;
    if (!open) {
      throw new Error(
        'Unable to find open() in @eclipse-zenoh/zenoh-ts. Check the installed version.'
      );
    }

    const config = this.buildConfig(options.endpoint, options.configJson);
    try {
      this.session = await open(config);
    } catch (error) {
      const details = error instanceof Error ? error.message : String(error);
      const hint = this.buildConnectionHint(details);
      throw new Error(
        `Failed to connect to ${options.endpoint}. Ensure zenoh-plugin-remote-api is enabled and the WS endpoint is reachable. Details: ${details}${
          hint ? ` Hint: ${hint}` : ''
        }`
      );
    }

    const info = await this.tryInfo(this.session);
    return this.buildCapabilities(info);
  }

  async disconnect(): Promise<void> {
    await this.closeAllSubscriptions();
    if (this.session?.close) {
      await this.session.close();
    }
    this.session = null;
  }

  async subscribe(options: SubscribeOptions): Promise<void> {
    if (!this.session) {
      throw new Error('Not connected to Zenoh.');
    }

    const handler = (sample: unknown): void => {
      const key = this.extractKey(sample, options.keyexpr);
      const payload = this.extractPayload(sample);
      const ts = this.extractTimestamp(sample);
      options.onMessage({ key, payload, ts });
    };

    const session = this.session;
    const subscription =
      (await session.declareSubscriber?.(options.keyexpr, { handler })) ??
      (await session.subscribe?.(options.keyexpr, handler)) ??
      (await session.createSubscriber?.(options.keyexpr, handler));

    if (!subscription) {
      throw new Error('Zenoh session does not support subscriptions.');
    }

    this.subscriptions.set(options.subscriptionId, {
      close: () => this.closeSubscription(subscription)
    });
  }

  async unsubscribe(subscriptionId: string): Promise<void> {
    const handle = this.subscriptions.get(subscriptionId);
    if (!handle) return;
    await handle.close();
    this.subscriptions.delete(subscriptionId);
  }

  async publish(options: PublishOptions): Promise<void> {
    if (!this.session) {
      throw new Error('Not connected to Zenoh.');
    }

    const putOptions = options.encoding ? { encoding: options.encoding } : undefined;
    if (this.session.put) {
      await this.session.put(options.keyexpr, options.payload, putOptions);
      return;
    }

    const publisher =
      (await this.session.declarePublisher?.(options.keyexpr)) ??
      (await (this.session as unknown as { createPublisher?: (keyexpr: string) => Promise<unknown> })
        .createPublisher?.(options.keyexpr));
    if (!publisher || typeof (publisher as { put?: unknown }).put !== 'function') {
      throw new Error('Zenoh session does not support publishing.');
    }

    await (publisher as { put: (payload: Uint8Array, opts?: { encoding?: string }) => Promise<void> }).put(
      options.payload,
      putOptions
    );
    await this.closePublisher(publisher);
  }

  private async loadZenohModule(): Promise<ZenohModule> {
    try {
      const modulePath = '@eclipse-zenoh/zenoh-ts';
      return (await import(/* @vite-ignore */ modulePath)) as ZenohModule;
    } catch (error) {
      const details = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Unable to import @eclipse-zenoh/zenoh-ts. Ensure the dependency is installed. Details: ${details}`
      );
    }
  }

  private buildConnectionHint(details: string): string | null {
    if (details.includes('Invalid Key Expr') || details.includes('HTTP/1.1 200 OK')) {
      return 'The endpoint responded like a normal HTTP service (often the REST plugin), not the remote-api WebSocket. Check your router config for the remote-api plugin port and use that WS endpoint.';
    }
    return null;
  }

  private async ensureWebSocket(): Promise<void> {
    if (typeof (globalThis as { WebSocket?: unknown }).WebSocket === 'function') {
      return;
    }
    const globalWithWebSocket = globalThis as unknown as { WebSocket?: typeof NodeWebSocket };
    globalWithWebSocket.WebSocket = NodeWebSocket;
  }

  private buildConfig(endpoint: string, configJson?: string): Record<string, unknown> {
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
      typeof nextConfig.messageResponseTimeoutMs === 'number' && Number.isFinite(nextConfig.messageResponseTimeoutMs)
        ? nextConfig.messageResponseTimeoutMs
        : 5000;

    return {
      ...nextConfig,
      locator,
      messageResponseTimeoutMs
    };
  }

  private buildCapabilities(info: unknown): Capabilities {
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

      let zenohVersion =
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
  }

  private async tryInfo(session: ZenohSession): Promise<unknown> {
    try {
      if (session.info) {
        return await session.info();
      }
      if (session.getInfo) {
        return await session.getInfo();
      }
      return undefined;
    } catch {
      return undefined;
    }
  }

  private extractKey(sample: unknown, fallback: string): string {
    if (!sample || typeof sample !== 'object') return fallback;
    const record = sample as Record<string, unknown>;
    const key = this.resolveCandidate(sample, record.keyexpr ?? record.key);
    return this.asKeyString(key) ?? fallback;
  }

  private extractPayload(sample: unknown): Uint8Array {
    if (!sample || typeof sample !== 'object') return new Uint8Array();
    const record = sample as Record<string, unknown>;
    const payload = this.resolveCandidate(
      sample,
      record.payload ?? record.value ?? record.data ?? record.bytes ?? record.payload_
    );
    return toUint8Array(payload);
  }

  private extractTimestamp(sample: unknown): number | undefined {
    if (!sample || typeof sample !== 'object') return undefined;
    const record = sample as Record<string, unknown>;
    const ts = this.resolveCandidate(sample, record.ts ?? record.timestamp);
    return this.parseTimestamp(ts);
  }

  private parseTimestamp(value: unknown): number | undefined {
    if (typeof value === 'number') return value;
    if (typeof value === 'string') {
      const parsed = Date.parse(value);
      return Number.isNaN(parsed) ? undefined : parsed;
    }
    if (value && typeof value === 'object') {
      const record = value as Record<string, unknown>;
      const ms = this.callNumberMethod(record, 'getMsSinceUnixEpoch');
      if (ms !== undefined) return ms;
      return this.callDateMethod(record, 'asDate');
    }
    return undefined;
  }

  private callNumberMethod(record: Record<string, unknown>, key: string): number | undefined {
    const method = record[key];
    if (typeof method !== 'function') return undefined;
    const value = (method as () => number).call(record);
    return Number.isFinite(value) ? value : undefined;
  }

  private callDateMethod(record: Record<string, unknown>, key: string): number | undefined {
    const method = record[key];
    if (typeof method !== 'function') return undefined;
    const value = (method as () => Date).call(record);
    if (!(value instanceof Date)) return undefined;
    const ms = value.getTime();
    return Number.isFinite(ms) ? ms : undefined;
  }

  private resolveCandidate(sample: unknown, candidate: unknown): unknown {
    if (typeof candidate === 'function') {
      try {
        return (candidate as () => unknown).call(sample);
      } catch {
        return undefined;
      }
    }
    return candidate;
  }

  private asKeyString(value: unknown): string | null {
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
  }

  private async closeAllSubscriptions(): Promise<void> {
    const handles = [...this.subscriptions.values()];
    this.subscriptions.clear();
    await Promise.all(handles.map((handle) => handle.close()));
  }

  private async closeSubscription(subscription: unknown): Promise<void> {
    const record = subscription as Record<string, unknown>;
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
  }

  private async closePublisher(publisher: unknown): Promise<void> {
    const record = publisher as Record<string, unknown>;
    if (typeof record.undeclare === 'function') {
      await (record.undeclare as () => Promise<void>)();
      return;
    }
    if (typeof record.close === 'function') {
      await (record.close as () => Promise<void>)();
    }
  }
}

const textEncoder = new TextEncoder();

function toUint8Array(payload: unknown): Uint8Array {
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
}
