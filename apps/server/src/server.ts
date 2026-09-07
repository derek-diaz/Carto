import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createReadStream, existsSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { URL } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';
import { createCartoBackend } from '../../../packages/core/src/backend/cartoBackend';
import type { CartoEventSink } from '../../../packages/core/src/backend/eventSink';
import type {
  ClearBufferParams,
  DiscoveryParams,
  ConnectParams,
  ConnectionTestParams,
  DeclareQueryableParams,
  GetMessageParams,
  GetRecentKeysParams,
  PauseParams,
  PublishParams,
  SubscribeParams,
  UndeclareQueryableParams,
  UpdateSubscriptionParams,
  UnsubscribeParams
} from '../../../packages/core/src/shared/types';

const PORT = Number(process.env.PORT || 8080);
const HOST = process.env.HOST || '127.0.0.1';
const DIST_DIR = path.resolve(process.cwd(), process.env.CARTO_WEB_DIST || 'dist/web');
const INDEX_FILE = path.join(DIST_DIR, 'index.html');
const MAX_API_BODY_BYTES = readPositiveInteger(
  process.env.CARTO_MAX_API_BODY_BYTES,
  16 * 1024 * 1024
);
const MAX_SOCKET_BUFFER_BYTES = readPositiveInteger(
  process.env.CARTO_MAX_SOCKET_BUFFER_BYTES,
  8 * 1024 * 1024
);
const SESSION_RELEASE_DELAY_MS = 3000;
const CLIENT_ID_HEADER = 'x-carto-client-id';
const CLIENT_ID_RE = /^[a-zA-Z0-9_-]{16,128}$/;
const SECURITY_HEADERS = {
  'Content-Security-Policy':
    // Runtime-loaded .proto schemas use protobufjs-generated codecs, as in Electron's CSP.
    "default-src 'self'; base-uri 'none'; connect-src 'self' https://api.github.com ws: wss:; font-src 'self'; form-action 'none'; frame-ancestors 'none'; img-src 'self' data:; object-src 'none'; script-src 'self' 'unsafe-eval'; style-src 'self' 'unsafe-inline'",
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Permissions-Policy': 'camera=(), geolocation=(), microphone=()',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY'
} as const;

if (!isLoopbackHost(HOST) && process.env.CARTO_ALLOW_REMOTE !== '1') {
  throw new Error(
    `Refusing to bind Carto to non-loopback host ${HOST}. Set CARTO_ALLOW_REMOTE=1 only on a trusted network or behind an authenticated reverse proxy.`
  );
}

const backend = createCartoBackend();
const sockets = new Set<WebSocket>();
let activeClientId: string | null = null;
let sessionReleaseTimer: ReturnType<typeof setTimeout> | null = null;

backend.setEventSink(createBroadcastEventSink(sockets));

const server = createServer(async (req, res) => {
  try {
    const requestUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    if (req.method === 'POST' && requestUrl.pathname.startsWith('/api/')) {
      if (!isAllowedOrigin(req)) {
        respondJson(res, 403, { error: 'Cross-origin API requests are not allowed.' });
        return;
      }
      const clientError = claimClient(readHttpClientId(req));
      if (clientError) {
        respondJson(res, clientError.statusCode, { error: clientError.message });
        return;
      }
      await handleApiRequest(req, res, requestUrl.pathname);
      return;
    }

    if (req.method === 'GET' || req.method === 'HEAD') {
      await serveStatic(req, res, requestUrl.pathname);
      return;
    }

    respondJson(res, 405, { error: 'Method not allowed.' });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const statusCode = error instanceof HttpError ? error.statusCode : 500;
    respondJson(res, statusCode, { error: message });
  }
});

const wsServer = new WebSocketServer({
  noServer: true,
  maxPayload: 64 * 1024,
  perMessageDeflate: false
});

function attachSocket(socket: WebSocket): void {
  sockets.add(socket);
  cancelSessionRelease();
  sendSocketEvent(socket, { type: 'status', data: backend.getStatus() });

  socket.on('close', () => {
    sockets.delete(socket);
    scheduleSessionRelease();
  });

  socket.on('error', () => {
    sockets.delete(socket);
    socket.close();
    scheduleSessionRelease();
  });
}

