import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  CartoMessage,
  CaptureStats,
  CartoMessagePayload,
  ConnectionTestParams,
  ConnectionTestResult,
  ConnectParams,
  ConnectionStatus,
  PublishEncoding,
  QueryableInfo,
  RecentKeyStats
} from '@shared/types';
import { getCartoClient } from '../lib/cartoClient';

export type Subscription = {
  id: string;
  keyexpr: string;
  paused: boolean;
  bufferSize: number;
};

const EMPTY_KEYS: RecentKeyStats[] = [];
const EMPTY_QUERYABLES: QueryableInfo[] = [];
const DEFAULT_BUFFER = 200;
const RENDER_FLUSH_INTERVAL_MS = 16;
const LAST_ENDPOINT_STORAGE_KEY = 'carto.lastEndpoint';

const readLastEndpoint = () => {
  if (typeof window === 'undefined') return '';
  try {
    return window.localStorage.getItem(LAST_ENDPOINT_STORAGE_KEY) ?? '';
  } catch {
    return '';
  }
};

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
  const [captureById, setCaptureById] = useState<Record<string, CaptureStats>>({});
  const [recentKeysFilter, setRecentKeysFilter] = useState('');
  const [lastEndpoint, setLastEndpoint] = useState(readLastEndpoint);

  const queryClient = useQueryClient();
  const allKeysQuery = useQuery({
    queryKey: ['carto', 'keys', 'all', recentKeysFilter],
    queryFn: () => getCartoClient().getRecentKeys({ filter: recentKeysFilter }),
    enabled: status.connected,
    refetchInterval: 1000,
    refetchIntervalInBackground: true
  });
  const selectedKeysQuery = useQuery({
    queryKey: ['carto', 'keys', selectedSubId, recentKeysFilter],
    queryFn: () =>
      getCartoClient().getRecentKeys({ filter: recentKeysFilter, subscriptionId: selectedSubId! }),
    enabled: status.connected && Boolean(selectedSubId),
    refetchInterval: 1000,
    refetchIntervalInBackground: true
  });
  const queryablesQuery = useQuery({
    queryKey: ['carto', 'queryables'],
    queryFn: () => getCartoClient().getQueryables(),
    enabled: status.connected,
    refetchInterval: 1000,
    refetchIntervalInBackground: true
  });
  const recentKeys = allKeysQuery.data ?? EMPTY_KEYS;
  const selectedRecentKeys = selectedKeysQuery.data ?? EMPTY_KEYS;
  const queryables = status.connected
    ? (queryablesQuery.data ?? EMPTY_QUERYABLES)
    : EMPTY_QUERYABLES;

  const subscriptionsByIdRef = useRef<Map<string, Subscription>>(new Map());
  const messagesBySubRef = useRef<Record<string, CartoMessage[]>>({});
  const pendingMessagesRef = useRef<Record<string, CartoMessage[]>>({});
  const frontendSkippedRef = useRef<Record<string, number>>({});
  const selectedSubIdRef = useRef<string | null>(null);
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    subscriptionsByIdRef.current = new Map(subscriptions.map((sub) => [sub.id, sub]));
  }, [subscriptions]);

  useEffect(() => {
    selectedSubIdRef.current = selectedSubId;
    if (!selectedSubId) {
      setSelectedMessages([]);
      return;
    }
    const current = messagesBySubRef.current[selectedSubId] ?? [];
    setSelectedMessages(current.slice());
  }, [selectedSubId]);

  const getCarto = () => getCartoClient();

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
      delete frontendSkippedRef.current[subscriptionId];
      return;
    }
    pendingMessagesRef.current = {};
    frontendSkippedRef.current = {};
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
      const changed = appendBatchToBuffer(
        current,
        batch,
        subscription.bufferSize ?? DEFAULT_BUFFER
      );
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
    setCaptureById({});
    messagesBySubRef.current = {};
    setSelectedSubId(null);
    selectedSubIdRef.current = null;
    setSelectedMessages([]);
  }, [resetPendingMessages]);

  useEffect(() => {
    return () => resetPendingMessages();
  }, [resetPendingMessages]);

  useEffect(() => {
    const carto = getCarto();
    if (!carto) return;
    return carto.onMessage((payload: CartoMessagePayload) => {
      const capture = 'capture' in payload ? payload.capture : undefined;
      if (capture?.received === 0) frontendSkippedRef.current[payload.subscriptionId] = 0;
      const queue = pendingMessagesRef.current[payload.subscriptionId] ?? [];
      const incoming = 'msgs' in payload ? payload.msgs : [payload.msg];
      queue.push(...incoming);
      const subscription = subscriptionsByIdRef.current.get(payload.subscriptionId);
      const cap = Math.max(1, subscription?.bufferSize ?? DEFAULT_BUFFER);
      if (queue.length > cap) {
        frontendSkippedRef.current[payload.subscriptionId] =
          (frontendSkippedRef.current[payload.subscriptionId] ?? 0) + queue.length - cap;
        queue.splice(0, queue.length - cap);
      }
      if (capture)
        setCaptureById((previous) => ({
          ...previous,
          [payload.subscriptionId]: {
            ...capture,
            skipped: capture.skipped + (frontendSkippedRef.current[payload.subscriptionId] ?? 0)
          }
        }));
      if (incoming.length === 0) return;
      pendingMessagesRef.current[payload.subscriptionId] = queue;
      scheduleFlush();
    });
  }, [scheduleFlush]);

  const connect = useCallback(
    async (params: ConnectParams) => {
      const carto = getCarto();
      if (!carto) return;
      await queryClient.cancelQueries({ queryKey: ['carto'] });
      queryClient.removeQueries({ queryKey: ['carto'] });
      resetLocalState();
      await carto.connect({ ...params, mode: 'client' });
      setLastEndpoint(params.endpoint);
      try {
        window.localStorage.setItem(LAST_ENDPOINT_STORAGE_KEY, params.endpoint);
      } catch {
        // Storage can be unavailable in hardened or private browser contexts.
      }
    },
    [resetLocalState, queryClient]
  );

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
    // Retain the current investigation until the user starts a new connection.
  }, []);

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

  const updateSubscription = useCallback(
    async (subscriptionId: string, keyexpr: string, bufferSize: number) => {
      const carto = getCarto();
      if (!carto) {
        throw new Error('Carto API is unavailable.');
      }

      const current = subscriptionsByIdRef.current.get(subscriptionId);
      await carto.updateSubscription({ subscriptionId, keyexpr, bufferSize });
      await queryClient.invalidateQueries({ queryKey: ['carto', 'keys', subscriptionId] });

      const trimmedKeyexpr = keyexpr.trim();
      const keyexprChanged = current ? current.keyexpr !== trimmedKeyexpr : true;
      resetPendingMessages(subscriptionId);

      if (keyexprChanged) {
        setCaptureById((previous) => {
          const next = { ...previous };
          delete next[subscriptionId];
          return next;
        });
        messagesBySubRef.current[subscriptionId] = [];
        if (selectedSubIdRef.current === subscriptionId) {
          setSelectedMessages([]);
        }
      } else {
        const messages = messagesBySubRef.current[subscriptionId] ?? [];
        const cap = Math.max(1, bufferSize);
        if (messages.length > cap) {
          messages.splice(0, messages.length - cap);
        }
        if (selectedSubIdRef.current === subscriptionId) {
          setSelectedMessages(messages.slice());
        }
      }

      setSubscriptions((prev) =>
        prev.map((sub) =>
          sub.id === subscriptionId
            ? { ...sub, keyexpr: trimmedKeyexpr, bufferSize: Math.max(1, bufferSize) }
            : sub
        )
      );
      setSelectedSubId(subscriptionId);
    },
    [resetPendingMessages, queryClient]
  );

  const unsubscribe = useCallback(
    async (subscriptionId: string) => {
      const carto = getCarto();
      if (!carto) return;
      await carto.unsubscribe({ subscriptionId });
      resetPendingMessages(subscriptionId);
      delete messagesBySubRef.current[subscriptionId];
      setSubscriptions((prev) => {
        const next = prev.filter((sub) => sub.id !== subscriptionId);
        setSelectedSubId((current) => {
          if (current !== subscriptionId) return current;
          const closedIndex = prev.findIndex((sub) => sub.id === subscriptionId);
          return next[Math.min(closedIndex, next.length - 1)]?.id ?? null;
        });
        return next;
      });
    },
    [resetPendingMessages]
  );

  const setPaused = useCallback(async (subscriptionId: string, paused: boolean) => {
    const carto = getCarto();
    if (!carto) return;
    await carto.pause({ subscriptionId, paused });
    setSubscriptions((prev) =>
      prev.map((sub) => (sub.id === subscriptionId ? { ...sub, paused } : sub))
    );
  }, []);

  const clearBuffer = useCallback(
    async (subscriptionId: string) => {
      const carto = getCarto();
      if (!carto) return;
      await carto.clearBuffer({ subscriptionId });
      resetPendingMessages(subscriptionId);
      messagesBySubRef.current[subscriptionId] = [];
      if (selectedSubIdRef.current === subscriptionId) {
        setSelectedMessages([]);
      }
    },
    [resetPendingMessages]
  );

  const getMessage = useCallback(async (subscriptionId: string, messageId: string) => {
    const carto = getCarto();
    if (!carto) return null;
    return carto.getMessage({ subscriptionId, messageId });
  }, []);

  const publish = useCallback(
    async (keyexpr: string, payload: string, encoding: PublishEncoding, wireEncoding?: string) => {
      const carto = getCarto();
      if (!carto) return;
      await carto.publish({ keyexpr, payload, encoding, wireEncoding });
    },
    []
  );

  const declareQueryable = useCallback(
    async (keyexpr: string, payload: string, encoding: PublishEncoding, complete?: boolean) => {
      const carto = getCarto();
      if (!carto) {
        throw new Error('Carto API is unavailable.');
      }
      const queryableId = await carto.declareQueryable({ keyexpr, payload, encoding, complete });
      await queryClient.invalidateQueries({ queryKey: ['carto', 'queryables'] });
      return queryableId;
    },
    [queryClient]
  );

  const undeclareQueryable = useCallback(
    async (queryableId: string) => {
      const carto = getCarto();
      if (!carto) return;
      await carto.undeclareQueryable({ queryableId });
      await queryClient.invalidateQueries({ queryKey: ['carto', 'queryables'] });
    },
    [queryClient]
  );

  return {
    status,
    lastEndpoint,
    subscriptions,
    selectedSubId,
    setSelectedSubId,
    recentKeys,
    selectedRecentKeys,
    queryables,
    recentKeysFilter,
    setRecentKeysFilter,
    selectedMessages,
    captureById,
    connect,
    testConnection,
    disconnect,
    subscribe,
    updateSubscription,
    unsubscribe,
    setPaused,
    clearBuffer,
    getMessage,
    publish,
    declareQueryable,
    undeclareQueryable
  };
};
