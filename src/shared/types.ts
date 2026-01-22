export type CartoMessage = {
  id: string;
  ts: number;
  key: string;
  encoding: 'json' | 'text' | 'binary';
  sizeBytes: number;
  json?: unknown;
  text?: string;
  base64?: string;
};

export type CartoMessageEvent = {
  subscriptionId: string;
  msg: CartoMessage;
};

export type Capabilities = {
  driver: string;
  zenoh?: string;
  remoteApi?: string;
  features: string[];
  info?: Record<string, unknown>;
};

export type ConnectionStatus = {
  connected: boolean;
  error?: string;
  capabilities?: Capabilities;
};

export type RecentKeyStats = {
  key: string;
  count: number;
  lastSeen: number;
  bytes: number;
  lastSize: number;
};

export type ConnectParams = {
  endpoint: string;
  mode?: 'client';
  configJson?: string;
};

export type SubscribeParams = {
  keyexpr: string;
  bufferSize?: number;
};

export type PauseParams = {
  subscriptionId: string;
  paused: boolean;
};

export type UnsubscribeParams = {
  subscriptionId: string;
};

export type GetRecentKeysParams = {
  filter?: string;
};

export type ClearBufferParams = {
  subscriptionId: string;
};

export type PublishEncoding = 'json' | 'text' | 'base64';

export type PublishParams = {
  keyexpr: string;
  payload: string;
  encoding: PublishEncoding;
};
