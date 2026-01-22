import { useCallback, useEffect, useMemo, useState } from 'react';
import type { CartoMessage } from '@shared/types';
import logoUrl from '@shared/logo.png';
import ConnectPanel from './components/ConnectPanel';
import {
  IconClock,
  IconConnection,
  IconCopy,
  IconHash,
  IconLinkOff,
  IconMonitor,
  IconMoon,
  IconPause,
  IconPlay,
  IconPublish,
  IconReplay,
  IconSun,
  IconTrash
} from './components/Icons';
import KeyExplorer from './components/KeyExplorer';
import MessageDrawer from './components/MessageDrawer';
import PublishPanel, {
  DEFAULT_PUBLISH_JSON,
  DEFAULT_PUBLISH_KEYEXPR,
  type PublishDraft
} from './components/PublishPanel';
import StreamView from './components/StreamView';
import SubscribePanel from './components/SubscribePanel';
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

  useEffect(() => {
    setSelectedMessage(null);
  }, [selectedSubId]);

  const selectedSub = subscriptions.find((sub) => sub.id === selectedSubId);
  const streamTitle = selectedSub ? `Stream - ${selectedSub.keyexpr}` : 'Stream';
  const subscriptionCount = subscriptions.length;
  const bufferedCount = selectedMessages.length;
  const keyCount = recentKeys.length;
  const [view, setView] = useState<'monitor' | 'publish' | 'connection'>(
    status.connected ? 'monitor' : 'connection'
  );
  const [monitorTab, setMonitorTab] = useState<'stream' | 'keys'>('stream');

  useEffect(() => {
    if (!status.connected) {
      setView('connection');
      return;
    }
    setView((current) => (current === 'connection' ? 'monitor' : current));
  }, [status.connected]);

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
      return selectedSub ? `Streaming ${selectedSub.keyexpr}` : 'Pick a subscription to start streaming.';
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
        void handleDisconnect();
        return;
      }
      if (event.shiftKey && key === 'p' && view === 'monitor' && selectedSub && status.connected) {
        event.preventDefault();
        void handleTogglePause();
        return;
      }
      if (event.shiftKey && key === 'k' && view === 'monitor' && selectedSub && status.connected) {
        event.preventDefault();
        void handleClearBuffer();
        return;
      }
      if (event.shiftKey && key === 'r' && view === 'publish' && lastPublish && status.connected) {
        event.preventDefault();
        void handleReplayLast();
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
      <div className="app__frame">
        <aside className="app__rail">
          <div className="rail__brand">
            <img className="rail__logo" src={logoUrl} alt="Carto logo" />
            <span className="rail__name">Carto</span>
          </div>
          <div className="rail__group">
            <button
              className={`rail__button ${view === 'monitor' ? 'rail__button--active' : ''}`}
              onClick={() => setView('monitor')}
              disabled={!status.connected}
              title="Monitor (Ctrl/Cmd+1)"
            >
              <span className="rail__icon" aria-hidden="true">
                <IconMonitor aria-hidden="true" />
              </span>
              <span className="rail__label">Monitor</span>
            </button>
            <button
              className={`rail__button ${view === 'publish' ? 'rail__button--active' : ''}`}
              onClick={() => setView('publish')}
              disabled={!status.connected}
              title="Publish (Ctrl/Cmd+2)"
            >
              <span className="rail__icon" aria-hidden="true">
                <IconPublish aria-hidden="true" />
              </span>
              <span className="rail__label">Publish</span>
            </button>
            <button
              className={`rail__button ${view === 'connection' ? 'rail__button--active' : ''}`}
              onClick={() => setView('connection')}
              title="Connection (Ctrl/Cmd+3)"
            >
              <span className="rail__icon" aria-hidden="true">
                <IconConnection aria-hidden="true" />
              </span>
              <span className="rail__label">Connection</span>
            </button>
          </div>
          <div className="rail__footer">
            <button
              className="rail__button"
              onClick={() => setTheme((current) => (current === 'dark' ? 'light' : 'dark'))}
              type="button"
              title="Toggle theme (Ctrl/Cmd+Shift+L)"
            >
              <span className="rail__icon" aria-hidden="true">
                {theme === 'dark' ? (
                  <IconSun aria-hidden="true" />
                ) : (
                  <IconMoon aria-hidden="true" />
                )}
              </span>
              <span className="rail__label">{theme === 'dark' ? 'Light' : 'Dark'} mode</span>
            </button>
          </div>
        </aside>

        <div className="app__shell">
          <header className="app__header">
            <div className="app__header-left">
              <div className="app__title">
                <h1>{viewTitle}</h1>
                <p>{viewDescription}</p>
              </div>
              <div className="app__meta">
                <div className="meta-chip" title={endpointTitle}>
                  <span className="meta-chip__label">
                    {status.connected ? 'Endpoint' : 'Last endpoint'}
                  </span>
                  <span className="meta-chip__value">{endpointLabel}</span>
                  <button
                    className="icon-button meta-chip__action"
                    onClick={handleCopyEndpoint}
                    disabled={!lastEndpoint || !canCopyEndpoint}
                    type="button"
                  >
                    <span className="icon-button__icon" aria-hidden="true">
                      <IconCopy />
                    </span>
                    <span>{copied ? 'Copied' : 'Copy'}</span>
                  </button>
                </div>
                {view === 'monitor' && selectedSub ? (
                  <div className="meta-chip" title={selectedSub.keyexpr}>
                    <span className="meta-chip__label">Stream</span>
                    <span className="meta-chip__value">{selectedSub.keyexpr}</span>
                  </div>
                ) : null}
              </div>
            </div>
            <div className="app__header-right">
              <div className="app__stats">
                <div className="stat">
                  <span className="stat__label">Subscriptions</span>
                  <span className="stat__value">{subscriptionCount}</span>
                </div>
                <div className="stat">
                  <span className="stat__label">Buffered</span>
                  <span className="stat__value">{bufferedCount}</span>
                </div>
                <div className="stat">
                  <span className="stat__label">Keys</span>
                  <span className="stat__value">{keyCount}</span>
                </div>
              </div>
              <div className={`status ${status.connected ? 'status--ok' : 'status--idle'}`}>
                <span className={`dot ${status.connected ? 'dot--ok' : 'dot--idle'}`} />
                <span>{status.connected ? 'Live' : 'Idle'}</span>
              </div>
              <div className="app__actions">
                {view === 'monitor' && selectedSub ? (
                  <>
                    <button
                      className="button button--ghost button--compact"
                      onClick={() => void handleTogglePause()}
                      title="Pause or resume (Ctrl/Cmd+Shift+P)"
                      type="button"
                    >
                      <span className="button__icon" aria-hidden="true">
                        {selectedSub.paused ? <IconPlay /> : <IconPause />}
                      </span>
                      {selectedSub.paused ? 'Resume' : 'Pause'}
                    </button>
                    <button
                      className="button button--ghost button--compact"
                      onClick={() => void handleClearBuffer()}
                      title="Clear buffer (Ctrl/Cmd+Shift+K)"
                      type="button"
                    >
                      <span className="button__icon" aria-hidden="true">
                        <IconTrash />
                      </span>
                      Clear buffer
                    </button>
                  </>
                ) : null}
                {view === 'publish' ? (
                  <>
                    <button
                      className="button button--ghost button--compact"
                      onClick={() => void handleUseKeyexpr()}
                      title={useKeyexprTitle}
                      type="button"
                      disabled={!canUseKeyexpr}
                    >
                      <span className="button__icon" aria-hidden="true">
                        <IconHash />
                      </span>
                      {useKeyexprLabel}
                    </button>
                    <button
                      className="button button--ghost button--compact"
                      onClick={() => void handleLoadLastPublish()}
                      title="Load last publish"
                      type="button"
                      disabled={!lastPublish}
                    >
                      <span className="button__icon" aria-hidden="true">
                        <IconClock />
                      </span>
                      Load last
                    </button>
                    <button
                      className="button button--ghost button--compact"
                      onClick={() => void handleReplayLast()}
                      title="Replay last publish (Ctrl/Cmd+Shift+R)"
                      type="button"
                      disabled={!lastPublish || !status.connected}
                    >
                      <span className="button__icon" aria-hidden="true">
                        <IconReplay />
                      </span>
                      Replay last
                    </button>
                  </>
                ) : null}
                {status.connected ? (
                  <button
                    className="button button--danger button--compact"
                    onClick={() => void handleDisconnect()}
                    title="Disconnect (Ctrl/Cmd+Shift+D)"
                    type="button"
                  >
                    <span className="button__icon" aria-hidden="true">
                      <IconLinkOff />
                    </span>
                    Disconnect
                  </button>
                ) : (
                  <button
                    className="button button--compact"
                    onClick={() => setView('connection')}
                    title="Connection (Ctrl/Cmd+3)"
                    type="button"
                  >
                    <span className="button__icon" aria-hidden="true">
                      <IconConnection />
                    </span>
                    Connect
                  </button>
                )}
                {actionNotice ? (
                  <span className={`header-notice header-notice--${actionNotice.type}`}>
                    {actionNotice.message}
                  </span>
                ) : null}
              </div>
            </div>
          </header>

          <div className="app__body">
            {view === 'monitor' ? (
              <div className="app__content">
                <aside className="sidebar">
                  <SubscribePanel
                    connected={status.connected}
                    subscriptions={subscriptions}
                    selectedSubId={selectedSubId}
                    onSubscribe={subscribe}
                    onUnsubscribe={unsubscribe}
                    onPause={setPaused}
                    onClear={clearBuffer}
                    onSelect={setSelectedSubId}
                  />
                </aside>

                <main className="main main--tabs">
                  <div className="tabs">
                    <button
                      className={`tabs__button ${monitorTab === 'stream' ? 'tabs__button--active' : ''}`}
                      onClick={() => setMonitorTab('stream')}
                      type="button"
                    >
                      <span className="tabs__icon" aria-hidden="true">
                        <IconMonitor />
                      </span>
                      Stream
                      <span className="tabs__badge">{selectedMessages.length}</span>
                    </button>
                    <button
                      className={`tabs__button ${monitorTab === 'keys' ? 'tabs__button--active' : ''}`}
                      onClick={() => setMonitorTab('keys')}
                      type="button"
                    >
                      <span className="tabs__icon" aria-hidden="true">
                        <IconHash />
                      </span>
                      Keys
                      <span className="tabs__badge">{recentKeys.length}</span>
                    </button>
                  </div>
                  <div
                    className={`monitor-panel ${
                      monitorTab === 'stream' ? 'monitor-panel--active' : ''
                    }`}
                  >
                    <StreamView
                      title={streamTitle}
                      messages={selectedMessages}
                      onSelectMessage={setSelectedMessage}
                    />
                  </div>
                  <div
                    className={`monitor-panel ${
                      monitorTab === 'keys' ? 'monitor-panel--active' : ''
                    }`}
                  >
                    <KeyExplorer
                      keys={recentKeys}
                      filter={recentKeysFilter}
                      onFilterChange={setRecentKeysFilter}
                    />
                  </div>
                </main>
              </div>
            ) : null}

            {view === 'publish' ? (
              <div className="app__page app__page--wide">
                <PublishPanel
                  connected={status.connected}
                  publishSupport={publishSupport}
                  draft={publishDraft}
                  onDraftChange={setPublishDraft}
                  onPublish={handlePublish}
                />
                <KeyExplorer
                  keys={recentKeys}
                  filter={recentKeysFilter}
                  onFilterChange={setRecentKeysFilter}
                />
              </div>
            ) : null}

            {view === 'connection' ? (
              <div className="app__page">
                <ConnectPanel
                  status={status}
                  defaultEndpoint={lastEndpoint || undefined}
                  onConnect={connect}
                  onDisconnect={disconnect}
                />
              </div>
            ) : null}
          </div>
        </div>
      </div>

      <MessageDrawer message={selectedMessage} onClose={() => setSelectedMessage(null)} />
    </div>
  );
};

export default App;
