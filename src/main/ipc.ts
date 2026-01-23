import { ipcMain } from 'electron';
import type {
  ClearBufferParams,
  ConnectParams,
  GetRecentKeysParams,
  PauseParams,
  PublishParams,
  SubscribeParams,
  UnsubscribeParams
} from '../shared/types';
import type { CartoBackend } from './backend/cartoBackend';

export const registerIpc = (backend: CartoBackend): void => {
  ipcMain.handle('carto.connect', async (_event, params: ConnectParams) => {
    await backend.connect(params);
  });

  ipcMain.handle('carto.disconnect', async () => {
    await backend.disconnect();
  });

  ipcMain.handle('carto.subscribe', async (_event, params: SubscribeParams) => {
    return backend.subscribe(params.keyexpr, params.bufferSize);
  });

  ipcMain.handle('carto.unsubscribe', async (_event, params: UnsubscribeParams) => {
    await backend.unsubscribe(params.subscriptionId);
  });

  ipcMain.handle('carto.pause', async (_event, params: PauseParams) => {
    await backend.pause(params.subscriptionId, params.paused);
  });

  ipcMain.handle('carto.getRecentKeys', async (_event, params: GetRecentKeysParams) => {
    return backend.getRecentKeys(params?.filter, params?.subscriptionId);
  });

  ipcMain.handle('carto.clearBuffer', async (_event, params: ClearBufferParams) => {
    await backend.clearBuffer(params.subscriptionId);
  });

  ipcMain.handle('carto.publish', async (_event, params: PublishParams) => {
    await backend.publish(params);
  });
};
