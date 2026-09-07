import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCartoBackend, type CartoBackend } from './cartoBackend';
import type { CartoMessageBatchEvent } from '../shared/types';
import type { SubscribeOptions } from '../zenoh/driver';
const workers = vi.hoisted(() => ({
  instances: [] as {
    postMessage: ReturnType<typeof vi.fn>;
    terminate: ReturnType<typeof vi.fn>;
    emit: (event: string, payload: unknown) => boolean;
  }[]
}));
vi.mock('node:worker_threads', () => ({
  Worker: class extends EventEmitter {
    postMessage = vi.fn();
    terminate = vi.fn(async () => 0);
    constructor() {
      super();
      workers.instances.push(this);
    }
  }
}));
let backend: CartoBackend;
beforeEach(() => {
  vi.useFakeTimers();
  workers.instances = [];
});
afterEach(async () => {
  await backend?.disconnect();
  vi.useRealTimers();
});
async function setup() {
  let subscription!: SubscribeOptions;
  const batches: CartoMessageBatchEvent[] = [];
  backend = createCartoBackend({
    createDriver: () => ({
      connect: async () => ({ driver: 'test', features: ['subscribe'] }),
      disconnect: async () => {},
      subscribe: async (options) => {
        subscription = options;
      },
      unsubscribe: async () => {},
      publish: async () => {},
      declareQueryable: async () => {},
      undeclareQueryable: async () => {}
    })
  });
  backend.setEventSink({ sendMessage: (batch) => batches.push(batch), sendStatus: () => {} });
  await backend.connect({ endpoint: 'ws://fixture/', healthCheckIntervalMs: 0 });
  const id = await backend.subscribe('a');
  subscription.onMessage({ key: 'a', payload: new TextEncoder().encode('{"value":42}') });
  await vi.advanceTimersByTimeAsync(20);
  return { id, message: batches[0].msgs[0].id, emit: subscription.onMessage };
}
describe('bounded asynchronous payload inspection', () => {
  it('bounds pending requests and terminates stalled work without decoding on the main thread', async () => {
    const { id, message } = await setup();
    const pending = Array.from({ length: 4 }, () => backend.getMessage(id, message));
    expect(await backend.getMessage(id, message)).toMatchObject({
      payloadUnavailable: expect.stringContaining('busy')
    });
    expect(workers.instances[0].postMessage).toHaveBeenCalledTimes(4);
    await vi.advanceTimersByTimeAsync(5000);
    const results = await Promise.all(pending);
    expect(
      results.every((result) => result?.payloadUnavailable && !result.payloadLoaded && !result.json)
    ).toBe(true);
    expect(workers.instances[0].terminate).toHaveBeenCalledOnce();
  });
  it('does not revive cleared payloads when disconnect cancels inspection', async () => {
    const { id, message } = await setup();
    const pending = backend.getMessage(id, message);
    await backend.disconnect();
    expect(await pending).toBeNull();
    expect(workers.instances[0].terminate).toHaveBeenCalledOnce();
  });
  it('finishes an acquired payload even if newer traffic evicts its cache entry', async () => {
    const { id, message, emit } = await setup();
    await backend.updateSubscription(id, 'a', 1);
    const pending = backend.getMessage(id, message);
    emit({ key: 'a', payload: new Uint8Array([42]) });
    const worker = workers.instances[0];
    worker.emit('message', {
      requestId: worker.postMessage.mock.calls[0][0].requestId,
      result: { encoding: 'json', json: { value: 42 } }
    });
    expect(await pending).toMatchObject({ payloadLoaded: true, json: { value: 42 } });
  });

  it('discards a pending inspection when the user clears its buffer', async () => {
    const { id, message } = await setup();
    const pending = backend.getMessage(id, message);
    await backend.clearBuffer(id);
    const worker = workers.instances[0];
    worker.emit('message', {
      requestId: worker.postMessage.mock.calls[0][0].requestId,
      result: { encoding: 'json', json: { value: 42 } }
    });
    expect(await pending).toBeNull();
  });

  it('releases pending slots immediately when worker posting fails', async () => {
    const { id, message } = await setup();
    const pending = backend.getMessage(id, message);
    workers.instances[0].postMessage.mockImplementation(() => {
      throw new Error('post failed');
    });
    for (let i = 0; i < 8; i++)
      expect(await backend.getMessage(id, message)).toMatchObject({
        payloadUnavailable: 'post failed'
      });
    await backend.disconnect();
    await pending;
    expect(vi.getTimerCount()).toBe(0);
  });
});
