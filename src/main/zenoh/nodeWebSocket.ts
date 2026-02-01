import net from 'node:net';
import tls from 'node:tls';
import { createHash, randomBytes } from 'node:crypto';

const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const DEFAULT_PROTOCOLS = ['zenoh'];

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

export class NodeWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  readonly url: string;
  readyState = NodeWebSocket.CONNECTING;
  binaryType: 'arraybuffer' | 'nodebuffer' = 'arraybuffer';
  onopen?: () => void;
  onmessage?: (event: MessageEvent) => void;
  onerror?: (event: ErrorEvent) => void;
  onclose?: (event: CloseEvent) => void;

  private socket: net.Socket | tls.TLSSocket | null = null;
  private handshakeKey = '';
  private expectedAccept = '';
  private handshakeDone = false;
  private handshakeBuffer = Buffer.alloc(0);
  private frameBuffer = Buffer.alloc(0);
  private closing = false;
  private fragmentOpcode: number | null = null;
  private fragmentParts: Buffer[] = [];
  private protocols: string[] = [];
  private retryAttempted = false;
  private retryNoOrigin = false;
  private includeOrigin = true;
  private originOverride: string | null = null;
  private pathOverride: string | null = null;
  private retryPathOverride = false;

  constructor(url: string, _protocols?: string | string[]) {
    this.url = url;
    this.protocols = normalizeProtocols(_protocols, process.env.CARTO_WS_PROTOCOL);
    if (process.env.CARTO_WS_ORIGIN?.trim()) {
      this.originOverride = process.env.CARTO_WS_ORIGIN.trim();
    }
    if (process.env.CARTO_WS_NO_ORIGIN === '1') {
      this.includeOrigin = false;
    }
    const pathOverride = getWsPathOverride();
    if (pathOverride) {
      this.pathOverride = pathOverride;
    }
    this.connect();
  }

  get bufferedAmount(): number {
    return this.socket?.writableLength ?? 0;
  }

  send(data: string | ArrayBuffer | Uint8Array | Buffer): void {
    if (this.readyState !== NodeWebSocket.OPEN || !this.socket) {
      throw new Error('WebSocket is not open');
    }
    const payload = toBuffer(data);
    const opcode = typeof data === 'string' ? 0x1 : 0x2;
    const frame = buildFrame(payload, opcode, true);
    this.socket.write(frame);
  }

  close(code = 1000, reason = ''): void {
    if (this.readyState === NodeWebSocket.CLOSING || this.readyState === NodeWebSocket.CLOSED) {
      return;
    }
    this.readyState = NodeWebSocket.CLOSING;
    this.closing = true;

    const reasonBytes = Buffer.from(reason);
    const payload = Buffer.alloc(2 + reasonBytes.length);
    payload.writeUInt16BE(code, 0);
    reasonBytes.copy(payload, 2);

    if (this.socket) {
      const frame = buildFrame(payload, 0x8, true);
      this.socket.write(frame);
      this.socket.end();
    }
  }

  private connect(): void {
    let target: URL;
    try {
      target = new URL(this.url);
    } catch (error) {
      this.fail(error instanceof Error ? error : new Error(String(error)));
      return;
    }

    const isSecure = target.protocol === 'wss:';
    if (!isSecure && target.protocol !== 'ws:') {
      this.fail(new Error(`Unsupported protocol: ${target.protocol}`));
      return;
    }

    const port = target.port ? Number(target.port) : isSecure ? 443 : 80;
    const host = target.hostname;
    const path = this.pathOverride
      ? this.pathOverride
      : target.pathname && target.pathname !== '/'
        ? `${target.pathname}${target.search || ''}`
        : '';
    const originHost = target.port ? `${host}:${port}` : host;
    const origin = this.originOverride ?? `${isSecure ? 'https' : 'http'}://${originHost}`;
    this.handshakeKey = randomBytes(16).toString('base64');
    this.expectedAccept = createHash('sha1')
      .update(`${this.handshakeKey}${WS_GUID}`)
      .digest('base64');

    const socket = isSecure
      ? tls.connect({ host, port, servername: host })
      : net.connect({ host, port });
    this.socket = socket;

    socket.on('connect', () => {
      const hostHeader = target.port ? `${host}:${port}` : host;
      const requestTarget = path ? `/${path.replace(/^\//, '')}` : '/';
      const headers = [
        `GET ${requestTarget} HTTP/1.1`,
        `Host: ${hostHeader}`,
        'Upgrade: websocket',
        'Connection: Upgrade',
        ...(this.includeOrigin ? [`Origin: ${origin}`] : []),
        `Sec-WebSocket-Key: ${this.handshakeKey}`,
        'Sec-WebSocket-Version: 13',
        ...(this.protocols.length ? [`Sec-WebSocket-Protocol: ${this.protocols.join(', ')}`] : []),
        '\r\n'
      ].join('\r\n');
      socket.write(headers);
    });

    socket.on('data', (chunk) => this.handleData(chunk));
    socket.on('error', (error) => this.fail(error));
    socket.on('close', () => this.handleClose());
  }

  private handleData(chunk: Buffer): void {
    if (!this.handshakeDone) {
      this.handshakeBuffer = Buffer.concat([this.handshakeBuffer, chunk]);
      const headerEnd = this.handshakeBuffer.indexOf('\r\n\r\n');
      if (headerEnd === -1) return;

      const headerText = this.handshakeBuffer.slice(0, headerEnd).toString('utf8');
      const remainder = this.handshakeBuffer.slice(headerEnd + 4);
      this.handshakeBuffer = Buffer.alloc(0);

      if (!this.acceptHandshake(headerText, remainder)) {
        return;
      }

      this.handshakeDone = true;
      this.readyState = NodeWebSocket.OPEN;
      this.onopen?.();

      if (remainder.length) {
        this.handleFrameData(remainder);
      }
      return;
    }

    this.handleFrameData(chunk);
  }

  private acceptHandshake(headerText: string, body: Buffer): boolean {
    const lines = headerText.split('\r\n');
    const status = lines.shift();
    if (!status || !status.includes('101')) {
      const code = parseStatusCode(status ?? '');
      if (code === 400) {
        if (!this.retryAttempted && this.protocols.length === 0) {
          this.retryAttempted = true;
          this.protocols = DEFAULT_PROTOCOLS.slice();
          this.resetForRetry();
          this.connect();
          return false;
        }
        if (!this.retryNoOrigin && this.includeOrigin) {
          this.retryNoOrigin = true;
          this.includeOrigin = false;
          this.resetForRetry();
          this.connect();
          return false;
        }
        if (!this.retryPathOverride && !this.pathOverride && isInvalidKeyExpr(body)) {
          this.retryPathOverride = true;
          this.pathOverride = '**';
          this.resetForRetry();
          this.connect();
          return false;
        }
      }
      const details = body.length ? ` Body: ${body.toString('utf8').trim()}` : '';
      this.fail(new Error(`WebSocket handshake failed: ${status ?? 'no status'}${details}`));
      return false;
    }

    const headers = new Map<string, string>();
    for (const line of lines) {
      const index = line.indexOf(':');
      if (index === -1) continue;
      const key = line.slice(0, index).trim().toLowerCase();
      const value = line.slice(index + 1).trim();
      headers.set(key, value);
    }

    const accept = headers.get('sec-websocket-accept');
    if (!accept || accept !== this.expectedAccept) {
      this.fail(new Error('WebSocket handshake failed: invalid accept header'));
      return false;
    }

    return true;
  }

  private handleFrameData(chunk: Buffer): void {
    this.frameBuffer = Buffer.concat([this.frameBuffer, chunk]);

    while (true) {
      if (this.frameBuffer.length < 2) return;

      const first = this.frameBuffer[0];
      const second = this.frameBuffer[1];
      const fin = (first & 0x80) !== 0;
      const opcode = first & 0x0f;
      let offset = 2;
      let length = second & 0x7f;
      const masked = (second & 0x80) !== 0;

      if (length === 126) {
        if (this.frameBuffer.length < offset + 2) return;
        length = this.frameBuffer.readUInt16BE(offset);
        offset += 2;
      } else if (length === 127) {
        if (this.frameBuffer.length < offset + 8) return;
        const big = this.frameBuffer.readBigUInt64BE(offset);
        if (big > BigInt(Number.MAX_SAFE_INTEGER)) {
          this.fail(new Error('WebSocket frame too large'));
          return;
        }
        length = Number(big);
        offset += 8;
      }

      let mask: Buffer | null = null;
      if (masked) {
        if (this.frameBuffer.length < offset + 4) return;
        mask = this.frameBuffer.subarray(offset, offset + 4);
        offset += 4;
      }

      if (this.frameBuffer.length < offset + length) return;

      let payload = this.frameBuffer.subarray(offset, offset + length);
      this.frameBuffer = this.frameBuffer.subarray(offset + length);

      if (masked && mask) {
        payload = unmaskPayload(payload, mask);
      }

      this.handleFrame(opcode, fin, payload);
    }
  }

  private handleFrame(opcode: number, fin: boolean, payload: Buffer): void {
    if (opcode === 0x8) {
      this.handleCloseFrame(payload);
      return;
    }

    if (opcode === 0x9) {
      if (this.socket && this.readyState === NodeWebSocket.OPEN) {
        const pong = buildFrame(payload, 0xa, true);
        this.socket.write(pong);
      }
      return;
    }

    if (opcode === 0xa) {
      return;
    }

    if (opcode === 0x0) {
      if (this.fragmentOpcode === null) {
        this.fail(new Error('Unexpected continuation frame'));
        return;
      }
      this.fragmentParts.push(payload);
      if (fin) {
        const combined = Buffer.concat(this.fragmentParts);
        const originalOpcode = this.fragmentOpcode;
        this.fragmentOpcode = null;
        this.fragmentParts = [];
        this.handleDataFrame(originalOpcode, combined);
      }
      return;
    }

    if (opcode === 0x1 || opcode === 0x2) {
      if (!fin) {
        this.fragmentOpcode = opcode;
        this.fragmentParts = [payload];
        return;
      }
      this.handleDataFrame(opcode, payload);
      return;
    }
  }

  private handleDataFrame(opcode: number, payload: Buffer): void {
    if (opcode === 0x1) {
      this.onmessage?.({ data: payload.toString('utf8') });
      return;
    }

    const arrayBuffer = payload.buffer.slice(
      payload.byteOffset,
      payload.byteOffset + payload.byteLength
    );
    const data = this.binaryType === 'arraybuffer' ? arrayBuffer : payload;
    this.onmessage?.({ data });
  }

  private handleCloseFrame(payload: Buffer): void {
    let code: number | undefined;
    let reason = '';

    if (payload.length >= 2) {
      code = payload.readUInt16BE(0);
      if (payload.length > 2) {
        reason = payload.subarray(2).toString('utf8');
      }
    }

    if (!this.closing && this.socket) {
      const responsePayload = Buffer.alloc(2);
      responsePayload.writeUInt16BE(code ?? 1000, 0);
      this.socket.write(buildFrame(responsePayload, 0x8, true));
    }

    this.readyState = NodeWebSocket.CLOSED;
    this.socket?.end();
    this.onclose?.({ code, reason });
  }

  private handleClose(): void {
    if (this.readyState !== NodeWebSocket.CLOSED) {
      this.readyState = NodeWebSocket.CLOSED;
      this.onclose?.({});
    }
  }

  private fail(error: Error): void {
    this.onerror?.({ error });
    this.readyState = NodeWebSocket.CLOSED;
    this.socket?.destroy();
    this.onclose?.({ reason: error.message });
  }

  private resetForRetry(): void {
    if (this.socket) {
      this.socket.removeAllListeners();
      this.socket.destroy();
      this.socket = null;
    }
    this.readyState = NodeWebSocket.CONNECTING;
    this.handshakeDone = false;
    this.handshakeBuffer = Buffer.alloc(0);
    this.frameBuffer = Buffer.alloc(0);
    this.closing = false;
    this.fragmentOpcode = null;
    this.fragmentParts = [];
  }
}

