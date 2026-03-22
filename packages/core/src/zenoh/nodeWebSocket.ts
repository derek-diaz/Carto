import WebSocket, { type ClientOptions, type RawData } from 'ws';

type CloseEvent = {
  code?: number;
  reason?: string;
};

type MessageEvent = {
  data: ArrayBuffer | Buffer | string;
};

type ErrorEvent = {
  error: Error;
};

type BinaryType = 'arraybuffer' | 'nodebuffer';

export type CartoWsOptions = ClientOptions & {
  headers?: Record<string, string>;
};

export const getGlobalWsOptions = (): CartoWsOptions | undefined =>
  (globalThis as { __cartoWsOptions?: CartoWsOptions }).__cartoWsOptions;

export const setGlobalWsOptions = (options?: CartoWsOptions | null): void => {
  const globalWithOptions = globalThis as { __cartoWsOptions?: CartoWsOptions };
  if (!options) {
    delete globalWithOptions.__cartoWsOptions;
    return;
  }
  globalWithOptions.__cartoWsOptions = options;
};

export class NodeWebSocket {
  static readonly CONNECTING = WebSocket.CONNECTING;
  static readonly OPEN = WebSocket.OPEN;
  static readonly CLOSING = WebSocket.CLOSING;
  static readonly CLOSED = WebSocket.CLOSED;

  onopen?: () => void;
  onmessage?: (event: MessageEvent) => void;
  onerror?: (event: ErrorEvent) => void;
  onclose?: (event: CloseEvent) => void;

  private readonly socket: WebSocket;

  constructor(url: string, protocols?: string | string[]) {
    const options = getGlobalWsOptions();
    this.socket = options ? new WebSocket(url, protocols, options) : new WebSocket(url, protocols);

    this.socket.binaryType = 'arraybuffer';
    this.socket.on('open', () => this.onopen?.());
    this.socket.on('message', (data, isBinary) => this.handleMessage(data, isBinary));
    this.socket.on('error', (error) =>
      this.onerror?.({ error: error instanceof Error ? error : new Error(String(error)) })
    );
    this.socket.on('close', (code, reason) => {
      const text = reason?.length ? reason.toString('utf8') : undefined;
      this.onclose?.({ code, reason: text });
    });
  }

  get readyState(): number {
    return this.socket.readyState;
  }

  get bufferedAmount(): number {
    return this.socket.bufferedAmount;
  }

  get binaryType(): BinaryType {
    return this.socket.binaryType as BinaryType;
  }

  set binaryType(value: BinaryType) {
    this.socket.binaryType = value;
  }

  send(data: string | ArrayBuffer | Uint8Array | Buffer): void {
    this.socket.send(data);
  }

  close(code = 1000, reason = ''): void {
    this.socket.close(code, reason);
  }

  private handleMessage(data: RawData, isBinary?: boolean): void {
    if (!isBinary) {
      const text = toBuffer(data).toString('utf8');
      this.onmessage?.({ data: text });
      return;
    }

    if (this.binaryType === 'arraybuffer') {
      this.onmessage?.({ data: toArrayBuffer(data) });
      return;
    }

    this.onmessage?.({ data: toBuffer(data) });
  }
}

const toBuffer = (data: RawData): Buffer => {
  if (Buffer.isBuffer(data)) return data;
  if (Array.isArray(data)) return Buffer.concat(data);
  if (ArrayBuffer.isView(data)) {
    return Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  }
  return Buffer.from(new Uint8Array(data as ArrayBufferLike));
};

const toArrayBuffer = (data: RawData): ArrayBuffer => {
  const buffer = toBuffer(data);
  const view = new Uint8Array(buffer.byteLength);
  view.set(buffer);
  return view.buffer;
};
