import { randomBytes } from 'crypto';
import { createInterface } from 'readline';

const rl = createInterface({ input: process.stdin });

const subscriptions = new Map<
  string,
  { keyexpr: string; paused: boolean; timer: NodeJS.Timeout; count: number }
>();
let connected = false;

// TODO: Replace mock generator with real Zenoh client logic when native bindings are stable in Electron.

const send = (message: unknown): void => {
  process.stdout.write(`${JSON.stringify(message)}\n`);
};

const buildCapabilities = (): { driver: string; features: string[]; info: { note: string } } => ({
  driver: 'carto-tap-mock',
  features: ['subscribe', 'recent-keys', 'pause', 'publish'],
  info: {
    note: 'Mock generator. Replace with real Zenoh logic in carto-tap.'
  }
});

const sendStatus = (error?: string): void => {
  send({
    type: 'status',
    payload: {
      connected,
      error: error ?? undefined,
      capabilities: buildCapabilities()
    }
  });
};

const startSubscription = (subscriptionId: string, keyexpr: string): void => {
  const entry = {
    keyexpr,
    paused: false,
    count: 0,
    timer: setInterval(() => {
      const current = subscriptions.get(subscriptionId);
      if (!current || current.paused) return;
      const payload = generatePayload(current.count);
      const key = current.keyexpr;
      send({
        type: 'message',
        payload: {
          subscriptionId,
          key,
          payloadBase64: Buffer.from(payload).toString('base64'),
          ts: Date.now()
        }
      });
      current.count += 1;
    }, 400)
  };

  subscriptions.set(subscriptionId, entry);
};

const stopSubscription = (subscriptionId: string): void => {
  const entry = subscriptions.get(subscriptionId);
  if (!entry) return;
  clearInterval(entry.timer);
  subscriptions.delete(subscriptionId);
};

const generatePayload = (count: number): Uint8Array => {
  const roll = Math.random();
  if (roll < 0.4) {
    const data = {
      seq: count,
      tag: 'mock',
      at: new Date().toISOString(),
      value: Math.round(Math.random() * 1000)
    };
    return new TextEncoder().encode(JSON.stringify(data));
  }
  if (roll < 0.7) {
    return new TextEncoder().encode(`mock-${count}-payload`);
  }
  return new Uint8Array(randomBytes(16));
};

const matchesKeyexpr = (pattern: string, key: string): boolean => {
  if (pattern === '*' || pattern === '**') return true;
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
  const regexPattern = escaped.replace(/\\\*\\\*/g, '.*').replace(/\\\*/g, '[^/]*');
  try {
    return new RegExp(`^${regexPattern}$`).test(key);
  } catch {
    return false;
  }
};

const publishToSubscribers = (key: string, payloadBase64: string): void => {
  for (const [subscriptionId, entry] of subscriptions.entries()) {
    if (entry.paused) continue;
    if (!matchesKeyexpr(entry.keyexpr, key)) continue;
    send({
      type: 'message',
      payload: {
        subscriptionId,
        key,
        payloadBase64,
        ts: Date.now()
      }
    });
  }
};

rl.on('line', (line) => {
  if (!line.trim()) return;
  let data: { id?: string; type?: string; payload?: Record<string, unknown> };
  try {
    data = JSON.parse(line) as { id?: string; type?: string; payload?: Record<string, unknown> };
  } catch (error) {
    send({
      id: 'unknown',
      ok: false,
      error: `Invalid JSON: ${error instanceof Error ? error.message : String(error)}`
    });
    return;
  }

  const id = data.id ?? 'unknown';
  const type = data.type;
  if (!type) {
    send({ id, ok: false, error: 'Missing type' });
    return;
  }

  switch (type) {
    case 'connect':
      connected = true;
      send({ id, ok: true, payload: buildCapabilities() });
      sendStatus();
      break;
    case 'disconnect':
      connected = false;
      for (const key of subscriptions.keys()) {
        stopSubscription(key);
      }
      send({ id, ok: true, payload: null });
      sendStatus();
      break;
    case 'subscribe': {
      const subscriptionId = String(data.payload?.subscriptionId ?? '');
      const keyexpr = String(data.payload?.keyexpr ?? '');
      if (!subscriptionId || !keyexpr) {
        send({ id, ok: false, error: 'Missing subscriptionId or keyexpr' });
        break;
      }
      startSubscription(subscriptionId, keyexpr);
      send({ id, ok: true, payload: null });
      break;
    }
    case 'unsubscribe': {
      const subscriptionId = String(data.payload?.subscriptionId ?? '');
      stopSubscription(subscriptionId);
      send({ id, ok: true, payload: null });
      break;
    }
    case 'pause': {
      const subscriptionId = String(data.payload?.subscriptionId ?? '');
      const paused = Boolean(data.payload?.paused);
      const entry = subscriptions.get(subscriptionId);
      if (entry) {
        entry.paused = paused;
      }
      send({ id, ok: true, payload: null });
      break;
    }
    case 'publish': {
      const keyexpr = String(data.payload?.keyexpr ?? '');
      const payloadBase64 = String(data.payload?.payloadBase64 ?? '');
      if (!keyexpr) {
        send({ id, ok: false, error: 'Missing keyexpr' });
        break;
      }
      publishToSubscribers(keyexpr, payloadBase64);
      send({ id, ok: true, payload: null });
      break;
    }
    default:
      send({ id, ok: false, error: `Unknown command: ${type}` });
      break;
  }
});

sendStatus();
