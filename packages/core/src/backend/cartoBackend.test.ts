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
});
