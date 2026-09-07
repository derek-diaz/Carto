import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CartoMessageBatchEvent, Capabilities } from '../shared/types';
import type { DriverMessage, SubscribeOptions, ZenohDriver } from '../zenoh/driver';
import { createCartoBackend } from './cartoBackend';

const CAPABILITIES: Capabilities = {
  driver: 'test',
  features: ['subscribe']
};

const createFakeDriver = () => {
  const subscriptions = new Map<string, SubscribeOptions>();
  let rejectedKeyexpr: string | null = null;

  const driver: ZenohDriver = {
    connect: async () => CAPABILITIES,
    disconnect: async () => {},
    subscribe: async (options) => {
      if (options.keyexpr === rejectedKeyexpr) {
        throw new Error(`Rejected ${options.keyexpr}`);
      }
      subscriptions.set(options.subscriptionId, options);
    },
    unsubscribe: async (subscriptionId) => {
      subscriptions.delete(subscriptionId);
    },
    publish: async () => {},
    declareQueryable: async () => {},
    undeclareQueryable: async () => {}
  };

  return {
    driver,
    rejectKeyexpr: (keyexpr: string) => {
      rejectedKeyexpr = keyexpr;
    },
    emit: (subscriptionId: string, message: DriverMessage) => {
      const subscription = subscriptions.get(subscriptionId);
      if (!subscription) throw new Error('Test subscription is not attached.');
      subscription.onMessage(message);
    }
  };
};

