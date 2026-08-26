import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import * as protobuf from 'protobufjs';
import { NodeWebSocket } from '../packages/core/src/zenoh/nodeWebSocket';

type ZenohSession = {
  close?: () => Promise<void> | void;
  put?: (keyexpr: string, payload: Uint8Array, options?: { encoding?: string }) => Promise<void>;
  delete?: (keyexpr: string) => Promise<void>;
};

type ZenohModule = {
  open?: (config: Record<string, unknown>) => Promise<ZenohSession>;
  default?: {
    open?: (config: Record<string, unknown>) => Promise<ZenohSession>;
  };
};

type ScenarioBase = {
  id: string;
  label: string;
  keyexpr: string;
  count?: number;
  intervalMs?: number;
};

type JsonScenario = ScenarioBase & {
  kind: 'json';
  payload: Record<string, unknown>;
};

type TextScenario = ScenarioBase & {
  kind: 'text';
  messages: string[];
};

type BinaryScenario = ScenarioBase & {
  kind: 'binary';
  sizeBytes: number;
};

type ProtobufScenario = ScenarioBase & {
  kind: 'protobuf';
  schemaId: string;
  messageType: string;
  payload: Record<string, unknown>;
};

type BurstScenario = ScenarioBase & {
  kind: 'burst';
  count: number;
  burstSize: number;
  payload: Record<string, unknown>;
};

type LargeJsonScenario = ScenarioBase & {
  kind: 'large-json';
  sizeKiB: number;
};

type LifecycleScenario = ScenarioBase & {
  kind: 'lifecycle';
  deleteAfterMs: number;
  payload: Record<string, unknown>;
};

type Scenario =
  | JsonScenario
  | TextScenario
  | BinaryScenario
  | ProtobufScenario
  | BurstScenario
  | LargeJsonScenario
  | LifecycleScenario;

type ScenarioPack = {
  id: string;
  version: number;
  label: string;
  defaultEndpoint: string;
  rootKeyexpr: string;
  scenarios: Scenario[];
};

type SettingsFile = {
  data?: {
    protoSchemas?: Array<{ id: string; name: string; source: string }>;
    scenarioPack?: ScenarioPack;
  };
};

type Options = {
  endpoint?: string;
  packPath: string;
  scenarioIds: string[];
  cycles: number;
  continuous: boolean;
  paceMultiplier: number;
  timeoutMs: number;
  listOnly: boolean;
};

const DEFAULT_PACK_PATH = 'examples/carto-zenoh-scenarios.json';
const textEncoder = new TextEncoder();
const importZenohModule = new Function(
  'specifier',
  'return import(specifier);'
) as (specifier: string) => Promise<ZenohModule>;

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const settings = await loadSettings(options.packPath);
  const pack = settings.data?.scenarioPack;
  if (!pack) {
    throw new Error(`No data.scenarioPack found in ${options.packPath}.`);
  }
  validatePack(pack);

  const selected = selectScenarios(pack.scenarios, options.scenarioIds);
  if (options.listOnly) {
    printScenarioList(pack, selected);
    return;
  }

  ensureWebSocket();
  const zenoh = await loadZenohModule();
  const open = zenoh.open ?? zenoh.default?.open;
  if (!open) {
    throw new Error('Unable to find open() in @eclipse-zenoh/zenoh-ts.');
  }

  const endpoint = options.endpoint ?? pack.defaultEndpoint;
  const protoRoots = buildProtoRoots(settings);
  console.log(`[scenarios] pack=${pack.id}@${pack.version} endpoint=${endpoint}`);
  const runMode = options.continuous ? 'continuous (Ctrl+C to stop)' : `${options.cycles} cycle(s)`;
  console.log(`[scenarios] selected=${selected.map((scenario) => scenario.id).join(',')}`);
  console.log(`[scenarios] mode=${runMode}`);

  const session = await open({
    locator: endpoint,
    messageResponseTimeoutMs: options.timeoutMs
  });
  const startedAt = Date.now();
  let sent = 0;
  let totalBytes = 0;
  let cycle = 0;
  let stopRequested = false;
  const handleStop = () => {
    if (stopRequested) {
      process.exit(130);
    }
    stopRequested = true;
    console.log('\n[scenarios] stop requested; closing after the current scenario...');
  };
  process.once('SIGINT', handleStop);
  process.once('SIGTERM', handleStop);

  try {
    while (!stopRequested && (options.continuous || cycle < options.cycles)) {
      cycle += 1;
      console.log(
        `[scenarios] cycle ${cycle}${options.continuous ? '' : `/${options.cycles}`}`
      );
      for (const scenario of selected) {
        if (stopRequested) break;
        const result = await runScenario(
          session,
          scenario,
          cycle,
          options.paceMultiplier,
          protoRoots
        );
        sent += result.sent;
        totalBytes += result.bytes;
      }
    }
  } finally {
    process.off('SIGINT', handleStop);
    process.off('SIGTERM', handleStop);
    await session.close?.();
  }

  const elapsedMs = Date.now() - startedAt;
  console.log(
    `[scenarios] complete messages=${sent} bytes=${formatBytes(totalBytes)} elapsed=${elapsedMs}ms`
  );
}

