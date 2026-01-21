import { useEffect, useMemo, useState } from 'react';
import type { CartoMessage } from '@shared/types';
import logoUrl from '@shared/logo.png';
import ConnectPanel from './components/ConnectPanel';
import KeyExplorer from './components/KeyExplorer';
import MessageDrawer from './components/MessageDrawer';
import PublishPanel from './components/PublishPanel';
import StreamView from './components/StreamView';
import SubscribePanel from './components/SubscribePanel';
import { useCarto } from './store/useCarto';

const App = () => {
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    if (typeof window === 'undefined') return 'light';
    const stored = window.localStorage.getItem('carto.theme');
    if (stored === 'light' || stored === 'dark') return stored;
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  });
  const {
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
  } = useCarto();

  const [selectedMessage, setSelectedMessage] = useState<CartoMessage | null>(null);

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
    window.localStorage.setItem('carto.theme', theme);
  }, [theme]);

  const publishSupport = useMemo<'supported' | 'unknown' | 'unsupported'>(() => {
    const features = status.capabilities?.features;
    if (!features || features.length === 0) return 'unknown';
    return features.includes('publish') ? 'supported' : 'unsupported';
  }, [status.capabilities]);

  return (
    <div className="app">
      <div className="app__frame">
        <header className="app__header">
          <div className="app__header-left">
            <div className="app__brand">
              <img className="app__logo" src={logoUrl} alt="Carto logo" />
              <div>
                <h1>Carto</h1>
                <p>Inspect Zenoh traffic in real time.</p>
              </div>
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
            <button
              className="button button--ghost button--compact theme-toggle"
              onClick={() => setTheme((current) => (current === 'dark' ? 'light' : 'dark'))}
              type="button"
            >
              {theme === 'dark' ? 'Light mode' : 'Dark mode'}
            </button>
          </div>
        </header>

        <div className="app__nav">
          <button
            className={`nav__button ${view === 'monitor' ? 'nav__button--active' : ''}`}
            onClick={() => setView('monitor')}
            disabled={!status.connected}
          >
            Monitor
          </button>
          <button
            className={`nav__button ${view === 'publish' ? 'nav__button--active' : ''}`}
            onClick={() => setView('publish')}
            disabled={!status.connected}
          >
            Publish
          </button>
          <button
            className={`nav__button ${view === 'connection' ? 'nav__button--active' : ''}`}
            onClick={() => setView('connection')}
          >
            Connection
          </button>
        </div>

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

            <main className="main">
              <StreamView title={streamTitle} messages={selectedMessages} onSelectMessage={setSelectedMessage} />
              <KeyExplorer
                keys={recentKeys}
                filter={recentKeysFilter}
                onFilterChange={setRecentKeysFilter}
              />
            </main>
          </div>
        ) : null}

        {view === 'publish' ? (
          <div className="app__page app__page--wide">
            <PublishPanel
              connected={status.connected}
              publishSupport={publishSupport}
              onPublish={publish}
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
            <ConnectPanel status={status} onConnect={connect} onDisconnect={disconnect} />
          </div>
        ) : null}
      </div>

      <MessageDrawer message={selectedMessage} onClose={() => setSelectedMessage(null)} />
    </div>
  );
};

export default App;
