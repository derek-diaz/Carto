import type { Capabilities } from '../../shared/types';

export type DriverMessage = {
  key: string;
  payload: Uint8Array;
  ts?: number;
};

export type DriverStatus = {
  connected: boolean;
  error?: string;
  capabilities?: Capabilities;
};

export type ConnectOptions = {
  endpoint: string;
  configJson?: string;
  onStatus?: (status: DriverStatus) => void;
};

export type SubscribeOptions = {
  subscriptionId: string;
  keyexpr: string;
  onMessage: (msg: DriverMessage) => void;
};

export type PublishOptions = {
  keyexpr: string;
  payload: Uint8Array;
  encoding?: string;
};

export interface ZenohDriver {
  connect(options: ConnectOptions): Promise<Capabilities>;
  disconnect(): Promise<void>;
  subscribe(options: SubscribeOptions): Promise<void>;
  unsubscribe(subscriptionId: string): Promise<void>;
  publish(options: PublishOptions): Promise<void>;
  pause?(subscriptionId: string, paused: boolean): Promise<void>;
}
