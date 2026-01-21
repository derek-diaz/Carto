import { randomUUID } from 'node:crypto';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';
import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import type { Capabilities } from '../../shared/types';
import type { ConnectOptions, DriverStatus, PublishOptions, SubscribeOptions, ZenohDriver } from './driver';

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
};

type TapMessage = {
  type: 'message';
  payload: {
    subscriptionId: string;
    key: string;
    payloadBase64: string;
    ts?: number;
  };
};

type TapStatus = {
  type: 'status';
  payload: DriverStatus;
};

type TapResponse = {
  id: string;
  ok: boolean;
  payload?: unknown;
  error?: string;
};

type TapEnvelope = TapMessage | TapStatus | TapResponse;

type TapCommand = {
  id: string;
  type: string;
  payload?: Record<string, unknown>;
};

export class ChildProcessDriver implements ZenohDriver {
  private child: ChildProcessWithoutNullStreams | null = null;
  private pending = new Map<string, PendingRequest>();
  private messageHandlers = new Map<string, (msg: { key: string; payload: Uint8Array; ts?: number }) => void>();
  private statusHandler?: (status: DriverStatus) => void;

  async connect(options: ConnectOptions): Promise<Capabilities> {
    this.statusHandler = options.onStatus;
    this.ensureProcess();
    const response = await this.sendRequest('connect', {
      endpoint: options.endpoint,
      configJson: options.configJson ?? null
    });
    return response as Capabilities;
  }

  async disconnect(): Promise<void> {
    if (!this.child) return;
    await this.sendRequest('disconnect');
    this.shutdownProcess();
  }

  async subscribe(options: SubscribeOptions): Promise<void> {
    this.messageHandlers.set(options.subscriptionId, options.onMessage);
    await this.sendRequest('subscribe', {
      subscriptionId: options.subscriptionId,
      keyexpr: options.keyexpr
    });
  }

  async unsubscribe(subscriptionId: string): Promise<void> {
    this.messageHandlers.delete(subscriptionId);
    await this.sendRequest('unsubscribe', { subscriptionId });
  }

  async pause(subscriptionId: string, paused: boolean): Promise<void> {
    await this.sendRequest('pause', { subscriptionId, paused });
  }

  async publish(options: PublishOptions): Promise<void> {
    await this.sendRequest('publish', {
      keyexpr: options.keyexpr,
      payloadBase64: Buffer.from(options.payload).toString('base64'),
      encoding: options.encoding ?? null
    });
  }

  private ensureProcess(): void {
    if (this.child) return;
    const { command, args } = this.resolveTapCommand();
    this.child = spawn(command, args, {
      stdio: ['pipe', 'pipe', 'pipe']
    });

    const rl = createInterface({ input: this.child.stdout });
    rl.on('line', (line) => this.handleLine(line));

    this.child.stderr.on('data', (data) => {
      const message = data.toString();
      this.statusHandler?.({ connected: false, error: message.trim() });
    });

    this.child.on('exit', (code) => {
      if (code && code !== 0) {
        this.statusHandler?.({ connected: false, error: `carto-tap exited with ${code}` });
      }
      this.child = null;
    });
  }

  private shutdownProcess(): void {
    if (!this.child) return;
    this.child.kill();
    this.child = null;
  }

  private handleLine(line: string): void {
    if (!line.trim()) return;
    let data: TapEnvelope;
    try {
      data = JSON.parse(line) as TapEnvelope;
    } catch {
      return;
    }

    if ('id' in data && typeof data.id === 'string') {
    const pending = this.pending.get(data.id);
    if (!pending) return;
    this.pending.delete(data.id);
    clearTimeout(pending.timeout);
    if (data.ok) {
      pending.resolve(data.payload);
    } else {
      pending.reject(new Error(data.error ?? 'carto-tap request failed'));
    }
      return;
    }

    if (data.type === 'message') {
      const handler = this.messageHandlers.get(data.payload.subscriptionId);
      if (!handler) return;
      handler({
        key: data.payload.key,
        payload: Buffer.from(data.payload.payloadBase64, 'base64'),
        ts: data.payload.ts
      });
      return;
    }

    if (data.type === 'status') {
      this.statusHandler?.(data.payload);
    }
  }

  private sendRequest(type: string, payload?: Record<string, unknown>): Promise<unknown> {
    if (!this.child?.stdin.writable) {
      return Promise.reject(new Error('carto-tap is not running'));
    }

    const id = randomUUID();
    const request: TapCommand = { id, type, payload };
    const line = JSON.stringify(request);
    this.child.stdin.write(`${line}\n`);

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        if (!this.pending.has(id)) return;
        this.pending.delete(id);
        reject(new Error(`carto-tap request timed out (${type})`));
      }, 5000);
      this.pending.set(id, { resolve, reject, timeout });
    });
  }

  private resolveTapCommand(): { command: string; args: string[] } {
    if (process.env.CARTO_TAP_PATH) {
      return { command: process.execPath, args: [process.env.CARTO_TAP_PATH] };
    }

    const bundledTap = path.join(__dirname, 'carto-tap.js');
    if (fs.existsSync(bundledTap)) {
      return { command: process.execPath, args: [bundledTap] };
    }

    const appPath = app.getAppPath();
    const devTapJs = path.join(appPath, 'src', 'main', 'zenoh', 'carto-tap.js');
    if (fs.existsSync(devTapJs)) {
      return { command: process.execPath, args: [devTapJs] };
    }

    const devTap = path.join(appPath, 'src', 'main', 'zenoh', 'carto-tap.ts');
    const tsxCandidates = [
      path.join(appPath, 'node_modules', 'tsx', 'dist', 'cli.cjs'),
      path.join(appPath, 'node_modules', 'tsx', 'dist', 'cli.mjs'),
      path.join(appPath, 'node_modules', 'tsx', 'dist', 'cli.js')
    ];
    const tsxPath = tsxCandidates.find((candidate) => fs.existsSync(candidate));
    if (tsxPath && fs.existsSync(devTap)) {
      return { command: process.execPath, args: [tsxPath, devTap] };
    }

    throw new Error(
      'carto-tap entry not found. Set CARTO_TAP_PATH or run npm run build to generate out/main/carto-tap.js.'
    );
  }
}
