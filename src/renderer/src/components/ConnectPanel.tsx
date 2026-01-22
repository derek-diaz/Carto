import { useEffect, useState } from 'react';
import type { ConnectionStatus } from '@shared/types';
import { IconLinkOff, IconPlug } from './Icons';

const DEFAULT_ENDPOINT = 'ws://127.0.0.1:10000/';

type ConnectPanelProps = {
  status: ConnectionStatus;
  defaultEndpoint?: string;
  onConnect: (endpoint: string, configJson?: string) => Promise<void>;
  onDisconnect: () => Promise<void>;
};

const ConnectPanel = ({ status, defaultEndpoint, onConnect, onDisconnect }: ConnectPanelProps) => {
  const [endpoint, setEndpoint] = useState(defaultEndpoint ?? DEFAULT_ENDPOINT);
  const [configJson, setConfigJson] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!defaultEndpoint) return;
    setEndpoint((current) => (current === DEFAULT_ENDPOINT || !current.trim() ? defaultEndpoint : current));
  }, [defaultEndpoint]);

  const handleConnect = async () => {
    setBusy(true);
    try {
      await onConnect(endpoint, configJson || undefined);
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
            <span className="button__icon" aria-hidden="true">
              <IconLinkOff />
            </span>
            Disconnect
          </button>
        ) : (
          <button className="button" onClick={handleConnect} disabled={busy || !endpoint.trim()}>
            <span className="button__icon" aria-hidden="true">
              <IconPlug />
            </span>
            Connect
          </button>
        )}
      </div>
      {status.error ? <div className="panel__error">{status.error}</div> : null}
    </section>
  );
};

export default ConnectPanel;
