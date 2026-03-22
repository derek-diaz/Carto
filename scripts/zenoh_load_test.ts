import { NodeWebSocket } from '../packages/core/src/zenoh/nodeWebSocket';

type ZenohSession = {
  close?: () => Promise<void> | void;
  put?: (keyexpr: string, payload: Uint8Array, options?: { encoding?: string }) => Promise<void>;
  declarePublisher?: (keyexpr: string) => Promise<unknown>;
};

type ZenohModule = {
  open?: (config: Record<string, unknown>) => Promise<ZenohSession>;
  default?: {
    open?: (config: Record<string, unknown>) => Promise<ZenohSession>;
  };
};

type Options = {
  endpoint: string;
  keyexpr: string;
  count: number;
  burst: number;
  pauseMs: number;
  minKiB: number;
  maxKiB: number;
  format: 'json' | 'text';
  timeoutMs: number;
};

const DEFAULTS: Options = {
  endpoint: 'ws://127.0.0.1:10000/',
  keyexpr: 'carto/load-test',
  count: 100,
  burst: 5,
  pauseMs: 100,
  minKiB: 600,
  maxKiB: 900,
  format: 'json',
  timeoutMs: 5000
};

const textEncoder = new TextEncoder();
const importZenohModule = new Function(
  'specifier',
  'return import(specifier);'
) as (specifier: string) => Promise<ZenohModule>;

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  ensureWebSocket();
  const zenoh = await loadZenohModule();
  const open = zenoh.open ?? zenoh.default?.open;
  if (!open) {
    throw new Error('Unable to find open() in @eclipse-zenoh/zenoh-ts.');
  }

  console.log(`[load-test] endpoint=${options.endpoint}`);
  console.log(`[load-test] keyexpr=${options.keyexpr}`);
  console.log(
    `[load-test] count=${options.count} burst=${options.burst} pauseMs=${options.pauseMs} size=${options.minKiB}-${options.maxKiB} KiB format=${options.format}`
  );

  const session = await open({
    locator: options.endpoint,
    messageResponseTimeoutMs: options.timeoutMs
  });

  const publish = createPublisher(session, options.keyexpr);
  const startedAt = Date.now();
  let sent = 0;
  let totalBytes = 0;

  try {
    while (sent < options.count) {
      const remaining = options.count - sent;
      const burstSize = Math.min(options.burst, remaining);
      const tasks: Promise<number>[] = [];

      for (let index = 0; index < burstSize; index += 1) {
        const sequence = sent + index + 1;
        const targetBytes = randomInt(options.minKiB * 1024, options.maxKiB * 1024);
        const payload = buildPayload(options.format, options.keyexpr, sequence, targetBytes);
        tasks.push(
          publish(payload.bytes, payload.encodingHint).then(() => {
            console.log(
              `[load-test] sent seq=${sequence} size=${formatKiB(payload.bytes.byteLength)}`
            );
            return payload.bytes.byteLength;
          })
        );
      }

      const bytes = await Promise.all(tasks);
      const burstBytes = bytes.reduce((sum, value) => sum + value, 0);
      totalBytes += burstBytes;
      sent += burstSize;

      if (sent < options.count && options.pauseMs > 0) {
        await sleep(options.pauseMs);
      }
    }
  } finally {
    await session.close?.();
  }

  const elapsedMs = Date.now() - startedAt;
  const mb = totalBytes / (1024 * 1024);
  const throughput = elapsedMs > 0 ? (mb / elapsedMs) * 1000 : 0;
  console.log(
    `[load-test] complete sent=${sent} total=${mb.toFixed(2)} MiB elapsed=${elapsedMs} ms throughput=${throughput.toFixed(2)} MiB/s`
  );
}

