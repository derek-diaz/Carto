import { useEffect, useRef, useState } from 'react';
import type { ConnectionStatus } from '@shared/types';
import { IconClose, IconLinkOff, IconPlug } from './Icons';

const DEFAULT_ENDPOINT = 'ws://127.0.0.1:10000/';

type ConnectPanelProps = {
  status: ConnectionStatus;
  defaultEndpoint?: string;
  onConnect: (endpoint: string, configJson?: string) => Promise<void>;
  onDisconnect: () => Promise<void>;
};

const MAX_CONNECT_ATTEMPTS = 3;
const CONNECT_TIMEOUT_MS = 6000;
const RETRY_DELAY_MS = 600;

const ConnectPanel = ({ status, defaultEndpoint, onConnect, onDisconnect }: ConnectPanelProps) => {
  const [endpoint, setEndpoint] = useState(defaultEndpoint ?? DEFAULT_ENDPOINT);
  const [configJson, setConfigJson] = useState('');
  const [busy, setBusy] = useState(false);
  const [infoMessage, setInfoMessage] = useState<string | null>(null);
  const [infoTone, setInfoTone] = useState<'progress' | 'warning'>('progress');
  const [localError, setLocalError] = useState<string | null>(null);
  const cancelRef = useRef(false);
  const cancelConnectRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!defaultEndpoint) return;
    setEndpoint((current) =>
      current === DEFAULT_ENDPOINT || !current.trim() ? defaultEndpoint : current
    );
  }, [defaultEndpoint]);

  useEffect(() => {
    if (!status.connected) return;
    setBusy(false);
    setInfoMessage(null);
    setInfoTone('progress');
    setLocalError(null);
    cancelRef.current = false;
    cancelConnectRef.current = null;
  }, [status.connected]);

  const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  const connectWithTimeout = async (nextEndpoint: string, nextConfigJson?: string) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let cancel: ((reason?: unknown) => void) | null = null;
    const cancelPromise = new Promise<void>((_, reject) => {
      cancel = reject;
    });
    cancelConnectRef.current = () => cancel?.(new Error('Canceled.'));
    try {
      await Promise.race([
        onConnect(nextEndpoint, nextConfigJson),
        new Promise<void>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error(`Connection timed out after ${CONNECT_TIMEOUT_MS / 1000}s.`)),
            CONNECT_TIMEOUT_MS
          );
        }),
        cancelPromise
      ]);
    } finally {
      if (timer) clearTimeout(timer);
      if (cancelConnectRef.current) cancelConnectRef.current = null;
    }
  };

  const handleCancel = () => {
    if (!busy) return;
    cancelRef.current = true;
    cancelConnectRef.current?.();
    cancelConnectRef.current = null;
    setInfoTone('warning');
    setInfoMessage('Canceled.');
    setBusy(false);
  };

  const handleConnect = async () => {
    const trimmedEndpoint = endpoint.trim();
    if (!trimmedEndpoint) {
      setLocalError('Endpoint is required.');
      return;
    }
    const config = configJson.trim() ? configJson : undefined;

    cancelRef.current = false;
    setBusy(true);
    setLocalError(null);
    try {
      let lastError: unknown = null;
      for (let attempt = 1; attempt <= MAX_CONNECT_ATTEMPTS; attempt += 1) {
        if (cancelRef.current) {
          setInfoTone('warning');
          setInfoMessage('Canceled.');
          return;
        }
        setInfoTone('progress');
        setInfoMessage(`Connecting (attempt ${attempt} of ${MAX_CONNECT_ATTEMPTS})...`);
        try {
          await connectWithTimeout(trimmedEndpoint, config);
          setInfoMessage(null);
          return;
        } catch (error) {
          if (cancelRef.current) {
            setInfoTone('warning');
            setInfoMessage('Canceled.');
            return;
          }
          lastError = error;
          if (attempt < MAX_CONNECT_ATTEMPTS) {
            setInfoMessage('Retrying...');
            try {
              await onDisconnect();
            } catch {
              // ignore disconnect errors between retries
            }
            await delay(RETRY_DELAY_MS);
          }
        }
      }
      const message = lastError instanceof Error ? lastError.message : String(lastError ?? '');
      setLocalError(message || 'Unable to connect to the endpoint.');
    } catch {
      // errors are surfaced via status events
      setLocalError('Unable to connect to the endpoint.');
    } finally {
      if (!cancelRef.current) {
        setBusy(false);
        setInfoMessage(null);
        setInfoTone('progress');
      }
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
      <div className="panel_header">
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
          onChange={(event) => {
            setEndpoint(event.target.value);
            setLocalError(null);
          }}
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
          onChange={(event) => {
            setConfigJson(event.target.value);
            setLocalError(null);
          }}
          placeholder='{"locator": "ws://127.0.0.1:10000/", "messageResponseTimeoutMs": 5000}'
          rows={4}
          disabled={busy}
        />
      </label>
      <div className="panel_actions">
        {status.connected ? (
          <button className="button button--ghost" onClick={handleDisconnect} disabled={busy}>
            <span className="button_icon" aria-hidden="true">
              <IconLinkOff />
            </span>{' '}Disconnect
          </button>
        ) : (
          <>
            <button className="button" onClick={handleConnect} disabled={busy || !endpoint.trim()}>
              <span className="button_icon" aria-hidden="true">
                <IconPlug />
              </span>{' '}Connect
            </button>
            {busy ? (
              <button className="button button--ghost" onClick={handleCancel} type="button">
                <span className="button_icon" aria-hidden="true">
                  <IconClose />
                </span>{' '}Cancel
              </button>
            ) : null}
          </>
        )}
      </div>
      {infoMessage ? (
        <div className={`notice notice--info notice--info-${infoTone}`}>{infoMessage}</div>
      ) : null}
      {localError ? <div className="notice notice--error">{localError}</div> : null}
      {status.error ? <div className="panel_error">{status.error}</div> : null}
    </section>
  );
};

export default ConnectPanel;