const runScenario = async (
  session: ZenohSession,
  scenario: Scenario,
  cycle: number,
  paceMultiplier: number,
  protoRoots: Map<string, protobuf.Root>
): Promise<{ sent: number; bytes: number }> => {
  console.log(`[scenarios] run ${scenario.id}: ${scenario.label}`);
  const intervalMs = Math.round((scenario.intervalMs ?? 0) * paceMultiplier);

  if (scenario.kind === 'text') {
    let bytes = 0;
    for (let index = 0; index < scenario.messages.length; index += 1) {
      const payload = textEncoder.encode(
        `${scenario.messages[index]} cycle=${cycle} sequence=${index + 1} sentAt=${new Date().toISOString()}`
      );
      await publish(session, scenario.keyexpr, payload, 'text/plain');
      bytes += payload.byteLength;
      await waitBetween(index, scenario.messages.length, intervalMs);
    }
    return { sent: scenario.messages.length, bytes };
  }

  if (scenario.kind === 'binary') {
    const count = scenario.count ?? 1;
    let bytes = 0;
    for (let index = 0; index < count; index += 1) {
      const payload = buildBinaryPayload(scenario.sizeBytes, cycle, index + 1);
      await publish(session, scenario.keyexpr, payload, 'application/octet-stream');
      bytes += payload.byteLength;
      await waitBetween(index, count, intervalMs);
    }
    return { sent: count, bytes };
  }

  if (scenario.kind === 'protobuf') {
    const root = protoRoots.get(scenario.schemaId);
    if (!root) throw new Error(`Missing protobuf schema ${scenario.schemaId}.`);
    const type = root.lookupType(scenario.messageType);
    const count = scenario.count ?? 1;
    let bytes = 0;
    for (let index = 0; index < count; index += 1) {
      const value = withSequence(scenario.payload, scenario, cycle, index + 1);
      const error = type.verify(value);
      if (error) throw new Error(`${scenario.id}: ${error}`);
      const payload = type.encode(type.create(value)).finish();
      await publish(session, scenario.keyexpr, payload, 'application/protobuf');
      bytes += payload.byteLength;
      await waitBetween(index, count, intervalMs);
    }
    return { sent: count, bytes };
  }

  if (scenario.kind === 'burst') {
    let sent = 0;
    let bytes = 0;
    while (sent < scenario.count) {
      const burstCount = Math.min(scenario.burstSize, scenario.count - sent);
      const payloads = Array.from({ length: burstCount }, (_, index) => {
        const sequence = sent + index + 1;
        return textEncoder.encode(
          JSON.stringify(withSequence(scenario.payload, scenario, cycle, sequence))
        );
      });
      await Promise.all(
        payloads.map((payload) => publish(session, scenario.keyexpr, payload, 'application/json'))
      );
      bytes += payloads.reduce((sum, payload) => sum + payload.byteLength, 0);
      sent += burstCount;
      if (sent < scenario.count && intervalMs > 0) await sleep(intervalMs);
    }
    return { sent, bytes };
  }

  if (scenario.kind === 'large-json') {
    const count = scenario.count ?? 1;
    let bytes = 0;
    for (let index = 0; index < count; index += 1) {
      const payload = buildLargeJsonPayload(scenario, cycle, index + 1);
      await publish(session, scenario.keyexpr, payload, 'application/json');
      bytes += payload.byteLength;
      await waitBetween(index, count, intervalMs);
    }
    return { sent: count, bytes };
  }

  if (scenario.kind === 'lifecycle') {
    const payload = textEncoder.encode(
      JSON.stringify(withSequence(scenario.payload, scenario, cycle, 1))
    );
    await publish(session, scenario.keyexpr, payload, 'application/json');
    if (!session.delete) throw new Error('Zenoh session does not support delete operations.');
    await sleep(Math.round(scenario.deleteAfterMs * paceMultiplier));
    await session.delete(scenario.keyexpr);
    return { sent: 2, bytes: payload.byteLength };
  }

  const count = scenario.count ?? 1;
  let bytes = 0;
  for (let index = 0; index < count; index += 1) {
    const payload = textEncoder.encode(
      JSON.stringify(withSequence(scenario.payload, scenario, cycle, index + 1))
    );
    await publish(session, scenario.keyexpr, payload, 'application/json');
    bytes += payload.byteLength;
    await waitBetween(index, count, intervalMs);
  }
  return { sent: count, bytes };
};

