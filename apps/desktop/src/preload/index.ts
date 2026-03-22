import { contextBridge, ipcRenderer } from 'electron';
import type {
  CartoMessagePayload,
  ConnectionStatus
} from '../../../../packages/core/src/shared/types';
import type { CartoApi } from '../../../../packages/core/src/shared/cartoApi';

const api: CartoApi = {
  connect: (params) => ipcRenderer.invoke('carto.connect', params),
  testConnection: (params) => ipcRenderer.invoke('carto.testConnection', params),
  disconnect: () => ipcRenderer.invoke('carto.disconnect'),
  subscribe: (params) => ipcRenderer.invoke('carto.subscribe', params),
  unsubscribe: (params) => ipcRenderer.invoke('carto.unsubscribe', params),
  pause: (params) => ipcRenderer.invoke('carto.pause', params),
  getMessage: (params) => ipcRenderer.invoke('carto.getMessage', params),
  getRecentKeys: (params) => ipcRenderer.invoke('carto.getRecentKeys', params ?? {}),
  clearBuffer: (params) => ipcRenderer.invoke('carto.clearBuffer', params),
  publish: (params) => ipcRenderer.invoke('carto.publish', params),
  onMessage: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: CartoMessagePayload) => {
      callback(payload);
    };
    ipcRenderer.on('carto.message', listener);
    return () => ipcRenderer.removeListener('carto.message', listener);
  },
  onStatus: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: ConnectionStatus) => {
      callback(payload);
    };
    ipcRenderer.on('carto.status', listener);
    return () => ipcRenderer.removeListener('carto.status', listener);
  }
};

contextBridge.exposeInMainWorld('carto', api);

window.addEventListener('DOMContentLoaded', () => {
  document.documentElement.dataset.platform = process.platform;
});
