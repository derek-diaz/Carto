import { describe, expect, it, vi } from 'vitest';
import { createRemoteApiWsDriver } from './remoteApiWsDriver';
const caps = { info: async () => ({}) };
describe('remote driver cleanup', () => {
  it('closes queryables and the session even when subscription cleanup fails', async () => {
    const close = vi.fn(async () => {});
    const closeQuery = vi.fn(async () => {});
    const driver = createRemoteApiWsDriver({
      loadModule: async () => ({
        open: async () => ({
          ...caps,
          close,
          declareSubscriber: async () => ({
            undeclare: async () => {
              throw new Error('unsubscribe failed');
            }
          }),
          declareQueryable: async () => ({ undeclare: closeQuery })
        })
      })
    });
    await driver.connect({ endpoint: 'ws://fixture.invalid:10000/' });
    await driver.subscribe({ subscriptionId: 's', keyexpr: 'a', onMessage: () => {} });
    await driver.declareQueryable({
      queryableId: 'q',
      keyexpr: 'a',
      payload: new Uint8Array(),
      complete: false
    });
    await expect(driver.disconnect()).rejects.toThrow('unsubscribe failed');
    expect(closeQuery).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
    await expect(driver.healthCheck!()).rejects.toThrow('Not connected');
  });
  it('closes a temporary publisher after a failed put and preserves the publish error', async () => {
    const close = vi.fn(async () => {
      throw new Error('close failed');
    });
    const driver = createRemoteApiWsDriver({
      loadModule: async () => ({
        open: async () => ({
          ...caps,
          declarePublisher: async () => ({
            put: async () => {
              throw new Error('publish failed');
            },
            undeclare: close
          })
        })
      })
    });
    await driver.connect({ endpoint: 'ws://fixture.invalid:10000/' });
    await expect(driver.publish({ keyexpr: 'a', payload: new Uint8Array() })).rejects.toThrow(
      'publish failed'
    );
    expect(close).toHaveBeenCalledOnce();
    await driver.disconnect();
  });
  it('closes a subscriber whose declaration finishes after disconnect', async () => {
    const close = vi.fn(async () => {});
    let finish!: (value: { undeclare: typeof close }) => void;
    const driver = createRemoteApiWsDriver({
      loadModule: async () => ({
        open: async () => ({
          ...caps,
          declareSubscriber: () =>
            new Promise((resolve) => {
              finish = resolve;
            })
        })
      })
    });
    await driver.connect({ endpoint: 'ws://fixture.invalid:10000/' });
    const pending = driver.subscribe({ subscriptionId: 's', keyexpr: 'a', onMessage: () => {} });
    const rejected = expect(pending).rejects.toThrow('Connection closed');
    await driver.disconnect();
    finish({ undeclare: close });
    await rejected;
    expect(close).toHaveBeenCalledOnce();
  });
});