server.on('upgrade', (request, socket, head) => {
  try {
    const requestUrl = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`);
    if (requestUrl.pathname !== '/api/events' || !isAllowedOrigin(request)) {
      socket.destroy();
      return;
    }

    const clientError = claimClient(requestUrl.searchParams.get('clientId'));
    if (clientError) {
      wsServer.handleUpgrade(request, socket, head, (ws) => {
        ws.close(1008, clientError.message.slice(0, 123));
      });
      return;
    }

    wsServer.handleUpgrade(request, socket, head, (ws) => {
      attachSocket(ws);
    });
  } catch {
    socket.destroy();
  }
});

server.listen(PORT, HOST, () => {
  console.log(`[carto] web server listening on http://${HOST}:${PORT}`);
  console.log(`[carto] serving UI from ${DIST_DIR}`);
});

const handleApiRequest = async (
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string
): Promise<void> => {
  const body = (await readJsonBody(req)) as Record<string, unknown>;

  try {
    switch (pathname) {
      case '/api/discovery/start':
        respondJson(res, 200, await backend.startDiscovery(body as DiscoveryParams));
        return;
      case '/api/discovery/stop':
        respondJson(res, 200, await backend.stopDiscovery());
        return;
      case '/api/discovery':
        respondJson(res, 200, backend.getDiscovery());
        return;
      case '/api/connect':
        await backend.connect(body as ConnectParams);
        respondJson(res, 200, { ok: true });
        return;
      case '/api/test-connection': {
        const result = await backend.testConnection(body as ConnectionTestParams);
        respondJson(res, 200, result);
        return;
      }
      case '/api/disconnect':
        await backend.disconnect();
        respondJson(res, 200, { ok: true });
        return;
      case '/api/subscribe': {
        const { keyexpr, bufferSize } = body as SubscribeParams;
        const subscriptionId = await backend.subscribe(keyexpr, bufferSize);
        respondJson(res, 200, { subscriptionId });
        return;
      }
      case '/api/update-subscription': {
        const { subscriptionId, keyexpr, bufferSize } = body as UpdateSubscriptionParams;
        await backend.updateSubscription(subscriptionId, keyexpr, bufferSize);
        respondJson(res, 200, { ok: true });
        return;
      }
      case '/api/unsubscribe':
        await backend.unsubscribe((body as UnsubscribeParams).subscriptionId);
        respondJson(res, 200, { ok: true });
        return;
      case '/api/pause': {
        const { subscriptionId, paused } = body as PauseParams;
        await backend.pause(subscriptionId, paused);
        respondJson(res, 200, { ok: true });
        return;
      }
      case '/api/get-message': {
        const { subscriptionId, messageId } = body as GetMessageParams;
        const message = await backend.getMessage(subscriptionId, messageId);
        respondJson(res, 200, { message });
        return;
      }
      case '/api/get-recent-keys': {
        const { filter, subscriptionId } = body as GetRecentKeysParams;
        const keys = backend.getRecentKeys(filter, subscriptionId);
        respondJson(res, 200, { keys });
        return;
      }
      case '/api/clear-buffer':
        await backend.clearBuffer((body as ClearBufferParams).subscriptionId);
        respondJson(res, 200, { ok: true });
        return;
      case '/api/publish':
        await backend.publish(body as PublishParams);
        respondJson(res, 200, { ok: true });
        return;
      case '/api/declare-queryable': {
        const queryableId = await backend.declareQueryable(body as DeclareQueryableParams);
        respondJson(res, 200, { queryableId });
        return;
      }
      case '/api/undeclare-queryable':
        await backend.undeclareQueryable((body as UndeclareQueryableParams).queryableId);
        respondJson(res, 200, { ok: true });
        return;
      case '/api/get-queryables': {
        const queryables = backend.getQueryables();
        respondJson(res, 200, { queryables });
        return;
      }
      default:
        respondJson(res, 404, { error: 'Not found.' });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    respondJson(res, 500, { error: message });
  }
};

function createBroadcastEventSink(targets: Set<WebSocket>): CartoEventSink {
  return {
    sendMessage: (payload) => {
      broadcastSocketEvent(targets, { type: 'message', data: payload });
    },
    sendStatus: (status) => {
      broadcastSocketEvent(targets, { type: 'status', data: status });
    }
  };
}

function broadcastSocketEvent(targets: Set<WebSocket>, payload: unknown): void {
  for (const socket of targets) {
    sendSocketEvent(socket, payload);
  }
}

function sendSocketEvent(socket: WebSocket, payload: unknown): void {
  if (socket.readyState !== WebSocket.OPEN) return;
  if (socket.bufferedAmount > MAX_SOCKET_BUFFER_BYTES) {
    socket.close(1013, 'Client is not keeping up with the live stream.');
    return;
  }
  socket.send(JSON.stringify(payload), (error) => {
    if (error && socket.readyState === WebSocket.OPEN) {
      socket.close(1011, 'Unable to deliver a live event.');
    }
  });
}

const readJsonBody = async (req: IncomingMessage): Promise<unknown> => {
  const chunks: Buffer[] = [];
  let totalBytes = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += buffer.byteLength;
    if (totalBytes > MAX_API_BODY_BYTES) {
      throw new HttpError(413, `Request body exceeds the ${MAX_API_BODY_BYTES}-byte limit.`);
    }
    chunks.push(buffer);
  }

  if (chunks.length === 0) return {};
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw.trim()) return {};
  return JSON.parse(raw) as unknown;
};