const toBuffer = (data: string | ArrayBuffer | Uint8Array | Buffer): Buffer => {
  if (typeof data === 'string') {
    return Buffer.from(data, 'utf8');
  }
  if (Buffer.isBuffer(data)) {
    return data;
  }
  if (data instanceof ArrayBuffer) {
    return Buffer.from(data);
  }
  return Buffer.from(data.buffer, data.byteOffset, data.byteLength);
};

const buildFrame = (payload: Buffer, opcode: number, mask: boolean): Buffer => {
  const length = payload.length;
  let headerLength = 2;
  if (length >= 126 && length <= 0xffff) headerLength += 2;
  if (length > 0xffff) headerLength += 8;
  if (mask) headerLength += 4;

  const header = Buffer.alloc(headerLength);
  header[0] = 0x80 | (opcode & 0x0f);

  let offset = 1;
  if (length < 126) {
    header[offset] = (mask ? 0x80 : 0x00) | length;
    offset += 1;
  } else if (length <= 0xffff) {
    header[offset] = (mask ? 0x80 : 0x00) | 126;
    header.writeUInt16BE(length, offset + 1);
    offset += 3;
  } else {
    header[offset] = (mask ? 0x80 : 0x00) | 127;
    header.writeBigUInt64BE(BigInt(length), offset + 1);
    offset += 9;
  }

  let maskedPayload = payload;
  if (mask) {
    const maskKey = randomBytes(4);
    maskKey.copy(header, offset);
    offset += 4;
    maskedPayload = Buffer.alloc(payload.length);
    for (let i = 0; i < payload.length; i += 1) {
      maskedPayload[i] = payload[i] ^ maskKey[i % 4];
    }
  }

  return Buffer.concat([header, maskedPayload]);
};