const parseArgs = (args: string[]): Options => {
  const next = { ...DEFAULTS };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const value = args[index + 1];

    switch (arg) {
      case '--endpoint':
        next.endpoint = requireValue(arg, value);
        index += 1;
        break;
      case '--keyexpr':
        next.keyexpr = requireValue(arg, value);
        index += 1;
        break;
      case '--count':
        next.count = parsePositiveInt(arg, value);
        index += 1;
        break;
      case '--burst':
        next.burst = parsePositiveInt(arg, value);
        index += 1;
        break;
      case '--pause-ms':
        next.pauseMs = parseNonNegativeInt(arg, value);
        index += 1;
        break;
      case '--min-kib':
        next.minKiB = parsePositiveInt(arg, value);
        index += 1;
        break;
      case '--max-kib':
        next.maxKiB = parsePositiveInt(arg, value);
        index += 1;
        break;
      case '--format': {
        const format = requireValue(arg, value);
        if (format !== 'json' && format !== 'text') {
          throw new Error(`Unsupported format "${format}". Use "json" or "text".`);
        }
        next.format = format;
        index += 1;
        break;
      }
      case '--timeout-ms':
        next.timeoutMs = parsePositiveInt(arg, value);
        index += 1;
        break;
      case '--help':
        printHelp();
        process.exit(0);
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (next.maxKiB < next.minKiB) {
    throw new Error('--max-kib must be greater than or equal to --min-kib.');
  }

  return next;
};

const printHelp = (): void => {
  console.log(`Usage:
  npm run load:test -- [options]

Options:
  --endpoint    Zenoh remote-api websocket endpoint
  --keyexpr     Key expression to publish to
  --count       Total messages to send
  --burst       Messages sent concurrently per burst
  --pause-ms    Delay between bursts
  --min-kib     Minimum payload size in KiB
  --max-kib     Maximum payload size in KiB
  --format      json | text
  --timeout-ms  Zenoh message response timeout

Example:
  npm run load:test -- --endpoint ws://127.0.0.1:10000/ --count 200 --burst 10 --pause-ms 50 --min-kib 600 --max-kib 900
`);
};

const requireValue = (flag: string, value: string | undefined): string => {
  if (!value) throw new Error(`Missing value for ${flag}.`);
  return value;
};

const parsePositiveInt = (flag: string, value: string | undefined): number => {
  const parsed = Number(requireValue(flag, value));
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${flag} must be a positive integer.`);
  }
  return parsed;
};

const parseNonNegativeInt = (flag: string, value: string | undefined): number => {
  const parsed = Number(requireValue(flag, value));
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${flag} must be a non-negative integer.`);
  }
  return parsed;
};

const ensureWebSocket = (): void => {
  const globalWithWebSocket = globalThis as { WebSocket?: typeof NodeWebSocket };
  if (typeof globalWithWebSocket.WebSocket === 'function') return;
  globalWithWebSocket.WebSocket = NodeWebSocket;
};

const loadZenohModule = async (): Promise<ZenohModule> => {
  return importZenohModule('@eclipse-zenoh/zenoh-ts');
};

const createPublisher = (session: ZenohSession, keyexpr: string) => {
  if (session.put) {
    return async (payload: Uint8Array, encodingHint: string): Promise<void> => {
      await session.put?.(keyexpr, payload, { encoding: encodingHint });
    };
  }

  return async (payload: Uint8Array, encodingHint: string): Promise<void> => {
    const publisher = await session.declarePublisher?.(keyexpr);
    const put = (publisher as { put?: (data: Uint8Array, opts?: { encoding?: string }) => Promise<void> })
      ?.put;
    if (!put) {
      throw new Error('Zenoh session does not support publish operations.');
    }
    await put(payload, { encoding: encodingHint });
    const close = publisher as { undeclare?: () => Promise<void>; close?: () => Promise<void> };
    if (close.undeclare) {
      await close.undeclare();
      return;
    }
    await close.close?.();
  };
};

const buildPayload = (
  format: Options['format'],
  keyexpr: string,
  sequence: number,
  targetBytes: number
): { bytes: Uint8Array; encodingHint: string } => {
  if (format === 'text') {
    const prefix = `carto-load-test seq=${sequence} key=${keyexpr} sentAt=${new Date().toISOString()}\n`;
    const bodyLength = Math.max(0, targetBytes - prefix.length);
    const body = fillString(bodyLength);
    const text = `${prefix}${body}`;
    const bytes = textEncoder.encode(text);
    return { bytes, encodingHint: 'text/plain' };
  }

  const payload = buildJsonPayload(keyexpr, sequence, targetBytes);
  return {
    bytes: textEncoder.encode(payload),
    encodingHint: 'application/json'
  };
};

const buildJsonPayload = (keyexpr: string, sequence: number, targetBytes: number): string => {
  const base = {
    source: 'carto-load-test',
    keyexpr,
    sequence,
    sentAt: new Date().toISOString(),
    blob: ''
  };

  let blobLength = Math.max(0, targetBytes - 256);
  for (let attempt = 0; attempt < 4; attempt += 1) {
    base.blob = fillString(blobLength);
    const serialized = JSON.stringify(base);
    const size = Buffer.byteLength(serialized);
    const delta = targetBytes - size;
    if (Math.abs(delta) <= 8) {
      return serialized;
    }
    blobLength = Math.max(0, blobLength + delta);
  }

  base.blob = fillString(blobLength);
  return JSON.stringify(base);
};

const fillString = (length: number): string => {
  if (length <= 0) return '';
  const chunk = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let output = '';
  while (output.length < length) {
    output += chunk;
  }
  return output.slice(0, length);
};

const randomInt = (min: number, max: number): number => {
  if (min === max) return min;
  return Math.floor(Math.random() * (max - min + 1)) + min;
};

const formatKiB = (bytes: number): string => `${(bytes / 1024).toFixed(1)} KiB`;

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(message);
  process.exit(1);
});
