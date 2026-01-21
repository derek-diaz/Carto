import { contextBridge, ipcRenderer } from 'electron';
import type {
  CartoMessageEvent,
  ConnectionStatus,
  ConnectParams,
  ClearBufferParams,
  GetRecentKeysParams,
  PauseParams,
  PublishParams,
  RecentKeyStats,
  SubscribeParams,
  UnsubscribeParams
} from '../shared/types';

export type CartoApi = {
  connect: (params: ConnectParams) => Promise<void>;
  disconnect: () => Promise<void>;
  subscribe: (params: SubscribeParams) => Promise<string>;
  unsubscribe: (params: UnsubscribeParams) => Promise<void>;
  pause: (params: PauseParams) => Promise<void>;
  getRecentKeys: (params?: GetRecentKeysParams) => Promise<RecentKeyStats[]>;
  clearBuffer: (params: ClearBufferParams) => Promise<void>;
  publish: (params: PublishParams) => Promise<void>;
  onMessage: (callback: (event: CartoMessageEvent) => void) => () => void;
  onStatus: (callback: (status: ConnectionStatus) => void) => () => void;
};

const api: CartoApi = {
  connect: (params) => ipcRenderer.invoke('carto.connect', params),
  disconnect: () => ipcRenderer.invoke('carto.disconnect'),
  subscribe: (params) => ipcRenderer.invoke('carto.subscribe', params),
  unsubscribe: (params) => ipcRenderer.invoke('carto.unsubscribe', params),
  pause: (params) => ipcRenderer.invoke('carto.pause', params),
  getRecentKeys: (params) => ipcRenderer.invoke('carto.getRecentKeys', params ?? {}),
  clearBuffer: (params) => ipcRenderer.invoke('carto.clearBuffer', params),
  publish: (params) => ipcRenderer.invoke('carto.publish', params),
  onMessage: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: CartoMessageEvent) => {
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