const unmaskPayload = (payload: Buffer, mask: Buffer): Buffer => {
  const unmasked = Buffer.alloc(payload.length);
  for (let i = 0; i < payload.length; i += 1) {
    unmasked[i] = payload[i] ^ mask[i % 4];
  }
  return unmasked;
};

const parseStatusCode = (statusLine: string): number | null => {
  const match = statusLine.match(/\s(\d{3})\s/);
  if (!match) return null;
  return Number(match[1]);
};

const normalizeProtocols = (
  protocols?: string | string[],
  envProtocol?: string
): string[] => {
  const list: string[] = [];
  if (typeof protocols === 'string' && protocols.trim()) {
    list.push(protocols.trim());
  } else if (Array.isArray(protocols)) {
    for (const protocol of protocols) {
      if (typeof protocol === 'string' && protocol.trim()) {
        list.push(protocol.trim());
      }
    }
  }
  if (envProtocol && envProtocol.trim()) {
    const trimmed = envProtocol.trim();
    if (!list.includes(trimmed)) {
      list.push(trimmed);
    }
  }
  return list;
};

const getWsPathOverride = (): string | null => {
  const override =
    typeof (globalThis as { __cartoWsPath?: unknown }).__cartoWsPath === 'string'
      ? String((globalThis as { __cartoWsPath?: unknown }).__cartoWsPath).trim()
      : process.env.CARTO_WS_PATH?.trim();
  if (!override) return null;
  return override;
};

const isInvalidKeyExpr = (body: Buffer): boolean => {
  if (!body.length) return false;
  const text = body.toString('utf8');
  return text.includes('Invalid Key Expr');
};