describe('createCartoBackend', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const setup = async (bufferSize = 10) => {
    const fake = createFakeDriver();
    const backend = createCartoBackend({ createDriver: () => fake.driver });
    const batches: CartoMessageBatchEvent[] = [];
    backend.setEventSink({
      sendMessage: (batch) => batches.push(batch),
      sendStatus: () => {}
    });
    await backend.connect({
      endpoint: 'ws://test/',
      reconnect: { enabled: false },
      healthCheckIntervalMs: 0
    });
    const subscriptionId = await backend.subscribe('carto/**', bufferSize);
    return { backend, batches, fake, subscriptionId };
  };

  it('does not overlap health checks or let an old check disconnect a new session', async () => {
    const first = createFakeDriver();
    const second = createFakeDriver();
    let rejectCheck!: (error: Error) => void;
    first.driver.healthCheck = vi.fn(
      () =>
        new Promise<void>((_, reject) => {
          rejectCheck = reject;
        })
    );
    const backend = createCartoBackend({
      createDriver: vi.fn().mockReturnValueOnce(first.driver).mockReturnValue(second.driver)
    });
    await backend.connect({
      endpoint: 'ws://first/',
      healthCheckIntervalMs: 100,
      reconnect: { enabled: false }
    });
    await vi.advanceTimersByTimeAsync(500);
    expect(first.driver.healthCheck).toHaveBeenCalledTimes(1);
    await backend.connect({
      endpoint: 'ws://second/',
      healthCheckIntervalMs: 0,
      reconnect: { enabled: false }
    });
    rejectCheck(new Error('Old connection failed'));
    await vi.advanceTimersByTimeAsync(0);
    expect(backend.getStatus().connected).toBe(true);
    await backend.disconnect();
  });

  it('closes a connection probe that succeeds after its timeout', async () => {
    const fake = createFakeDriver();
    let finish!: (caps: Capabilities) => void;
    fake.driver.connect = () =>
      new Promise((resolve) => {
        finish = resolve;
      });
    const close = vi.spyOn(fake.driver, 'disconnect');
    const backend = createCartoBackend({ createDriver: () => fake.driver });
    const probe = backend.testConnection({ endpoint: 'ws://test/', timeoutMs: 100 });
    await vi.advanceTimersByTimeAsync(100);
    expect((await probe).ok).toBe(false);
    const closesAtTimeout = close.mock.calls.length;
    finish(CAPABILITIES);
    await vi.advanceTimersByTimeAsync(0);
    expect(close.mock.calls.length).toBeGreaterThan(closesAtTimeout);
    await backend.disconnect();
  });

  it('decodes full payloads in a real worker without detaching retained bytes', async () => {
    vi.useRealTimers();
    const fake = createFakeDriver();
    const backend = createCartoBackend({ createDriver: () => fake.driver });
    const batches: CartoMessageBatchEvent[] = [];
    backend.setEventSink({ sendMessage: (batch) => batches.push(batch), sendStatus: () => {} });
    try {
      await backend.connect({ endpoint: 'ws://fixture/', healthCheckIntervalMs: 0 });
      const id = await backend.subscribe('carto/**');
      const json = { value: 'x'.repeat(1024 * 1024), sequence: 7 };
      const payload = new TextEncoder().encode(JSON.stringify(json));
      fake.emit(id, { key: 'carto/json', payload });
      await new Promise((resolve) => setTimeout(resolve, 30));
      const messageId = batches[0].msgs[0].id;
      const first = await backend.getMessage(id, messageId);
      expect(first).toMatchObject({ payloadLoaded: true, json });
      expect(first?.base64).toBe(Buffer.from(payload).toString('base64'));
      const second = await backend.getMessage(id, messageId);
      expect(second?.json).toEqual(json);
      expect(payload.byteLength).toBeGreaterThan(1024 * 1024);
    } finally {
      await backend.disconnect();
    }
  });

  it('shares payload retention across subscriptions while preserving stream summaries and counters', async () => {
    vi.useRealTimers();
    const fake = createFakeDriver();
    const backend = createCartoBackend({
      createDriver: () => fake.driver,
      maxRetainedPayloadBytes: 8192
    });
    const batches: CartoMessageBatchEvent[] = [];
    backend.setEventSink({ sendMessage: (batch) => batches.push(batch), sendStatus: () => {} });
    try {
      await backend.connect({ endpoint: 'ws://fixture/', healthCheckIntervalMs: 0 });
      const ids = await Promise.all(['a', 'b', 'c'].map((key) => backend.subscribe(key)));
      for (const id of ids)
        fake.emit(id, { key: 'overlapping/key', payload: new Uint8Array(4096).fill(97) });
      await new Promise((resolve) => setTimeout(resolve, 30));
      const messages = ids.map(
        (id) => batches.find((batch) => batch.subscriptionId === id)!.msgs[0]
      );
      expect(await backend.getMessage(ids[0], messages[0].id)).toMatchObject({
        payloadUnavailable: expect.stringContaining('retention limit')
      });
      expect(await backend.getMessage(ids[1], messages[1].id)).toMatchObject({
        payloadLoaded: true,
        sizeBytes: 4096
      });
      expect(await backend.getMessage(ids[2], messages[2].id)).toMatchObject({
        payloadLoaded: true,
        sizeBytes: 4096
      });
      expect(
        batches.every(
          (batch) =>
            batch.capture?.received === 1 &&
            batch.capture.retained === 1 &&
            batch.capture.skipped === 0
        )
      ).toBe(true);
      await backend.clearBuffer(ids[1]);
      fake.emit(ids[0], { key: 'new/key', payload: new Uint8Array(4096).fill(98) });
      await new Promise((resolve) => setTimeout(resolve, 30));
      // Clearing b freed capacity, so c remains available after a publishes again.
      expect(await backend.getMessage(ids[2], messages[2].id)).toMatchObject({
        payloadLoaded: true
      });
    } finally {
      await backend.disconnect();
    }
  });

  it('runs an opted-in discovery scan without creating monitor batches', async () => {
    const fake = createFakeDriver();
    const attach = vi.spyOn(fake.driver, 'subscribe');
    const backend = createCartoBackend({ createDriver: () => fake.driver });
    const sendMessage = vi.fn();
    backend.setEventSink({ sendMessage, sendStatus: () => {} });
    await backend.connect({
      endpoint: 'ws://test/',
      reconnect: { enabled: false },
      healthCheckIntervalMs: 0,
      discovery: { enabled: true, keyexpr: 'robots/**', durationSeconds: 15 }
    });
    const id = attach.mock.calls[0][0].subscriptionId;
    fake.emit(id, { key: 'robots/atlas/state', payload: new TextEncoder().encode('ready') });
    await vi.advanceTimersByTimeAsync(15000);
    expect(backend.getDiscovery()).toMatchObject({
      state: 'complete',
      received: 1,
      reason: 'timeout'
    });
    expect(sendMessage).not.toHaveBeenCalled();
    expect(backend.getRecentKeys()).toEqual([]);
    await backend.disconnect();
    expect(backend.getDiscovery().keys).toHaveLength(1);
    await backend.connect({ endpoint: 'ws://other/', healthCheckIntervalMs: 0 });
    expect(backend.getDiscovery().state).toBe('idle');
    expect(attach).toHaveBeenCalledOnce();
    await backend.disconnect();
  });

  it('replays messages received while a stream is paused', async () => {
    const { backend, batches, fake, subscriptionId } = await setup();
    fake.emit(subscriptionId, { key: 'carto/one', payload: new TextEncoder().encode('one') });
    await vi.advanceTimersByTimeAsync(20);
    expect(batches.flatMap((batch) => batch.msgs)).toHaveLength(1);

    await backend.pause(subscriptionId, true);
    fake.emit(subscriptionId, { key: 'carto/two', payload: new TextEncoder().encode('two') });
    await vi.advanceTimersByTimeAsync(20);
    expect(batches.flatMap((batch) => batch.msgs)).toHaveLength(1);
    expect(
      backend.getRecentKeys(undefined, subscriptionId).find((entry) => entry.key === 'carto/two')
        ?.count
    ).toBe(1);

    await backend.pause(subscriptionId, false);
    const messages = batches.flatMap((batch) => batch.msgs);
    expect(messages.map((message) => message.key)).toEqual(['carto/one', 'carto/two']);
    await backend.disconnect();
  });

  it('restores the previous buffer size when a subscription update rolls back', async () => {
    const { backend, batches, fake, subscriptionId } = await setup(3);
    fake.rejectKeyexpr('rejected/**');

    await expect(backend.updateSubscription(subscriptionId, 'rejected/**', 1)).rejects.toThrow(
      'Rejected rejected/**'
    );
    await backend.pause(subscriptionId, true);
    for (let index = 0; index < 3; index += 1) {
      fake.emit(subscriptionId, {
        key: `carto/${index}`,
        payload: new TextEncoder().encode(String(index))
      });
    }
    await backend.pause(subscriptionId, false);

    expect(batches.flatMap((batch) => batch.msgs)).toHaveLength(3);
    await backend.disconnect();
  });

  it('classifies invalid UTF-8 as binary', async () => {
    const { backend, batches, fake, subscriptionId } = await setup();
    fake.emit(subscriptionId, { key: 'carto/binary', payload: Uint8Array.from([255, 254, 253]) });
    await vi.advanceTimersByTimeAsync(20);

    const message = batches.flatMap((batch) => batch.msgs)[0];
    expect(message?.encoding).toBe('binary');
    expect(message?.previewText).toMatch(/^base64:/);
    await backend.disconnect();
  });

  it('preserves put/delete semantics and original wire encoding', async () => {
    const { backend, batches, fake, subscriptionId } = await setup();
    fake.emit(subscriptionId, {
      key: 'carto/state',
      payload: new Uint8Array(),
      kind: 'delete',
      wireEncoding: 'application/custom;v=2',
      ts: 1234
    });
    await vi.advanceTimersByTimeAsync(20);
    expect(batches[0].msgs[0]).toMatchObject({
      kind: 'delete',
      wireEncoding: 'application/custom;v=2',
      ts: 1234,
      receivedAt: expect.any(Number)
    });
    expect(batches[0].msgs[0].payloadLoaded).toBeUndefined();
    await backend.disconnect();
  });

  it('reports paused overflow without calling it network loss and resets capture counters on clear', async () => {
    const { backend, batches, fake, subscriptionId } = await setup(3);
    await backend.pause(subscriptionId, true);
    for (let index = 0; index < 5; index++)
      fake.emit(subscriptionId, { key: `carto/${index}`, payload: new Uint8Array() });
    await vi.advanceTimersByTimeAsync(20);
    expect(batches.at(-1)).toMatchObject({
      msgs: [],
      capture: { received: 5, skipped: 2, retained: 3, limit: 3 }
    });
    await backend.pause(subscriptionId, false);
    expect(batches.flatMap((batch) => batch.msgs).map((message) => message.key)).toEqual([
      'carto/2',
      'carto/3',
      'carto/4'
    ]);
    await backend.clearBuffer(subscriptionId);
    expect(batches.at(-1)?.capture).toEqual({ received: 0, skipped: 0, retained: 0, limit: 3 });
    await backend.disconnect();
  });

  it('reports burst display overflow separately from retained backend messages', async () => {
    const { backend, batches, fake, subscriptionId } = await setup(100);
    for (let index = 0; index < 80; index++)
      fake.emit(subscriptionId, { key: `carto/${index}`, payload: new Uint8Array() });
    await vi.advanceTimersByTimeAsync(20);
    expect(batches.at(-1)?.capture).toEqual({
      received: 80,
      skipped: 16,
      retained: 80,
      limit: 100
    });
    expect(batches.flatMap((batch) => batch.msgs)).toHaveLength(64);
    await backend.disconnect();
  });

  it('marks expired payloads as unavailable instead of replacing their data with an error string', async () => {
    const { backend, batches, fake, subscriptionId } = await setup(300);
    fake.emit(subscriptionId, {
      key: 'carto/first',
      payload: new TextEncoder().encode('original')
    });
    await vi.advanceTimersByTimeAsync(20);
    const first = batches[0].msgs[0];
    for (let index = 0; index < 256; index++)
      fake.emit(subscriptionId, { key: 'carto/later', payload: new Uint8Array([index % 255]) });
    const expired = await backend.getMessage(subscriptionId, first.id);
    expect(expired?.payloadUnavailable).toContain('expired');
    expect(expired?.text).toBeUndefined();
    expect(expired?.payloadLoaded).not.toBe(true);
    await backend.disconnect();
  });

  it('preserves a supplied encoding when publishing a binary draft', async () => {
    const { backend, fake } = await setup();
    const publish = vi.spyOn(fake.driver, 'publish');
    await backend.publish({
      keyexpr: 'carto/test',
      encoding: 'base64',
      payload: 'AQI=',
      wireEncoding: 'application/protobuf'
    });
    expect(publish).toHaveBeenCalledWith({
      keyexpr: 'carto/test',
      payload: new Uint8Array([1, 2]),
      encoding: 'application/protobuf'
    });
    await backend.disconnect();
  });
});