class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    message: string
  ) {
    super(message);
  }
}

const readHttpClientId = (req: IncomingMessage): string | null => {
  const value = req.headers[CLIENT_ID_HEADER];
  return typeof value === 'string' ? value : null;
};

const claimClient = (clientId: string | null): HttpError | null => {
  if (!clientId || !CLIENT_ID_RE.test(clientId)) {
    return new HttpError(400, 'A valid Carto browser session identifier is required.');
  }
  if (activeClientId && activeClientId !== clientId) {
    return new HttpError(
      409,
      'Carto is already active in another browser session. Close it and reload this page.'
    );
  }
  activeClientId = clientId;
  cancelSessionRelease();
  return null;
};

const cancelSessionRelease = (): void => {
  if (!sessionReleaseTimer) return;
  clearTimeout(sessionReleaseTimer);
  sessionReleaseTimer = null;
};

const scheduleSessionRelease = (): void => {
  if (sockets.size > 0 || sessionReleaseTimer) return;
  sessionReleaseTimer = setTimeout(() => {
    sessionReleaseTimer = null;
    if (sockets.size > 0) return;
    activeClientId = null;
    void backend.disconnect().catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[carto] session cleanup failed: ${message}`);
    });
  }, SESSION_RELEASE_DELAY_MS);
};

const isAllowedOrigin = (req: IncomingMessage): boolean => {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    const parsed = new URL(origin);
    return (
      (parsed.protocol === 'http:' || parsed.protocol === 'https:') &&
      parsed.host === req.headers.host
    );
  } catch {
    return false;
  }
};

function isLoopbackHost(host: string): boolean {
  const normalized = host.trim().toLowerCase();
  return normalized === 'localhost' || normalized === '127.0.0.1' || normalized === '::1';
}

function readPositiveInteger(raw: string | undefined, fallback: number): number {
  const parsed = raw ? Number(raw) : NaN;
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

const serveStatic = async (
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string
): Promise<void> => {
  if (!existsSync(INDEX_FILE)) {
    respondJson(res, 503, {
      error: `Renderer build not found at ${INDEX_FILE}. Run npm run build:web first.`
    });
    return;
  }

  const relativePath = pathname === '/' ? '/index.html' : pathname;
  const safePath = path
    .normalize(relativePath)
    .replace(/^([/\\])+/, '')
    .replace(/^(\.\.(\/|\\|$))+/, '');
  const filePath = path.join(DIST_DIR, safePath);
  const candidate = filePath.startsWith(DIST_DIR) ? filePath : INDEX_FILE;

  const selectedPath = (await isFile(candidate)) ? candidate : INDEX_FILE;
  res.writeHead(200, {
    ...SECURITY_HEADERS,
    'Content-Type': getContentType(selectedPath)
  });
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  createReadStream(selectedPath).pipe(res);
};

const isFile = async (filePath: string): Promise<boolean> => {
  try {
    const details = await stat(filePath);
    return details.isFile();
  } catch {
    return false;
  }
};

const respondJson = (res: ServerResponse, statusCode: number, payload: unknown): void => {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    ...SECURITY_HEADERS,
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body)
  });
  res.end(body);
};

const getContentType = (filePath: string): string => {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case '.html':
      return 'text/html; charset=utf-8';
    case '.js':
      return 'text/javascript; charset=utf-8';
    case '.css':
      return 'text/css; charset=utf-8';
    case '.json':
      return 'application/json; charset=utf-8';
    case '.png':
      return 'image/png';
    case '.svg':
      return 'image/svg+xml';
    case '.ico':
      return 'image/x-icon';
    case '.map':
      return 'application/json; charset=utf-8';
    default:
      return 'application/octet-stream';
  }
};
