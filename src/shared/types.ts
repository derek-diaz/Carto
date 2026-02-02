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
  health?: ConnectionHealth;
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
  auth?: AuthConfig;
  tls?: TlsConfig;
  reconnect?: ReconnectConfig;
  healthCheckIntervalMs?: number;
};

export type AuthConfig = {
  type: 'none' | 'basic' | 'bearer' | 'header';
  username?: string;
  password?: string;
  token?: string;
  headerName?: string;
  headerValue?: string;
};

export type TlsConfig = {
  caPath?: string;
  certPath?: string;
  keyPath?: string;
  rejectUnauthorized?: boolean;
};

export type ReconnectConfig = {
  enabled: boolean;
  baseDelayMs?: number;
  maxDelayMs?: number;
  maxAttempts?: number;
  jitter?: boolean;
};

export type ConnectionHealth = {
  state: 'disconnected' | 'connecting' | 'connected' | 'reconnecting';
  attempt?: number;
  nextRetryMs?: number;
  lastError?: string;
  lastConnectedAt?: number;
  lastDisconnectedAt?: number;
  lastHeartbeatAt?: number;
};

export type ConnectionTestParams = {
  endpoint: string;
  configJson?: string;
  auth?: AuthConfig;
  tls?: TlsConfig;
  timeoutMs?: number;
};

export type ConnectionTestResult = {
  ok: boolean;
  durationMs: number;
  error?: string;
  hint?: string;
  capabilities?: Capabilities;
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
  subscriptionId?: string;
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
