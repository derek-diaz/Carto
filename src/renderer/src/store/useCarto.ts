import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CartoMessage, ConnectionStatus, PublishEncoding, RecentKeyStats } from '@shared/types';

export type Subscription = {
  id: string;
  keyexpr: string;
  paused: boolean;
  bufferSize: number;
};

const DEFAULT_BUFFER = 200;

export const useCarto = () => {
  const [status, setStatus] = useState<ConnectionStatus>({ connected: false });
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [messagesBySub, setMessagesBySub] = useState<Record<string, CartoMessage[]>>({});
  const [selectedSubId, setSelectedSubId] = useState<string | null>(null);
  const [recentKeys, setRecentKeys] = useState<RecentKeyStats[]>([]);
  const [recentKeysFilter, setRecentKeysFilter] = useState('');

  const subsRef = useRef<Subscription[]>([]);
  useEffect(() => {
    subsRef.current = subscriptions;
  }, [subscriptions]);

  useEffect(() => {
    if (!window.carto) return;
    return window.carto.onStatus((nextStatus) => {
      setStatus(nextStatus);
      if (!nextStatus.connected) {
        setSubscriptions([]);
        setMessagesBySub({});
        setSelectedSubId(null);
      }
    });
  }, []);

  useEffect(() => {
    if (!window.carto) return;
    return window.carto.onMessage(({ subscriptionId, msg }) => {
      setMessagesBySub((prev) => {
        const current = prev[subscriptionId] ?? [];
        const bufferSize =
          subsRef.current.find((sub) => sub.id === subscriptionId)?.bufferSize ?? DEFAULT_BUFFER;
        const next = [...current, msg];
        const pruned = next.length > bufferSize ? next.slice(next.length - bufferSize) : next;
        return { ...prev, [subscriptionId]: pruned };
      });
    });
  }, []);

  useEffect(() => {
    if (!window.carto || !status.connected) {
      setRecentKeys([]);
      return;
    }

    let mounted = true;
    const fetchKeys = async () => {
      try {
        const list = await window.carto.getRecentKeys({ filter: recentKeysFilter });
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

  const connect = useCallback(async (endpoint: string, configJson?: string) => {
    await window.carto.connect({ endpoint, mode: 'client', configJson });
  }, []);

  const disconnect = useCallback(async () => {
    await window.carto.disconnect();
  }, []);

  const subscribe = useCallback(async (keyexpr: string, bufferSize?: number) => {
    const subscriptionId = await window.carto.subscribe({ keyexpr, bufferSize });
    const entry: Subscription = {
      id: subscriptionId,
      keyexpr,
      paused: false,
      bufferSize: bufferSize ?? DEFAULT_BUFFER
    };
    setSubscriptions((prev) => [...prev, entry]);
    setSelectedSubId(subscriptionId);
    return subscriptionId;
  }, []);

  const unsubscribe = useCallback(async (subscriptionId: string) => {
    await window.carto.unsubscribe({ subscriptionId });
    setSubscriptions((prev) => {
      const next = prev.filter((sub) => sub.id !== subscriptionId);
      setSelectedSubId((current) => {
        if (current !== subscriptionId) return current;
        return next[0]?.id ?? null;
      });
      return next;
    });
    setMessagesBySub((prev) => {
      const next = { ...prev };
      delete next[subscriptionId];
      return next;
    });
  }, []);

  const setPaused = useCallback(async (subscriptionId: string, paused: boolean) => {
    await window.carto.pause({ subscriptionId, paused });
    setSubscriptions((prev) =>
      prev.map((sub) => (sub.id === subscriptionId ? { ...sub, paused } : sub))
    );
  }, []);

  const clearBuffer = useCallback(async (subscriptionId: string) => {
    await window.carto.clearBuffer({ subscriptionId });
    setMessagesBySub((prev) => ({ ...prev, [subscriptionId]: [] }));
  }, []);

  const publish = useCallback(async (keyexpr: string, payload: string, encoding: PublishEncoding) => {
    await window.carto.publish({ keyexpr, payload, encoding });
  }, []);

  const selectedMessages = useMemo(() => {
    if (!selectedSubId) return [];
    return messagesBySub[selectedSubId] ?? [];
  }, [messagesBySub, selectedSubId]);

  return {
    status,
    subscriptions,
    selectedSubId,
    setSelectedSubId,
    recentKeys,
    recentKeysFilter,
    setRecentKeysFilter,
    selectedMessages,
    connect,
    disconnect,
    subscribe,
    unsubscribe,
    setPaused,
    clearBuffer,
    publish
  };
};
