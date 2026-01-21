import { useEffect, useRef, useState } from 'react';
import type { PublishEncoding } from '@shared/types';

const DEFAULT_KEYEXPR = 'demo/publish';
const DEFAULT_JSON = '{\n  "message": "hello from Carto"\n}';

type PublishPanelProps = {
  connected: boolean;
  publishSupport: 'supported' | 'unknown' | 'unsupported';
  onPublish: (keyexpr: string, payload: string, encoding: PublishEncoding) => Promise<void>;
};

const PublishPanel = ({ connected, publishSupport, onPublish }: PublishPanelProps) => {
  const [keyexpr, setKeyexpr] = useState(DEFAULT_KEYEXPR);
  const [encoding, setEncoding] = useState<PublishEncoding>('json');
  const [payload, setPayload] = useState(DEFAULT_JSON);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ type: 'ok' | 'error'; message: string } | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, []);

  const handlePublish = async () => {
    if (!connected) return;
    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }
    setNotice(null);
    setBusy(true);
    try {
      await onPublish(keyexpr.trim(), payload, encoding);
      setNotice({ type: 'ok', message: 'Sent.' });
      timerRef.current = setTimeout(() => setNotice(null), 2000);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setNotice({ type: 'error', message });
    } finally {
      setBusy(false);
    }
  };

  const renderHelper = () => {
    if (encoding === 'base64') {
      return 'Payload should be base64-encoded bytes.';
    }
    if (encoding === 'json') {
      return 'Payload must be valid JSON.';
    }
    return 'Payload will be sent as UTF-8 text.';
  };

  return (
    <section className="panel panel--publish">
      <div className="panel__header">
        <h2>Publish</h2>
        <span className={`badge ${connected ? 'badge--ok' : 'badge--idle'}`}>
          {connected ? 'Ready' : 'Offline'}
        </span>
      </div>
      <label className="field">
        <span>Key expression</span>
        <input
          type="text"
          value={keyexpr}
          onChange={(event) => setKeyexpr(event.target.value)}
          placeholder="demo/publish"
          disabled={!connected || busy}
        />
      </label>
      <div className="field">
        <span>Encoding</span>
        <div className="segmented">
          <button
            className={`segmented__button ${encoding === 'json' ? 'segmented__button--active' : ''}`}
            onClick={() => {
              setEncoding('json');
              if (!payload.trim()) setPayload(DEFAULT_JSON);
            }}
            type="button"
            disabled={!connected || busy}
          >
            JSON
          </button>
          <button
            className={`segmented__button ${encoding === 'text' ? 'segmented__button--active' : ''}`}
            onClick={() => setEncoding('text')}
            type="button"
            disabled={!connected || busy}
          >
            Text
          </button>
          <button
            className={`segmented__button ${encoding === 'base64' ? 'segmented__button--active' : ''}`}
            onClick={() => setEncoding('base64')}
            type="button"
            disabled={!connected || busy}
          >
            Base64
          </button>
        </div>
        <span className="helper">{renderHelper()}</span>
      </div>
      <label className="field">
        <span>Payload</span>
        <textarea
          value={payload}
          onChange={(event) => setPayload(event.target.value)}
          rows={6}
          placeholder={encoding === 'base64' ? 'aGVsbG8=' : 'message'}
          disabled={!connected || busy}
        />
      </label>
      <div className="panel__actions">
        <button
          className="button"
          onClick={handlePublish}
          disabled={!connected || busy || !keyexpr.trim()}
        >
          Send message
        </button>
      </div>
      {connected && publishSupport === 'unsupported' ? (
        <div className="panel__error">
          Publishing is not advertised by the current driver. The request may fail.
        </div>
      ) : null}
      {notice ? (
        <div className={`notice ${notice.type === 'ok' ? 'notice--ok' : 'notice--error'}`}>
          {notice.message}
        </div>
      ) : null}
    </section>
  );
};

export default PublishPanel;
