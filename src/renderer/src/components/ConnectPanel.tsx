import { useState } from 'react';
import type { ConnectionStatus } from '@shared/types';

const DEFAULT_ENDPOINT = 'ws://127.0.0.1:10000/';

type ConnectPanelProps = {
  status: ConnectionStatus;
  onConnect: (endpoint: string, configJson?: string, driver?: 'remote' | 'tap') => Promise<void>;
  onDisconnect: () => Promise<void>;
};

const ConnectPanel = ({ status, onConnect, onDisconnect }: ConnectPanelProps) => {
  const [endpoint, setEndpoint] = useState(DEFAULT_ENDPOINT);
  const [configJson, setConfigJson] = useState('');
  const [useMockTap, setUseMockTap] = useState(false);
  const [busy, setBusy] = useState(false);

  const handleConnect = async () => {
    setBusy(true);
    try {
      await onConnect(endpoint, configJson || undefined, useMockTap ? 'tap' : 'remote');
    } catch {
      // errors are surfaced via status events
    } finally {
      setBusy(false);
    }
  };

  const handleDisconnect = async () => {
    setBusy(true);
    try {
      await onDisconnect();
    } catch {
      // errors are surfaced via status events
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="panel panel--accent">
      <div className="panel__header">
        <h2>Connect</h2>
        <span className={`badge ${status.connected ? 'badge--ok' : 'badge--idle'}`}>
          {status.connected ? 'Connected' : 'Offline'}
        </span>
      </div>
      <label className="field">
        <span>Router endpoint</span>
        <input
          type="text"
          value={endpoint}
          onChange={(event) => setEndpoint(event.target.value)}
          placeholder="ws://127.0.0.1:10000/"
          disabled={busy || status.connected}
        />
      </label>
      <label className="field">
        <span>Mode</span>
        <input type="text" value="client" disabled />
      </label>
      <label className="field field--inline">
        <input
          type="checkbox"
          checked={useMockTap}
          onChange={(event) => setUseMockTap(event.target.checked)}
          disabled={busy || status.connected}
        />
        <span>Use mock tap (no router needed)</span>
      </label>
      <label className="field">
        <span>Config JSON (optional)</span>
        <textarea
          value={configJson}
          onChange={(event) => setConfigJson(event.target.value)}
          placeholder='{"locator": "ws://127.0.0.1:10000/", "messageResponseTimeoutMs": 5000}'
          rows={4}
          disabled={busy}
        />
      </label>
      <div className="panel__actions">
        {status.connected ? (
          <button className="button button--ghost" onClick={handleDisconnect} disabled={busy}>
            Disconnect
          </button>
        ) : (
          <button className="button" onClick={handleConnect} disabled={busy || !endpoint.trim()}>
            Connect
          </button>
        )}
      </div>
      {status.error ? <div className="panel__error">{status.error}</div> : null}
      {status.capabilities ? (
        <div className="panel__capabilities">
          <div className="meta">
            <span className="meta__label">Driver</span>
            <span>{status.capabilities.driver}</span>
          </div>
          <div className="meta">
            <span className="meta__label">Zenoh</span>
            <span>{status.capabilities.zenoh ?? 'unknown'}</span>
          </div>
          <div className="meta">
            <span className="meta__label">Remote API</span>
            <span>{status.capabilities.remoteApi ?? 'unknown'}</span>
          </div>
          <div className="meta">
            <span className="meta__label">Features</span>
            <span>{status.capabilities.features.join(', ')}</span>
          </div>
        </div>
      ) : null}
    </section>
  );
};

export default ConnectPanel;