const withSequence = (
  base: Record<string, unknown>,
  scenario: ScenarioBase,
  cycle: number,
  sequence: number
): Record<string, unknown> => ({
  ...base,
  scenario: scenario.id,
  cycle,
  sequence,
  sentAt: new Date().toISOString(),
  sentAtMs: Date.now()
});

const buildBinaryPayload = (size: number, cycle: number, sequence: number): Uint8Array => {
  const payload = new Uint8Array(size);
  for (let index = 0; index < payload.length; index += 1) {
    payload[index] = (index + cycle * 17 + sequence * 31) % 256;
  }
  return payload;
};

const buildLargeJsonPayload = (
  scenario: LargeJsonScenario,
  cycle: number,
  sequence: number
): Uint8Array => {
  const targetBytes = scenario.sizeKiB * 1024;
  const base = withSequence(
    { source: 'carto-scenario-runner', targetBytes, blob: '' },
    scenario,
    cycle,
    sequence
  );
  const empty = JSON.stringify(base);
  base.blob = fillString(Math.max(0, targetBytes - Buffer.byteLength(empty)));
  return textEncoder.encode(JSON.stringify(base));
};

const publish = async (
  session: ZenohSession,
  keyexpr: string,
  payload: Uint8Array,
  encoding: string
): Promise<void> => {
  if (!session.put) throw new Error('Zenoh session does not support put operations.');
  await session.put(keyexpr, payload, { encoding });
};

const buildProtoRoots = (settings: SettingsFile): Map<string, protobuf.Root> => {
  const roots = new Map<string, protobuf.Root>();
  for (const schema of settings.data?.protoSchemas ?? []) {
    roots.set(schema.id, protobuf.parse(schema.source).root);
  }
  return roots;
};

const loadSettings = async (path: string): Promise<SettingsFile> => {
  const absolute = resolve(path);
  const raw = await readFile(absolute, 'utf8');
  return JSON.parse(raw) as SettingsFile;
};

const selectScenarios = (scenarios: Scenario[], selectedIds: string[]): Scenario[] => {
  if (selectedIds.length === 0) return scenarios;
  const selected = new Set(selectedIds);
  const unknown = selectedIds.filter((id) => !scenarios.some((scenario) => scenario.id === id));
  if (unknown.length > 0) throw new Error(`Unknown scenario(s): ${unknown.join(', ')}.`);
  return scenarios.filter((scenario) => selected.has(scenario.id));
};

const validatePack = (pack: ScenarioPack): void => {
  if (!pack.id || !pack.defaultEndpoint || !pack.rootKeyexpr) {
    throw new Error('Scenario pack is missing id, defaultEndpoint, or rootKeyexpr.');
  }
  if (!Array.isArray(pack.scenarios) || pack.scenarios.length === 0) {
    throw new Error('Scenario pack has no scenarios.');
  }
  const ids = new Set<string>();
  for (const scenario of pack.scenarios) {
    if (!scenario.id || !scenario.label || !scenario.keyexpr || !scenario.kind) {
      throw new Error('Scenario entries require id, label, keyexpr, and kind.');
    }
    if (ids.has(scenario.id)) throw new Error(`Duplicate scenario id: ${scenario.id}.`);
    ids.add(scenario.id);
    if (!scenario.keyexpr.startsWith(pack.rootKeyexpr.replace(/\*+$/, ''))) {
      throw new Error(`${scenario.id} is outside root key expression ${pack.rootKeyexpr}.`);
    }
  }
};

