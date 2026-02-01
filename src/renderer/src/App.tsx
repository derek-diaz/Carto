import { useCallback, useEffect, useMemo, useState } from 'react';
import type { CartoMessage } from '@shared/types';
import AppHeader from './components/AppHeader';
import AppRail from './components/AppRail';
import ConnectionView from './components/ConnectionView';
import MonitorView from './components/MonitorView';
import MessageDrawer from './components/MessageDrawer';
import PublishView from './components/PublishView';
import {
  DEFAULT_PUBLISH_JSON,
  DEFAULT_PUBLISH_KEYEXPR,
  type PublishDraft
} from './components/PublishPanel';
import { useCarto } from './store/useCarto';

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
    disconnect,
    subscribe,
    unsubscribe,
    setPaused,
    clearBuffer,
    publish
  } = useCarto();

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

  useEffect(() => {
    setSelectedMessage(null);
  }, [selectedSubId]);

  const selectedSub = subscriptions.find((sub) => sub.id === selectedSubId);
  const streamTitle = selectedSub ? `Stream - ${selectedSub.keyexpr}` : 'Stream';
  const subscriptionCount = subscriptions.length;
  const bufferedCount = selectedMessages.length;
  const activeKeys = selectedSubId ? selectedRecentKeys : recentKeys;
  const [view, setView] = useState<'monitor' | 'publish' | 'connection'>(
    status.connected ? 'monitor' : 'connection'
  );
  const [monitorTab, setMonitorTab] = useState<'stream' | 'keys'>('stream');
  const keyCount = activeKeys.length;

  useEffect(() => {
    if (!status.connected) {
      setView('connection');
      return;
    }
    setView((current) => (current === 'connection' ? 'monitor' : current));
  }, [status.connected]);

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
  const handleOpenConnection = useCallback(() => {
    setView('connection');
  }, []);

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
    }
  }, [disconnect]);

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
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setActionNotice({ type: 'error', message });
    }
  }, [lastPublish, publish, status.connected]);

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
            subscriptionCount={subscriptionCount}
            bufferedCount={bufferedCount}
            keyCount={keyCount}
            statusConnected={status.connected}
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
            onOpenConnection={handleOpenConnection}
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
              />
            ) : null}

            {view === 'publish' ? (
              <PublishView
                connected={status.connected}
                publishSupport={publishSupport}
                draft={publishDraft}
                onDraftChange={setPublishDraft}
                onPublish={handlePublish}
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
                onDisconnect={disconnect}
              />
            ) : null}
          </div>
        </div>
      </div>

      <MessageDrawer message={selectedMessage} onClose={() => setSelectedMessage(null)} />
    </div>
  );
};

export default App;
