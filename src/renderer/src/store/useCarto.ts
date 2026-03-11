import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  CartoMessage,
  CartoMessagePayload,
  ConnectionTestParams,
  ConnectionTestResult,
  ConnectParams,
  ConnectionStatus,
  PublishEncoding,
  RecentKeyStats
} from '@shared/types';

export type Subscription = {
  id: string;
  keyexpr: string;
  paused: boolean;
  bufferSize: number;
};

const DEFAULT_BUFFER = 200;
const RENDER_FLUSH_INTERVAL_MS = 50;

const appendBatchToBuffer = (
  buffer: CartoMessage[],
  batch: CartoMessage[],
  capacity: number
): boolean => {
  if (batch.length === 0) return false;
  const cap = Math.max(1, capacity);

  if (batch.length >= cap) {
    buffer.splice(0, buffer.length);
    buffer.push(...batch.slice(batch.length - cap));
    return true;
  }

  const overflow = buffer.length + batch.length - cap;
  if (overflow > 0) {
    buffer.splice(0, overflow);
  }
  buffer.push(...batch);
  return true;
};

export const useCarto = () => {
  const [status, setStatus] = useState<ConnectionStatus>({ connected: false });
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [selectedSubId, setSelectedSubId] = useState<string | null>(null);
  const [selectedMessages, setSelectedMessages] = useState<CartoMessage[]>([]);
  const [recentKeys, setRecentKeys] = useState<RecentKeyStats[]>([]);
  const [selectedRecentKeys, setSelectedRecentKeys] = useState<RecentKeyStats[]>([]);
  const [recentKeysFilter, setRecentKeysFilter] = useState('');
  const [lastEndpoint, setLastEndpoint] = useState('');

  const subscriptionsByIdRef = useRef<Map<string, Subscription>>(new Map());
  const messagesBySubRef = useRef<Record<string, CartoMessage[]>>({});
  const pendingMessagesRef = useRef<Record<string, CartoMessage[]>>({});
  const selectedSubIdRef = useRef<string | null>(null);
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    subscriptionsByIdRef.current = new Map(subscriptions.map((sub) => [sub.id, sub]));
  }, [subscriptions]);

  useEffect(() => {
    selectedSubIdRef.current = selectedSubId;
    setSelectedRecentKeys([]);
    if (!selectedSubId) {
      setSelectedMessages([]);
      return;
    }
    const current = messagesBySubRef.current[selectedSubId] ?? [];
    setSelectedMessages(current.slice());
  }, [selectedSubId]);

  const getCarto = () => (globalThis as unknown as Window).carto;

  useEffect(() => {
    const carto = getCarto();
    if (!carto) return;
    return carto.onStatus((nextStatus) => {
      setStatus(nextStatus);
    });
  }, []);

  const resetPendingMessages = useCallback((subscriptionId?: string) => {
    if (subscriptionId) {
      delete pendingMessagesRef.current[subscriptionId];
      return;
    }
    pendingMessagesRef.current = {};
    if (flushTimerRef.current !== null) {
      clearTimeout(flushTimerRef.current);
      flushTimerRef.current = null;
    }
  }, []);

  const flushPendingMessages = useCallback(() => {
    flushTimerRef.current = null;
    const pending = pendingMessagesRef.current;
    const pendingEntries = Object.entries(pending);
    if (pendingEntries.length === 0) return;
    pendingMessagesRef.current = {};

    const selectedId = selectedSubIdRef.current;
    let selectedChanged = false;

    for (const [subscriptionId, batch] of pendingEntries) {
      const subscription = subscriptionsByIdRef.current.get(subscriptionId);
      if (!subscription) continue;
      const current = messagesBySubRef.current[subscriptionId] ?? [];
      messagesBySubRef.current[subscriptionId] = current;
      const changed = appendBatchToBuffer(current, batch, subscription.bufferSize ?? DEFAULT_BUFFER);
      if (changed && selectedId === subscriptionId) {
        selectedChanged = true;
      }
    }

    if (selectedId && selectedChanged) {
      const selectedBuffer = messagesBySubRef.current[selectedId] ?? [];
      setSelectedMessages(selectedBuffer.slice());
    }
  }, []);

  const scheduleFlush = useCallback(() => {
    if (flushTimerRef.current !== null) return;
    flushTimerRef.current = setTimeout(flushPendingMessages, RENDER_FLUSH_INTERVAL_MS);
  }, [flushPendingMessages]);

  const resetLocalState = useCallback(() => {
    resetPendingMessages();
    setSubscriptions([]);
    messagesBySubRef.current = {};
    setSelectedSubId(null);
    selectedSubIdRef.current = null;
    setSelectedMessages([]);
    setRecentKeys([]);
    setSelectedRecentKeys([]);
  }, [resetPendingMessages]);

  useEffect(() => {
    return () => resetPendingMessages();
  }, [resetPendingMessages]);

  useEffect(() => {
    const carto = getCarto();
    if (!carto) return;
    return carto.onMessage((payload: CartoMessagePayload) => {
      const queue = pendingMessagesRef.current[payload.subscriptionId] ?? [];
      if ('msgs' in payload) {
        if (payload.msgs.length === 0) return;
        queue.push(...payload.msgs);
      } else {
        queue.push(payload.msg);
      }
      const subscription = subscriptionsByIdRef.current.get(payload.subscriptionId);
      const cap = Math.max(1, subscription?.bufferSize ?? DEFAULT_BUFFER);
      if (queue.length > cap) {
        queue.splice(0, queue.length - cap);
      }
      pendingMessagesRef.current[payload.subscriptionId] = queue;
      scheduleFlush();
    });
  }, [scheduleFlush]);

  useEffect(() => {
    const carto = getCarto();
    if (!carto || !status.connected) {
      setRecentKeys([]);
      return;
    }

    let mounted = true;
    const fetchKeys = async () => {
      try {
        const list = await carto.getRecentKeys({ filter: recentKeysFilter });
        if (mounted) setRecentKeys(list);
      } catch {
        // ignore polling errors
      }
    };

    fetchKeys();
    const timer = setInterval(fetchKeys, 1000);
    return () => {
      mounted = false;
      clearInterval(timer);
    };
  }, [status.connected, recentKeysFilter]);

  useEffect(() => {
    const carto = getCarto();
    if (!carto || !status.connected || !selectedSubId) {
      setSelectedRecentKeys([]);
      return;
    }

    let mounted = true;
    const fetchKeys = async () => {
      try {
        const list = await carto.getRecentKeys({
          filter: recentKeysFilter,
          subscriptionId: selectedSubId
        });
        if (mounted) setSelectedRecentKeys(list);
      } catch {
        // ignore polling errors
      }
    };

    fetchKeys();
    const timer = setInterval(fetchKeys, 1000);
    return () => {
      mounted = false;
      clearInterval(timer);
    };
  }, [status.connected, recentKeysFilter, selectedSubId]);

  const connect = useCallback(async (params: ConnectParams) => {
    const carto = getCarto();
    if (!carto) return;
    resetLocalState();
    await carto.connect({ ...params, mode: 'client' });
    setLastEndpoint(params.endpoint);
  }, [resetLocalState]);

  const testConnection = useCallback(
    async (params: ConnectionTestParams): Promise<ConnectionTestResult> => {
      const carto = getCarto();
      if (!carto) {
        throw new Error('Carto API is unavailable.');
      }
      return carto.testConnection(params);
    },
    []
  );

  const disconnect = useCallback(async () => {
    const carto = getCarto();
    if (!carto) return;
    await carto.disconnect();
    resetLocalState();
  }, [resetLocalState]);

  const subscribe = useCallback(async (keyexpr: string, bufferSize?: number) => {
    const carto = getCarto();
    if (!carto) {
      throw new Error('Carto API is unavailable.');
    }
    const subscriptionId = await carto.subscribe({ keyexpr, bufferSize });
    const entry: Subscription = {
      id: subscriptionId,
      keyexpr,
      paused: false,
      bufferSize: bufferSize ?? DEFAULT_BUFFER
    };
    messagesBySubRef.current[subscriptionId] = [];
    setSubscriptions((prev) => [...prev, entry]);
    setSelectedSubId(subscriptionId);
    return subscriptionId;
  }, []);

  const unsubscribe = useCallback(async (subscriptionId: string) => {
    const carto = getCarto();
    if (!carto) return;
    await carto.unsubscribe({ subscriptionId });
    resetPendingMessages(subscriptionId);
    delete messagesBySubRef.current[subscriptionId];
    setSubscriptions((prev) => {
      const next = prev.filter((sub) => sub.id !== subscriptionId);
      setSelectedSubId((current) => {
        if (current !== subscriptionId) return current;
        return next[0]?.id ?? null;
      });
      return next;
    });
  }, [resetPendingMessages]);

  const setPaused = useCallback(async (subscriptionId: string, paused: boolean) => {
    const carto = getCarto();
    if (!carto) return;
    await carto.pause({ subscriptionId, paused });
    setSubscriptions((prev) =>
      prev.map((sub) => (sub.id === subscriptionId ? { ...sub, paused } : sub))
    );
  }, []);

  const clearBuffer = useCallback(async (subscriptionId: string) => {
    const carto = getCarto();
    if (!carto) return;
    await carto.clearBuffer({ subscriptionId });
    resetPendingMessages(subscriptionId);
    messagesBySubRef.current[subscriptionId] = [];
    if (selectedSubIdRef.current === subscriptionId) {
      setSelectedMessages([]);
    }
  }, [resetPendingMessages]);

  const getMessage = useCallback(async (subscriptionId: string, messageId: string) => {
    const carto = getCarto();
    if (!carto) return null;
    return carto.getMessage({ subscriptionId, messageId });
  }, []);

  const publish = useCallback(
    async (keyexpr: string, payload: string, encoding: PublishEncoding) => {
      const carto = getCarto();
      if (!carto) return;
      await carto.publish({ keyexpr, payload, encoding });
    },
    []
  );

  return {
    status,
    lastEndpoint,
    subscriptions,
    selectedSubId,
    setSelectedSubId,
    recentKeys,
    selectedRecentKeys,
    recentKeysFilter,
    setRecentKeysFilter,
    selectedMessages,
    connect,
    testConnection,
    disconnect,
    subscribe,
    unsubscribe,
    setPaused,
    clearBuffer,
    getMessage,
    publish
  };
};
