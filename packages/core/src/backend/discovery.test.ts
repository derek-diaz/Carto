import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDiscovery } from './discovery';
import type { SubscribeOptions, ZenohDriver } from '../zenoh/driver';

const setup = () => {
  let subscription: SubscribeOptions | undefined;
  const driver: ZenohDriver = {
    connect: vi.fn(),
    disconnect: vi.fn(),
    publish: vi.fn(),
    declareQueryable: vi.fn(),
    undeclareQueryable: vi.fn(),
    subscribe: vi.fn(async (options) => {
      subscription = options;
    }),
    unsubscribe: vi.fn(async () => {})
  };
  const onFailure = vi.fn(async () => {});
  const discovery = createDiscovery(onFailure);
  const emit = (key: string, text = 'hello') =>
    subscription?.onMessage({
      key,
      payload: new TextEncoder().encode(text),
      wireEncoding: 'text/plain',
      kind: 'put',
      ts: 1
    });
  return { driver, discovery, emit, onFailure };
};

describe('bounded traffic discovery', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());
  it('automatically undeclares its subscription and preserves a scan with arrival times', async () => {
    const { driver, discovery, emit } = setup();
    await discovery.start(driver, { keyexpr: 'robots/**', durationSeconds: 15 });
    emit('robots/atlas/state');
    await vi.advanceTimersByTimeAsync(1000);
    emit('robots/atlas/state', 'ready');
    const before = discovery.get();
    expect(before.keys[0]).toMatchObject({
      count: 2,
      bytes: 10,
      preview: 'ready',
      previewBase64: Buffer.from('ready').toString('base64'),
      wireEncoding: 'text/plain',
      lastSeen: Date.now()
    });
    await vi.advanceTimersByTimeAsync(14000);
    expect(driver.unsubscribe).toHaveBeenCalledOnce();
    expect(discovery.get()).toMatchObject({ state: 'complete', reason: 'timeout', received: 2 });
    emit('robots/late');
    expect(discovery.get().keys).toHaveLength(1);
  });
  it('limits keys and preview bytes without retaining full payloads', async () => {
    const { driver, discovery, emit } = setup();
    await discovery.start(driver, { keyexpr: '**', durationSeconds: 15 });
    for (let index = 0; index < 1002; index++) emit(`key/${index}`, 'x'.repeat(2048));
    const result = discovery.get();
    expect(result.keys).toHaveLength(1000);
    expect(result.omitted).toBe(2);
    expect(result.received).toBe(1002);
    expect(result.keys[0]).toMatchObject({
      preview: 'x'.repeat(512),
      previewTruncated: true,
      previewBase64: Buffer.from('x'.repeat(512)).toString('base64'),
      lastSize: 2048
    });
  });
  it('stops early once and replaces results only when a new scan starts', async () => {
    const { driver, discovery, emit } = setup();
    await discovery.start(driver, { keyexpr: '**', durationSeconds: 15 });
    emit('old/key');
    await discovery.stop();
    await discovery.stop();
    await vi.advanceTimersByTimeAsync(15000);
    expect(driver.unsubscribe).toHaveBeenCalledOnce();
    expect(discovery.get().keys).toHaveLength(1);
    await discovery.start(driver, { keyexpr: 'new/**', durationSeconds: 30 });
    expect(discovery.get().keys).toEqual([]);
    emit('new/key');
    expect(discovery.get().received).toBe(1);
    discovery.cancel();
  });
  it('rejects invalid or overlapping scans without changing the active scan', async () => {
    const { driver, discovery } = setup();
    await expect(
      discovery.start(driver, { keyexpr: '**', durationSeconds: Infinity })
    ).rejects.toThrow('duration');
    await expect(
      discovery.start(driver, { keyexpr: 'bad//key', durationSeconds: 15 })
    ).rejects.toThrow('separators');
    expect(driver.subscribe).not.toHaveBeenCalled();
    await discovery.start(driver, { keyexpr: '**', durationSeconds: 15 });
    await expect(
      discovery.start(driver, { keyexpr: 'other/**', durationSeconds: 15 })
    ).rejects.toThrow('already running');
    discovery.cancel();
  });
  it('cleans up a subscription that completes after a disconnect', async () => {
    const { driver, discovery } = setup();
    let finish!: () => void;
    vi.mocked(driver.subscribe).mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    );
    const starting = discovery.start(driver, { keyexpr: '**', durationSeconds: 15 });
    discovery.cancel();
    finish();
    await starting;
    expect(driver.unsubscribe).toHaveBeenCalledOnce();
    expect(discovery.get()).toMatchObject({ state: 'complete', reason: 'disconnected' });
    await vi.advanceTimersByTimeAsync(20000);
    expect(driver.unsubscribe).toHaveBeenCalledOnce();
  });
  it('reports declaration failures and allows a retry', async () => {
    const { driver, discovery } = setup();
    vi.mocked(driver.subscribe).mockRejectedValueOnce(new Error('Access denied'));
    await expect(discovery.start(driver, { keyexpr: '**', durationSeconds: 15 })).rejects.toThrow(
      'Access denied'
    );
    expect(discovery.get()).toMatchObject({ state: 'error', error: 'Access denied' });
    await discovery.start(driver, { keyexpr: 'allowed/**', durationSeconds: 15 });
    expect(discovery.get().state).toBe('running');
    discovery.cancel();
  });
  it('requests connection recovery if undeclaration fails instead of claiming a clean stop', async () => {
    const { driver, discovery, onFailure } = setup();
    vi.mocked(driver.unsubscribe).mockRejectedValue(new Error('Transport failure'));
    await discovery.start(driver, { keyexpr: '**', durationSeconds: 15 });
    await vi.advanceTimersByTimeAsync(15000);
    expect(onFailure).toHaveBeenCalledOnce();
    expect(discovery.get().state).toBe('error');
  });
  it('does not let callers mutate retained evidence', async () => {
    const { driver, discovery, emit } = setup();
    await discovery.start(driver, { keyexpr: '**', durationSeconds: 15 });
    emit('a');
    discovery.get().keys[0].count = 500;
    expect(discovery.get().keys[0].count).toBe(1);
    discovery.cancel();
  });

  it('keeps UTF-8 previews valid at the byte limit and represents binary and delete samples', async () => {
    const { driver, discovery, emit } = setup();
    await discovery.start(driver, { keyexpr: '**', durationSeconds: 15 });
    emit('unicode', 'x' + '🙂'.repeat(150));
    const handler = vi.mocked(driver.subscribe).mock.calls[0][0].onMessage;
    handler({ key: 'binary', payload: new Uint8Array([0, 255]), kind: 'put' });
    handler({ key: 'deleted', payload: new Uint8Array(), kind: 'delete' });
    expect(discovery.get().keys[0]).toMatchObject({
      preview: 'x' + '🙂'.repeat(127),
      previewTruncated: true
    });
    expect(discovery.get().keys[1].preview).toBe('Base64 · AP8=');
    expect(discovery.get().keys[1].previewBase64).toBe('AP8=');
    expect(discovery.get().keys[2].previewBase64).toBeUndefined();
    expect(discovery.get().keys[2]).toMatchObject({
      preview: 'Key deleted',
      kind: 'delete',
      lastSize: 0
    });
    discovery.cancel();
  });

  it('cleans up declarations that finish after an early stop', async () => {
    const { driver, discovery } = setup();
    let finish!: () => void;
    vi.mocked(driver.subscribe).mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    );
    const starting = discovery.start(driver, { keyexpr: '**', durationSeconds: 15 });
    await discovery.stop();
    finish();
    await starting;
    expect(driver.unsubscribe).toHaveBeenCalledTimes(2);
    expect(discovery.get()).toMatchObject({ state: 'complete', reason: 'stopped' });
    await vi.advanceTimersByTimeAsync(15000);
    expect(driver.unsubscribe).toHaveBeenCalledTimes(2);
  });
});
