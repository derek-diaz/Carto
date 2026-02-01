import { useCallback, useEffect, useRef, useState } from 'react';
import type { PublishEncoding } from '@shared/types';
import { IconChevronDown, IconPublish } from './Icons';

export const DEFAULT_PUBLISH_KEYEXPR = 'demo/publish';
export const DEFAULT_PUBLISH_JSON = '{\n  "message": "hello from Carto"\n}';
const KEYEXPR_HISTORY_KEY = 'carto.keyexpr.publish.history';
const MAX_KEYEXPR_HISTORY = 8;

export type PublishDraft = {
  keyexpr: string;
  encoding: PublishEncoding;
  payload: string;
};

type PublishPanelProps = {
  connected: boolean;
  publishSupport: 'supported' | 'unknown' | 'unsupported';
  draft: PublishDraft;
  onDraftChange: (next: PublishDraft) => void;
  onPublish: (keyexpr: string, payload: string, encoding: PublishEncoding) => Promise<void>;
};

const mergeHistory = (base: string[], add: string[]) => {
  const combined = [...add, ...base];
  const seen = new Set<string>();
  const next: string[] = [];
  for (const entry of combined) {
    if (!seen.has(entry)) {
      seen.add(entry);
      next.push(entry);
    }
  }
  return next.slice(0, MAX_KEYEXPR_HISTORY);
};

const persistHistory = (entries: string[]) => {
  if ('localStorage' in globalThis) {
    globalThis.localStorage.setItem(KEYEXPR_HISTORY_KEY, JSON.stringify(entries));
  }
};

const PublishPanel = ({
  connected,
  publishSupport,
  draft,
  onDraftChange,
  onPublish
}: PublishPanelProps) => {
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ type: 'ok' | 'error'; message: string } | null>(null);
  const [keyexprHistory, setKeyexprHistory] = useState<string[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const comboRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const historyRef = useRef<string[]>([]);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const updateHistory = useCallback((entries: string[]) => {
    historyRef.current = entries;
    setKeyexprHistory(entries);
    persistHistory(entries);
  }, []);

  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (typeof globalThis === 'undefined' || !('localStorage' in globalThis)) return;
    const stored = globalThis.localStorage.getItem(KEYEXPR_HISTORY_KEY);
    if (!stored) return;
    try {
      const parsed = JSON.parse(stored);
      if (Array.isArray(parsed)) {
        const entries = parsed.filter((entry) => typeof entry === 'string');
        updateHistory(entries);
      }
    } catch {
      // ignore history parse errors
    }
  }, [updateHistory]);

  useEffect(() => {
    if (!showHistory) return;
    const handlePointerDown = (event: MouseEvent) => {
      if (!comboRef.current) return;
      if (comboRef.current.contains(event.target as Node)) return;
      setShowHistory(false);
    };
    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [showHistory]);

  const handlePublish = async () => {
    if (!connected) return;
    const nextKeyexpr = draft.keyexpr.trim();
    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }
    setNotice(null);
    setBusy(true);
    try {
      await onPublish(nextKeyexpr, draft.payload, draft.encoding);
      if (nextKeyexpr) {
        const next = mergeHistory(historyRef.current, [nextKeyexpr]);
        updateHistory(next);
      }
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
    if (draft.encoding === 'base64') {
      return 'Payload should be base64-encoded bytes.';
    }
    if (draft.encoding === 'json') {
      return 'Payload must be valid JSON.';
    }
    return 'Payload will be sent as UTF-8 text.';
  };

  return (
    <section className="panel panel--publish">
      <div className="panel_header">
        <h2>Publish</h2>
        <span className={`badge ${connected ? 'badge--ok' : 'badge--idle'}`}>
          {connected ? 'Ready' : 'Offline'}
        </span>
      </div>
      <label className="field field--combo">
        <span>Key expression</span>
        <div className="combo" ref={comboRef}>
          <input
            ref={inputRef}
            className="combo_input"
            type="text"
            value={draft.keyexpr}
            onChange={(event) => onDraftChange({ ...draft, keyexpr: event.target.value })}
            onFocus={() => {
              if (keyexprHistory.length > 0) setShowHistory(true);
            }}
            placeholder="demo/publish"
            disabled={!connected || busy}
          />
          <button
            className="combo_toggle"
            type="button"
            onClick={() => setShowHistory((prev) => !prev)}
            aria-label="Toggle key expression history"
            disabled={!connected || busy}
          >
            <span className="combo_icon" aria-hidden="true">
              <IconChevronDown />
            </span>
          </button>
          {showHistory ? (
            <div className="combo_menu" role="listbox">
              {keyexprHistory.length === 0 ? (
                <div className="combo_empty">No saved keyexprs yet.</div>
              ) : (
                keyexprHistory.map((entry) => (
                  <button
                    key={entry}
                    className="combo_option"
                    type="button"
                    role="option"
                    onClick={() => {
                      onDraftChange({ ...draft, keyexpr: entry });
                      setShowHistory(false);
                      inputRef.current?.focus();
                    }}
                  >
                    {entry}
                  </button>
                ))
              )}
            </div>
          ) : null}
        </div>
      </label>
      <div className="field">
        <span>Encoding</span>
        <div className="segmented">
          <button
            className={`segmented_button ${draft.encoding === 'json' ? 'segmented_button--active' : ''}`}
            onClick={() => {
              const next: PublishDraft = { ...draft, encoding: 'json' };
              if (!draft.payload.trim()) next.payload = DEFAULT_PUBLISH_JSON;
              onDraftChange(next);
            }}
            type="button"
            disabled={!connected || busy}
          >
            JSON
          </button>
          <button
            className={`segmented_button ${draft.encoding === 'text' ? 'segmented_button--active' : ''}`}
            onClick={() => onDraftChange({ ...draft, encoding: 'text' })}
            type="button"
            disabled={!connected || busy}
          >
            Text
          </button>
          <button
            className={`segmented_button ${draft.encoding === 'base64' ? 'segmented_button--active' : ''}`}
            onClick={() => onDraftChange({ ...draft, encoding: 'base64' })}
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
          value={draft.payload}
          onChange={(event) => onDraftChange({ ...draft, payload: event.target.value })}
          rows={6}
          placeholder={draft.encoding === 'base64' ? 'aGVsbG8=' : 'message'}
          disabled={!connected || busy}
        />
      </label>
      <div className="panel_actions">
        <button
          className="button"
          onClick={handlePublish}
          disabled={!connected || busy || !draft.keyexpr.trim()}
        >
          <span className="button_icon" aria-hidden="true">
            <IconPublish />
          </span>{' '}Send message
        </button>
      </div>
      {connected && publishSupport === 'unsupported' ? (
        <div className="panel_error">
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

