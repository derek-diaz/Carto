import type { CartoApi } from '@shared/cartoApi';
import type { CartoMessagePayload, ConnectionStatus } from '@shared/types';

type ListenerSet<T> = Set<(value: T) => void>;

const EVENTS_PATH = '/api/events';

class WebCartoClient implements CartoApi {
  private readonly messageListeners: ListenerSet<CartoMessagePayload> = new Set();
  private readonly statusListeners: ListenerSet<ConnectionStatus> = new Set();
  private socket: WebSocket | null = null;
  private reconnectTimer: number | null = null;
  private stopped = false;

  connect = async (params: Parameters<CartoApi['connect']>[0]): Promise<void> => {
    await this.request('/api/connect', params);
  };

  testConnection = async (
    params: Parameters<CartoApi['testConnection']>[0]
  ): Promise<ReturnType<CartoApi['testConnection']> extends Promise<infer T> ? T : never> => {
    return this.request('/api/test-connection', params);
  };

  disconnect = async (): Promise<void> => {
    await this.request('/api/disconnect');
  };

  subscribe = async (params: Parameters<CartoApi['subscribe']>[0]): Promise<string> => {
    const result = await this.request<{ subscriptionId: string }>('/api/subscribe', params);
    return result.subscriptionId;
  };

  unsubscribe = async (params: Parameters<CartoApi['unsubscribe']>[0]): Promise<void> => {
    await this.request('/api/unsubscribe', params);
  };

  pause = async (params: Parameters<CartoApi['pause']>[0]): Promise<void> => {
    await this.request('/api/pause', params);
  };

  getMessage = async (
    params: Parameters<CartoApi['getMessage']>[0]
  ): Promise<Awaited<ReturnType<CartoApi['getMessage']>>> => {
    const result = await this.request<{ message: Awaited<ReturnType<CartoApi['getMessage']>> }>(
      '/api/get-message',
      params
    );
    return result.message;
  };

  getRecentKeys = async (
    params?: Parameters<CartoApi['getRecentKeys']>[0]
  ): Promise<Awaited<ReturnType<CartoApi['getRecentKeys']>>> => {
    const result = await this.request<{
      keys: Awaited<ReturnType<CartoApi['getRecentKeys']>>;
    }>('/api/get-recent-keys', params ?? {});
    return result.keys;
  };

  clearBuffer = async (params: Parameters<CartoApi['clearBuffer']>[0]): Promise<void> => {
    await this.request('/api/clear-buffer', params);
  };

  publish = async (params: Parameters<CartoApi['publish']>[0]): Promise<void> => {
    await this.request('/api/publish', params);
  };

  onMessage = (callback: (payload: CartoMessagePayload) => void): (() => void) => {
    this.messageListeners.add(callback);
    this.ensureSocket();
    return () => {
      this.messageListeners.delete(callback);
    };
  };

  onStatus = (callback: (status: ConnectionStatus) => void): (() => void) => {
    this.statusListeners.add(callback);
    this.ensureSocket();
    return () => {
      this.statusListeners.delete(callback);
    };
  };

  private ensureSocket(): void {
    if (this.socket || this.stopped) return;
    const socket = new WebSocket(buildEventsUrl());
    this.socket = socket;

    socket.addEventListener('message', (event) => {
      const payload = parseServerEvent(event.data);
      if (!payload) return;
      if (payload.type === 'status') {
        this.statusListeners.forEach((listener) => listener(payload.data));
        return;
      }
      this.messageListeners.forEach((listener) => listener(payload.data));
    });

    socket.addEventListener('close', () => {
      if (this.socket === socket) {
        this.socket = null;
      }
      if (this.stopped) return;
      this.scheduleReconnect();
    });

    socket.addEventListener('error', () => {
      socket.close();
    });
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer !== null) return;
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      this.ensureSocket();
    }, 1000);
  }

  private async request<T = void>(path: string, body?: unknown): Promise<T> {
    const response = await fetch(path, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: body === undefined ? '{}' : JSON.stringify(body)
    });

    if (!response.ok) {
      const errorPayload = (await response.json().catch(() => null)) as
        | { error?: string }
        | null;
      throw new Error(errorPayload?.error || `Request failed with status ${response.status}.`);
    }

    if (response.status === 204) {
      return undefined as T;
    }

    const text = await response.text();
    if (!text) {
      return undefined as T;
    }
    return JSON.parse(text) as T;
  }
}

const parseServerEvent = (raw: string | ArrayBuffer | Blob):
  | { type: 'status'; data: ConnectionStatus }
  | { type: 'message'; data: CartoMessagePayload }
  | null => {
  if (typeof raw !== 'string') return null;
  try {
    const parsed = JSON.parse(raw) as
      | { type: 'status'; data: ConnectionStatus }
      | { type: 'message'; data: CartoMessagePayload };
    if (parsed?.type === 'status' || parsed?.type === 'message') {
      return parsed;
    }
  } catch {
    return null;
  }
  return null;
};

const buildEventsUrl = (): string => {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}${EVENTS_PATH}`;
};

let cachedClient: CartoApi | null = null;

export const getCartoClient = (): CartoApi => {
  if (window.carto) return window.carto;
  if (cachedClient) return cachedClient;
  cachedClient = new WebCartoClient();
  return cachedClient;
};
