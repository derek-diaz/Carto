import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CartoMessage, ConnectionStatus } from '@shared/types';
import AppHeader from './components/AppHeader';
import AppRail from './components/AppRail';
import ConnectionView from './components/ConnectionView';
import LogsView from './components/LogsView';
import MonitorView from './components/MonitorView';
import MessageDrawer from './components/MessageDrawer';
import PublishView from './components/PublishView';
import ToastStack from './components/ToastStack';
import {
  DEFAULT_PUBLISH_JSON,
  DEFAULT_PUBLISH_KEYEXPR,
  type PublishDraft
} from './components/PublishPanel';
import { useCarto } from './store/useCarto';
import type { LogEntry, LogInput, Toast, ToastInput } from './utils/notifications';

const MAX_LOGS = 200;
const MAX_TOASTS = 4;
const DEFAULT_TOAST_MS = 3500;
const ERROR_TOAST_MS = 6000;

const createId = () => {
  const cryptoObj = globalThis.crypto as { randomUUID?: () => string } | undefined;
  if (cryptoObj?.randomUUID) return cryptoObj.randomUUID();
  return `id-${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

const App = () => {
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    if (typeof globalThis === 'undefined' || !('localStorage' in globalThis)) return 'light';
    const stored = globalThis.localStorage.getItem('carto.theme');
    if (stored === 'light' || stored === 'dark') return stored;
    return globalThis.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  });
  const {
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
    publish
  } = useCarto();

  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const prevStatusRef = useRef<ConnectionStatus | null>(null);
  const prevConnectedRef = useRef(status.connected);

  const [selectedMessage, setSelectedMessage] = useState<CartoMessage | null>(null);
  const [copied, setCopied] = useState(false);
  const [publishDraft, setPublishDraft] = useState<PublishDraft>({
    keyexpr: DEFAULT_PUBLISH_KEYEXPR,
    encoding: 'json',
    payload: DEFAULT_PUBLISH_JSON
  });
  const [lastPublish, setLastPublish] = useState<PublishDraft | null>(null);
  const [actionNotice, setActionNotice] = useState<{
    type: 'ok' | 'error';
    message: string;
  } | null>(null);
  const [showSubscribe, setShowSubscribe] = useState(false);

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((toast) => toast.id !== id));
    const timer = toastTimers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      toastTimers.current.delete(id);
    }
  }, []);

  const addToast = useCallback(
    (toast: ToastInput) => {
      const id = createId();
      const entry: Toast = { ...toast, id, ts: Date.now() };
      setToasts((prev) => {
        const next = [entry, ...prev];
        const trimmed = next.slice(0, MAX_TOASTS);
        const trimmedIds = new Set(trimmed.map((item) => item.id));
        for (const item of prev) {
          if (!trimmedIds.has(item.id)) {
            const timer = toastTimers.current.get(item.id);
            if (timer) clearTimeout(timer);
            toastTimers.current.delete(item.id);
          }
        }
        return trimmed;
      });

      const durationMs =
        toast.durationMs ?? (toast.type === 'error' ? ERROR_TOAST_MS : DEFAULT_TOAST_MS);
      if (durationMs > 0) {
        const timer = setTimeout(() => dismissToast(id), durationMs);
        toastTimers.current.set(id, timer);
      }
    },
    [dismissToast]
  );

  const addLog = useCallback((entry: LogInput) => {
    setLogs((prev) => {
      const next = [{ ...entry, id: createId(), ts: Date.now() }, ...prev];
      return next.slice(0, MAX_LOGS);
    });
  }, []);

  const clearLogs = useCallback(() => {
    setLogs([]);
  }, []);

  useEffect(() => {
    setSelectedMessage(null);
  }, [selectedSubId]);

  useEffect(() => {
    const prev = prevStatusRef.current;
    if (prev && status.connected !== prev.connected) {
      addLog({
        level: status.connected ? 'info' : 'warn',
        source: 'connection',
        message: status.connected ? 'Connected.' : 'Disconnected.'
      });
    }
    if (status.health?.state && status.health.state !== prev?.health?.state) {
      if (status.health.state === 'reconnecting' || status.health.state === 'connecting') {
        addLog({
          level: status.health.state === 'reconnecting' ? 'warn' : 'info',
          source: 'connection',
          message: `Connection state: ${status.health.state}.`,
          detail: status.health.lastError
        });
      }
    }
    if (status.error && status.error !== prev?.error) {
      addToast({ type: 'error', message: 'Connection error', detail: status.error });
      addLog({ level: 'error', source: 'connection', message: status.error });
    }
    prevStatusRef.current = status;
  }, [addLog, addToast, status]);

  const selectedSub = subscriptions.find((sub) => sub.id === selectedSubId);
  const streamTitle = selectedSub ? `Stream - ${selectedSub.keyexpr}` : 'Stream';
  const activeKeys = selectedSubId ? selectedRecentKeys : recentKeys;
  const [view, setView] = useState<'monitor' | 'publish' | 'connection' | 'logs'>(
    status.connected ? 'monitor' : 'connection'
  );
  const [monitorTab, setMonitorTab] = useState<'stream' | 'keys'>('stream');

  useEffect(() => {
    const wasConnected = prevConnectedRef.current;
    prevConnectedRef.current = status.connected;
    if (!status.connected && status.health?.state === 'disconnected' && view !== 'logs') {
      setView('connection');
      return;
    }
    if (!wasConnected && status.connected && view === 'connection') {
      setView('monitor');
    }
  }, [status.connected, status.health?.state, view]);

  useEffect(() => {
    if (subscriptions.length === 0) {
      setShowSubscribe(false);
    }
  }, [subscriptions.length]);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    document.documentElement.classList.toggle('theme-dark', theme === 'dark');
    if ('localStorage' in globalThis) {
      globalThis.localStorage.setItem('carto.theme', theme);
    }
  }, [theme]);

  useEffect(() => {
    if (!copied) return;
    const timer = globalThis.setTimeout(() => setCopied(false), 1500);
    return () => globalThis.clearTimeout(timer);
  }, [copied]);

  useEffect(() => {
    if (!actionNotice) return;
    const timer = globalThis.setTimeout(() => setActionNotice(null), 2000);
    return () => globalThis.clearTimeout(timer);
  }, [actionNotice]);

  useEffect(() => {
    const timers = toastTimers.current;
    return () => {
      timers.forEach((timer) => clearTimeout(timer));
      timers.clear();
    };
  }, []);

  const publishSupport = useMemo<'supported' | 'unknown' | 'unsupported'>(() => {
    const features = status.capabilities?.features;
    if (!features || features.length === 0) return 'unknown';
    return features.includes('publish') ? 'supported' : 'unsupported';
  }, [status.capabilities]);

  const viewTitle = useMemo(() => {
    switch (view) {
      case 'monitor':
        return 'Monitor';
      case 'publish':
        return 'Publish';
      case 'logs':
        return 'Logs';
      default:
        return 'Connection';
    }
  }, [view]);

  const viewDescription = useMemo(() => {
    if (view === 'monitor') {
      return selectedSub
        ? `Streaming ${selectedSub.keyexpr}`
        : 'Pick a subscription to start streaming.';
    }
    if (view === 'publish') {
      if (publishSupport === 'supported') {
        return 'Send payloads to a key expression.';
      }
      if (publishSupport === 'unsupported') {
        return 'Publishing disabled by this router.';
      }
      return 'Publishing capability unknown.';
    }
    if (view === 'logs') {
      return 'Connection events and errors.';
    }
    return status.connected ? 'Connected to the router.' : 'Configure and connect to a router.';
  }, [publishSupport, selectedSub, status.connected, view]);

  const canCopyEndpoint =
    typeof navigator !== 'undefined' && typeof navigator.clipboard?.writeText === 'function';
  const endpointLabel = lastEndpoint || 'Not set';
  const endpointTitle = lastEndpoint || 'No endpoint yet';
  const recentKeyexpr = recentKeys[0]?.key;
  const selectedKeyexpr = selectedSub?.keyexpr;
  const useKeyexprLabel = selectedKeyexpr ? 'Use stream key' : 'Use recent key';
  const canUseKeyexpr = Boolean(selectedKeyexpr ?? recentKeyexpr);
  const useKeyexprTitle = canUseKeyexpr
    ? `${useKeyexprLabel}: ${selectedKeyexpr ?? recentKeyexpr ?? ''}`
    : 'No keys available yet';
  const handleCopyEndpoint = useCallback(async () => {
    if (!lastEndpoint || !canCopyEndpoint) return;
    try {
      await navigator.clipboard.writeText(lastEndpoint);
      setCopied(true);
    } catch {
      // ignore clipboard errors
    }
  }, [canCopyEndpoint, lastEndpoint]);

  const handlePublish = useCallback(
    async (keyexpr: string, payload: string, encoding: PublishDraft['encoding']) => {
      await publish(keyexpr, payload, encoding);
      setLastPublish({ keyexpr, payload, encoding });
    },
    [publish]
  );

  const handleSubscribe = useCallback(
    async (keyexpr: string, bufferSize?: number) => {
      const subscriptionId = await subscribe(keyexpr, bufferSize);
      setShowSubscribe(false);
      return subscriptionId;
    },
    [subscribe]
  );

  const handleTogglePause = useCallback(async () => {
    if (!selectedSub || !status.connected) return;
    await setPaused(selectedSub.id, !selectedSub.paused);
  }, [selectedSub, setPaused, status.connected]);

  const handleClearBuffer = useCallback(async () => {
    if (!selectedSub || !status.connected) return;
    await clearBuffer(selectedSub.id);
  }, [clearBuffer, selectedSub, status.connected]);

  const handleDisconnect = useCallback(async () => {
    try {
      await disconnect();
    } catch {
      // ignore disconnect errors
      const message = 'Disconnect failed.';
      addToast({ type: 'error', message });
      addLog({ level: 'error', source: 'connection', message });
    }
  }, [addLog, addToast, disconnect]);

  const handleUseKeyexpr = useCallback(() => {
    const nextKeyexpr = selectedKeyexpr ?? recentKeyexpr;
    if (!nextKeyexpr) return;
    setPublishDraft((current) => ({ ...current, keyexpr: nextKeyexpr }));
  }, [recentKeyexpr, selectedKeyexpr]);

  const handleLoadLastPublish = useCallback(() => {
    if (!lastPublish) return;
    setPublishDraft({ ...lastPublish });
  }, [lastPublish]);

  const handleReplayLast = useCallback(async () => {
    if (!lastPublish || !status.connected) return;
    try {
      await publish(lastPublish.keyexpr, lastPublish.payload, lastPublish.encoding);
      setActionNotice({ type: 'ok', message: 'Replayed last publish.' });
      addLog({
        level: 'info',
        source: 'publish',
        message: `Replayed ${lastPublish.keyexpr}.`
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setActionNotice({ type: 'error', message });
      addToast({ type: 'error', message: 'Replay failed', detail: message });
      addLog({ level: 'error', source: 'publish', message, detail: lastPublish.keyexpr });
    }
  }, [addLog, addToast, lastPublish, publish, status.connected]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!event.metaKey && !event.ctrlKey) return;
      const target = event.target as HTMLElement | null;
      if (target) {
        const tagName = target.tagName;
        if (
          tagName === 'INPUT' ||
          tagName === 'TEXTAREA' ||
          tagName === 'SELECT' ||
          target.isContentEditable
        ) {
          return;
        }
      }

      if (event.code === 'Digit1' && status.connected) {
        event.preventDefault();
        setView('monitor');
        return;
      }
      if (event.code === 'Digit2' && status.connected) {
        event.preventDefault();
        setView('publish');
        return;
      }
      if (event.code === 'Digit3') {
        event.preventDefault();
        setView('connection');
        return;
      }
      if (event.code === 'Digit4') {
        event.preventDefault();
        setView('logs');
        return;
      }
      if (event.code === 'Digit4') {
        event.preventDefault();
        setView('logs');
        return;
      }

      const key = event.key.toLowerCase();
      if (event.shiftKey && key === 'l') {
        event.preventDefault();
        setTheme((current) => (current === 'dark' ? 'light' : 'dark'));
        return;
      }
      if (event.shiftKey && key === 'd' && status.connected) {
        event.preventDefault();
        handleDisconnect();
        return;
      }
      if (event.shiftKey && key === 'p' && view === 'monitor' && selectedSub && status.connected) {
        event.preventDefault();
        handleTogglePause().catch(() => {});
        return;
      }
      if (event.shiftKey && key === 'k' && view === 'monitor' && selectedSub && status.connected) {
        event.preventDefault();
        handleClearBuffer().catch(() => {});
        return;
      }
      if (event.shiftKey && key === 'r' && view === 'publish' && lastPublish && status.connected) {
        event.preventDefault();
        handleReplayLast().catch(() => {});
      }
    };

    globalThis.addEventListener('keydown', handleKeyDown);
    return () => globalThis.removeEventListener('keydown', handleKeyDown);
  }, [
    handleReplayLast,
    handleClearBuffer,
    handleDisconnect,
    handleTogglePause,
    lastPublish,
    selectedSub,
    setTheme,
    setView,
    status.connected,
    view
  ]);

  return (
    <div className="app">
      <div className="app_frame">
        <AppRail
          theme={theme}
          view={view}
          connected={status.connected}
          onSetView={setView}
          onToggleTheme={() => setTheme((current) => (current === 'dark' ? 'light' : 'dark'))}
        />

        <div className="app_shell">
          <AppHeader
            viewTitle={viewTitle}
            viewDescription={viewDescription}
            statusConnected={status.connected}
            health={status.health}
            endpointLabel={endpointLabel}
            endpointTitle={endpointTitle}
            canCopyEndpoint={canCopyEndpoint}
            copied={copied}
            lastEndpoint={lastEndpoint}
            onCopyEndpoint={handleCopyEndpoint}
            view={view}
            selectedSub={selectedSub}
            onTogglePause={handleTogglePause}
            onClearBuffer={handleClearBuffer}
            onUseKeyexpr={handleUseKeyexpr}
            useKeyexprLabel={useKeyexprLabel}
            useKeyexprTitle={useKeyexprTitle}
            canUseKeyexpr={canUseKeyexpr}
            onLoadLastPublish={handleLoadLastPublish}
            lastPublish={lastPublish}
            onReplayLast={handleReplayLast}
            actionNotice={actionNotice}
            onDisconnect={handleDisconnect}
          />

          <div className="app_body">
            {view === 'monitor' ? (
              <MonitorView
                connected={status.connected}
                subscriptions={subscriptions}
                selectedSubId={selectedSubId}
                setSelectedSubId={setSelectedSubId}
                selectedMessages={selectedMessages}
                selectedRecentKeys={selectedRecentKeys}
                recentKeysFilter={recentKeysFilter}
                setRecentKeysFilter={setRecentKeysFilter}
                streamTitle={streamTitle}
                monitorTab={monitorTab}
                setMonitorTab={setMonitorTab}
                showSubscribe={showSubscribe}
                setShowSubscribe={setShowSubscribe}
                onSubscribe={handleSubscribe}
                onUnsubscribe={unsubscribe}
                onPause={setPaused}
                onClear={clearBuffer}
                onSelectMessage={setSelectedMessage}
                onLog={addLog}
                onToast={addToast}
              />
            ) : null}

            {view === 'publish' ? (
              <PublishView
                connected={status.connected}
                publishSupport={publishSupport}
                draft={publishDraft}
                onDraftChange={setPublishDraft}
                onPublish={handlePublish}
                onLog={addLog}
                onToast={addToast}
                keys={activeKeys}
                filter={recentKeysFilter}
                onFilterChange={setRecentKeysFilter}
              />
            ) : null}

            {view === 'connection' ? (
              <ConnectionView
                status={status}
                defaultEndpoint={lastEndpoint || undefined}
                onConnect={connect}
                onTestConnection={testConnection}
                onDisconnect={disconnect}
                onLog={addLog}
                onToast={addToast}
              />
            ) : null}

            {view === 'logs' ? <LogsView logs={logs} onClearLogs={clearLogs} /> : null}
          </div>
        </div>
      </div>

      <MessageDrawer message={selectedMessage} onClose={() => setSelectedMessage(null)} />
      {toasts.length > 0 ? <ToastStack toasts={toasts} onDismiss={dismissToast} /> : null}
    </div>
  );
};

export default App;
