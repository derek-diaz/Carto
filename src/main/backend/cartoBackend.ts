import type { WebContents } from 'electron';
import { randomUUID } from 'crypto';
import type {
  CartoMessage,
  Capabilities,
  ConnectionStatus,
  ConnectParams,
  PublishEncoding,
  PublishParams,
  RecentKeyStats
} from '../../shared/types';
import { RingBuffer } from './ringBuffer';
import { RecentKeysIndex } from './recentKeys';
import type { DriverMessage, ZenohDriver } from '../zenoh/driver';
import { RemoteApiWsDriver } from '../zenoh/remoteApiWsDriver';

const DEFAULT_BUFFER_SIZE = 200;

type SubscriptionState = {
  id: string;
  keyexpr: string;
  paused: boolean;
  bufferSize: number;
  buffer: RingBuffer<CartoMessage>;
};

export class CartoBackend {
  private driver: ZenohDriver | null = null;
  private webContents: WebContents | null = null;
  private subscriptions = new Map<string, SubscriptionState>();
  private recentKeys = new RecentKeysIndex();
  private capabilities: Capabilities | null = null;

  setWebContents(webContents: WebContents): void {
    this.webContents = webContents;
  }

  async connect(params: ConnectParams): Promise<void> {
    await this.disconnect();

    const driver: ZenohDriver = new RemoteApiWsDriver();
    let capabilities: Capabilities | null = null;
    const { endpoint, configJson } = params;

    try {
      capabilities = await driver.connect({
        endpoint,
        configJson,
        onStatus: (status) => this.emitStatus(status)
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.emitStatus({ connected: false, error: message });
      throw error;
    }

    this.driver = driver;
    this.capabilities = capabilities;

    this.emitStatus({
      connected: true,
      capabilities: this.capabilities ?? undefined
    });
  }

  async disconnect(): Promise<void> {
    for (const subscriptionId of [...this.subscriptions.keys()]) {
      await this.unsubscribe(subscriptionId);
    }

    if (this.driver) {
      await this.driver.disconnect();
    }

    this.driver = null;
    this.capabilities = null;
    this.recentKeys.clear();
    this.emitStatus({ connected: false });
  }

  async subscribe(keyexpr: string, bufferSize?: number): Promise<string> {
    if (!this.driver) {
      throw new Error('Not connected to Zenoh.');
    }

    const subscriptionId = randomUUID();
    const size = bufferSize ?? DEFAULT_BUFFER_SIZE;
    const state: SubscriptionState = {
      id: subscriptionId,
      keyexpr,
      paused: false,
      bufferSize: size,
      buffer: new RingBuffer<CartoMessage>(size)
    };
    this.subscriptions.set(subscriptionId, state);

    try {
      await this.driver.subscribe({
        subscriptionId,
        keyexpr,
        onMessage: (msg) => this.handleMessage(subscriptionId, msg)
      });
    } catch (error) {
      this.subscriptions.delete(subscriptionId);
      throw error;
    }

    return subscriptionId;
  }

  async unsubscribe(subscriptionId: string): Promise<void> {
    if (this.driver) {
      await this.driver.unsubscribe(subscriptionId);
    }
    this.subscriptions.delete(subscriptionId);
  }

  async pause(subscriptionId: string, paused: boolean): Promise<void> {
    const state = this.subscriptions.get(subscriptionId);
    if (!state) return;
    state.paused = paused;
    if (this.driver?.pause) {
      await this.driver.pause(subscriptionId, paused);
    }
  }

  async clearBuffer(subscriptionId: string): Promise<void> {
    const state = this.subscriptions.get(subscriptionId);
    if (!state) return;
    state.buffer.clear();
  }

  async publish(params: PublishParams): Promise<void> {
    if (!this.driver) {
      throw new Error('Not connected to Zenoh.');
    }

    const { keyexpr, payload, encoding } = params;
    const { bytes, encodingHint } = encodePublishPayload(payload, encoding);
    await this.driver.publish({ keyexpr, payload: bytes, encoding: encodingHint });
  }

  getRecentKeys(filter?: string): RecentKeyStats[] {
    return this.recentKeys.list(filter);
  }

  private handleMessage(subscriptionId: string, msg: DriverMessage): void {
    const state = this.subscriptions.get(subscriptionId);
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
    this.recentKeys.update(cartoMsg.key, cartoMsg.sizeBytes, cartoMsg.ts);

    if (!state.paused) {
      this.webContents?.send('carto.message', { subscriptionId, msg: cartoMsg });
    }
  }

  private emitStatus(status: ConnectionStatus): void {
    this.webContents?.send('carto.status', status);
  }
}

type DecodedPayload = {
  encoding: 'json' | 'text' | 'binary';
  json?: unknown;
  text?: string;
  base64?: string;
};

const textDecoder = new TextDecoder();
const textEncoder = new TextEncoder();

function decodePayload(payload: Uint8Array): DecodedPayload {
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
}

function isMostlyPrintable(value: string): boolean {
  let controlChars = 0;
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code < 32 && code !== 9 && code !== 10 && code !== 13) {
      controlChars += 1;
    }
  }
  return controlChars / value.length < 0.1;
}

function encodePublishPayload(
  raw: string,
  encoding: PublishEncoding
): { bytes: Uint8Array; encodingHint?: string } {
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
}
