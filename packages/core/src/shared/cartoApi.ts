import type {
  CartoMessagePayload,
  CartoMessage,
  ConnectionStatus,
  ConnectParams,
  ClearBufferParams,
  ConnectionTestParams,
  ConnectionTestResult,
  GetMessageParams,
  GetRecentKeysParams,
  PauseParams,
  PublishParams,
  RecentKeyStats,
  SubscribeParams,
  UnsubscribeParams
} from './types';

export type CartoApi = {
  connect: (params: ConnectParams) => Promise<void>;
  testConnection: (params: ConnectionTestParams) => Promise<ConnectionTestResult>;
  disconnect: () => Promise<void>;
  subscribe: (params: SubscribeParams) => Promise<string>;
  unsubscribe: (params: UnsubscribeParams) => Promise<void>;
  pause: (params: PauseParams) => Promise<void>;
  getMessage: (params: GetMessageParams) => Promise<CartoMessage | null>;
  getRecentKeys: (params?: GetRecentKeysParams) => Promise<RecentKeyStats[]>;
  clearBuffer: (params: ClearBufferParams) => Promise<void>;
  publish: (params: PublishParams) => Promise<void>;
  onMessage: (callback: (payload: CartoMessagePayload) => void) => () => void;
  onStatus: (callback: (status: ConnectionStatus) => void) => () => void;
};
