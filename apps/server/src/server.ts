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
  ConnectParams,
  ConnectionTestParams,
  GetMessageParams,
  GetRecentKeysParams,
  PauseParams,
  PublishParams,
  SubscribeParams,
  UnsubscribeParams
} from '../../../packages/core/src/shared/types';

const PORT = Number(process.env.PORT || 8080);
const HOST = process.env.HOST || '0.0.0.0';
const DIST_DIR = path.resolve(process.cwd(), process.env.CARTO_WEB_DIST || 'dist/web');
const INDEX_FILE = path.join(DIST_DIR, 'index.html');

const backend = createCartoBackend();
const sockets = new Set<WebSocket>();

backend.setEventSink(createBroadcastEventSink(sockets));

const server = createServer(async (req, res) => {
  try {
    const requestUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    if (req.method === 'POST' && requestUrl.pathname.startsWith('/api/')) {
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
    respondJson(res, 500, { error: message });
  }
});

const wsServer = new WebSocketServer({ noServer: true });

function attachSocket(socket: WebSocket): void {
  sockets.add(socket);
  sendSocketEvent(socket, { type: 'status', data: backend.getStatus() });

  socket.on('close', () => {
    sockets.delete(socket);
  });

  socket.on('error', () => {
    sockets.delete(socket);
    socket.close();
  });
}

server.on('upgrade', (request, socket, head) => {
  try {
    const requestUrl = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`);
    if (requestUrl.pathname !== '/api/events') {
      socket.destroy();
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
  socket.send(JSON.stringify(payload));
}

const readJsonBody = async (req: IncomingMessage): Promise<unknown> => {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  if (chunks.length === 0) return {};
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw.trim()) return {};
  return JSON.parse(raw) as unknown;
};

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
  res.writeHead(200, { 'Content-Type': getContentType(selectedPath) });
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
