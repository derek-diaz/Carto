import type {
  CartoMessageEvent,
  ConnectionStatus,
  ConnectParams,
  ClearBufferParams,
  ConnectionTestParams,
  ConnectionTestResult,
  GetRecentKeysParams,
  PauseParams,
  PublishParams,
  RecentKeyStats,
  SubscribeParams,
  UnsubscribeParams
} from '@shared/types';

type CartoApi = {
  connect: (params: ConnectParams) => Promise<void>;
  testConnection: (params: ConnectionTestParams) => Promise<ConnectionTestResult>;
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

declare global {
  interface Window {
    carto: CartoApi;
  }
}

export {};