const parseArgs = (args: string[]): Options => {
  const options: Options = {
    packPath: DEFAULT_PACK_PATH,
    scenarioIds: [],
    cycles: 1,
    continuous: true,
    paceMultiplier: 1,
    timeoutMs: 5000,
    listOnly: false
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const value = args[index + 1];
    switch (arg) {
      case '--endpoint':
        options.endpoint = requireValue(arg, value);
        index += 1;
        break;
      case '--pack':
        options.packPath = requireValue(arg, value);
        index += 1;
        break;
      case '--scenario':
        options.scenarioIds.push(...requireValue(arg, value).split(',').filter(Boolean));
        index += 1;
        break;
      case '--cycles':
        options.cycles = parsePositiveNumber(arg, value);
        options.continuous = false;
        index += 1;
        break;
      case '--once':
        options.cycles = 1;
        options.continuous = false;
        break;
      case '--continuous':
        options.continuous = true;
        break;
      case '--pace':
        options.paceMultiplier = parseNonNegativeNumber(arg, value);
        index += 1;
        break;
      case '--timeout-ms':
        options.timeoutMs = parsePositiveNumber(arg, value);
        index += 1;
        break;
      case '--list':
        options.listOnly = true;
        break;
      case '--help':
        printHelp();
        process.exit(0);
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
};

const printScenarioList = (pack: ScenarioPack, scenarios: Scenario[]): void => {
  console.log(`${pack.label} (${pack.id}@${pack.version})`);
  console.log(`Import the same file into Carto Settings: ${resolve(DEFAULT_PACK_PATH)}`);
  for (const scenario of scenarios) {
    console.log(`- ${scenario.id.padEnd(16)} ${scenario.kind.padEnd(10)} ${scenario.keyexpr}`);
    console.log(`  ${scenario.label}`);
  }
};

const printHelp = (): void => {
  console.log(`Usage:
  npm run scenario:run -- [options]

Options:
  --endpoint <url>       Override the pack's Zenoh WebSocket endpoint
  --pack <path>          Carto settings/scenario JSON file
  --scenario <ids>       Run one or more comma-separated scenario ids
  --once                 Run one cycle and exit
  --cycles <count>       Run a finite number of cycles and exit
  --continuous           Run until Ctrl+C (the default)
  --pace <multiplier>    Scale waits; 0 runs without intentional delays
  --timeout-ms <ms>      Zenoh message response timeout
  --list                 Print scenarios without connecting
  --help                 Show this help

Examples:
  npm run scenario:list
  npm run scenario:run
  npm run scenario:run -- --once
  npm run scenario:run -- --scenario telemetry-json,protobuf-telemetry --cycles 3
  npm run scenario:run -- --pace 0 --scenario burst
`);
};

const ensureWebSocket = (): void => {
  const globalWithWebSocket = globalThis as { WebSocket?: typeof NodeWebSocket };
  if (typeof globalWithWebSocket.WebSocket !== 'function') {
    globalWithWebSocket.WebSocket = NodeWebSocket;
  }
};

const loadZenohModule = async (): Promise<ZenohModule> =>
  importZenohModule('@eclipse-zenoh/zenoh-ts');

const requireValue = (flag: string, value: string | undefined): string => {
  if (!value) throw new Error(`Missing value for ${flag}.`);
  return value;
};

const parsePositiveNumber = (flag: string, value: string | undefined): number => {
  const parsed = Number(requireValue(flag, value));
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${flag} must be greater than zero.`);
  }
  return parsed;
};

const parseNonNegativeNumber = (flag: string, value: string | undefined): number => {
  const parsed = Number(requireValue(flag, value));
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${flag} must be zero or greater.`);
  }
  return parsed;
};

const waitBetween = async (index: number, count: number, intervalMs: number): Promise<void> => {
  if (index + 1 < count && intervalMs > 0) await sleep(intervalMs);
};

const fillString = (length: number): string => {
  const chunk = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let output = '';
  while (output.length < length) output += chunk;
  return output.slice(0, length);
};

const formatBytes = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MiB`;
};

const sleep = (ms: number): Promise<void> =>
  new Promise((resolveSleep) => {
    setTimeout(resolveSleep, ms);
  });

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(message);
  process.exit(1);
});
