import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PublishEncoding } from '@shared/types';
import type { LogInput, ToastInput } from '../utils/notifications';
import type { ProtoTypeOption } from '../utils/proto';
import { IconChevronDown, IconClose, IconPublish } from './Icons';

export const DEFAULT_PUBLISH_KEYEXPR = 'demo/publish';
export const DEFAULT_PUBLISH_JSON = '{\n  "message": "hello from Carto"\n}';
const KEYEXPR_HISTORY_KEY = 'carto.keyexpr.publish.history';
const KEYEXPR_HISTORY_DETAILS_KEY = 'carto.keyexpr.publish.details';
const MAX_KEYEXPR_HISTORY = 8;
const HISTORY_EVENT = 'carto.history.updated';

export type PublishDraft = {
  keyexpr: string;
  encoding: PublishEncoding | 'protobuf';
  payload: string;
  protoTypeId?: string;
};

type PublishPanelProps = {
  connected: boolean;
  publishSupport: 'supported' | 'unknown' | 'unsupported';
  draft: PublishDraft;
  onDraftChange: (next: PublishDraft) => void;
  onPublish: (
    keyexpr: string,
    payload: string,
    encoding: PublishDraft['encoding'],
    protoTypeId?: string
  ) => Promise<void>;
  onLog: (entry: LogInput) => void;
  onToast: (toast: ToastInput) => void;
  protoTypes: ProtoTypeOption[];
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
  onPublish,
  onLog,
  onToast,
  protoTypes
}: PublishPanelProps) => {
  const [busy, setBusy] = useState(false);
  const [keyexprHistory, setKeyexprHistory] = useState<string[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const comboRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const historyRef = useRef<string[]>([]);
  const detailsRef = useRef<Record<string, PublishDraft>>({});
  const suppressHistoryOpenRef = useRef(false);

  const applyHistory = useCallback((entries: string[]) => {
    historyRef.current = entries;
    setKeyexprHistory(entries);
  }, []);

  const notifyHistoryUpdated = useCallback(() => {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(new CustomEvent(HISTORY_EVENT, { detail: { type: 'publish' } }));
  }, []);

  const commitHistory = useCallback(
    (entries: string[]) => {
      applyHistory(entries);
      persistHistory(entries);
      notifyHistoryUpdated();
    },
    [applyHistory, notifyHistoryUpdated]
  );

  const loadDetails = useCallback(() => {
    if (typeof globalThis === 'undefined' || !('localStorage' in globalThis)) return {};
    const stored = globalThis.localStorage.getItem(KEYEXPR_HISTORY_DETAILS_KEY);
    if (!stored) return {};
    try {
      const parsed = JSON.parse(stored);
      if (!parsed || typeof parsed !== 'object') return {};
      const next: Record<string, PublishDraft> = {};
      Object.entries(parsed as Record<string, unknown>).forEach(([key, value]) => {
        if (!value || typeof value !== 'object') return;
        const entry = value as PublishDraft;
        if (typeof entry.encoding !== 'string' || typeof entry.payload !== 'string') return;
        next[key] = {
          keyexpr: key,
          encoding: entry.encoding,
          payload: entry.payload,
          protoTypeId: entry.protoTypeId
        };
      });
      return next;
    } catch {
      return {};
    }
  }, []);

  const persistDetails = useCallback((next: Record<string, PublishDraft>) => {
    if ('localStorage' in globalThis) {
      globalThis.localStorage.setItem(KEYEXPR_HISTORY_DETAILS_KEY, JSON.stringify(next));
    }
  }, []);

  const handleRemoveHistory = useCallback(
    (entry: string) => {
      const next = historyRef.current.filter((item) => item !== entry);
      commitHistory(next);
      const details = { ...detailsRef.current };
      if (details[entry]) {
        delete details[entry];
        detailsRef.current = details;
        persistDetails(details);
      }
    },
    [commitHistory, persistDetails]
  );

  useEffect(() => {
    if (typeof globalThis === 'undefined' || !('localStorage' in globalThis)) return;
    const stored = globalThis.localStorage.getItem(KEYEXPR_HISTORY_KEY);
    if (!stored) return;
    try {
      const parsed = JSON.parse(stored);
      if (Array.isArray(parsed)) {
        const entries = parsed.filter((entry) => typeof entry === 'string');
        applyHistory(entries);
      }
    } catch {
      // ignore history parse errors
    }
  }, [applyHistory]);

  useEffect(() => {
    detailsRef.current = loadDetails();
  }, [loadDetails]);

  useEffect(() => {
    const keyexpr = draft.keyexpr.trim();
    if (!keyexpr) return;
    if (!historyRef.current.includes(keyexpr)) return;
    const details = { ...detailsRef.current };
    details[keyexpr] = {
      keyexpr,
      encoding: draft.encoding,
      payload: draft.payload,
      protoTypeId: draft.protoTypeId
    };
    detailsRef.current = details;
    persistDetails(details);
  }, [draft.encoding, draft.keyexpr, draft.payload, draft.protoTypeId, persistDetails]);

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

  useEffect(() => {
    const handleHistoryUpdate = (event: Event) => {
      const detail = (event as CustomEvent<{ type?: string }>).detail;
      if (detail?.type && detail.type !== 'publish') return;
      if (typeof globalThis === 'undefined' || !('localStorage' in globalThis)) return;
      const stored = globalThis.localStorage.getItem(KEYEXPR_HISTORY_KEY);
      if (!stored) {
        applyHistory([]);
        return;
      }
      try {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed)) {
          const entries = parsed.filter((entry) => typeof entry === 'string');
          applyHistory(entries);
        }
      } catch {
        // ignore history parse errors
      }
      detailsRef.current = loadDetails();
    };
    window.addEventListener(HISTORY_EVENT, handleHistoryUpdate as EventListener);
    return () => window.removeEventListener(HISTORY_EVENT, handleHistoryUpdate as EventListener);
  }, [applyHistory, loadDetails]);

  const handlePublish = async () => {
    if (!connected) return;
    const nextKeyexpr = draft.keyexpr.trim();
    if (draft.encoding === 'protobuf' && !draft.protoTypeId) {
      onToast({ type: 'warn', message: 'Select a protobuf type first.' });
      return;
    }
    setBusy(true);
    try {
      await onPublish(nextKeyexpr, draft.payload, draft.encoding, draft.protoTypeId);
      if (nextKeyexpr) {
        const next = mergeHistory(historyRef.current, [nextKeyexpr]);
        commitHistory(next);
        const details = { ...detailsRef.current };
        details[nextKeyexpr] = {
          keyexpr: nextKeyexpr,
          encoding: draft.encoding,
          payload: draft.payload,
          protoTypeId: draft.protoTypeId
        };
        detailsRef.current = details;
        persistDetails(details);
      }
      onToast({ type: 'ok', message: 'Sent', detail: nextKeyexpr });
      onLog({ level: 'info', source: 'publish', message: `Published to ${nextKeyexpr}.` });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      onToast({ type: 'error', message: 'Publish failed', detail: message });
      onLog({ level: 'error', source: 'publish', message, detail: nextKeyexpr });
    } finally {
      setBusy(false);
    }
  };

  const applyHistorySelection = useCallback(
    (entry: string) => {
      const stored = detailsRef.current[entry];
      if (!stored) {
        onDraftChange({ ...draft, keyexpr: entry });
        return;
      }

      const next: PublishDraft = {
        keyexpr: entry,
        encoding: stored.encoding,
        payload: stored.payload,
        protoTypeId: stored.protoTypeId
      };

      if (stored.encoding === 'protobuf') {
        const hasType = stored.protoTypeId
          ? protoTypes.some((type) => type.id === stored.protoTypeId)
          : false;
        if (!hasType) {
          const fallback = protoTypes[0]?.id;
          if (fallback) {
            next.protoTypeId = fallback;
          } else {
            next.encoding = 'json';
            next.protoTypeId = undefined;
          }
        }
      }

      onDraftChange(next);
    },
    [draft, onDraftChange, protoTypes]
  );

  const renderHelper = () => {
    if (draft.encoding === 'protobuf') {
      return 'Payload must be valid JSON for the selected protobuf type.';
    }
    if (draft.encoding === 'base64') {
      return 'Payload should be base64-encoded bytes.';
    }
    if (draft.encoding === 'json') {
      return 'Payload must be valid JSON.';
    }
    return 'Payload will be sent as UTF-8 text.';
  };

  const selectedProtoType = useMemo(
    () => protoTypes.find((type) => type.id === draft.protoTypeId),
    [draft.protoTypeId, protoTypes]
  );

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
              if (suppressHistoryOpenRef.current) {
                suppressHistoryOpenRef.current = false;
                return;
              }
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
                  <div key={entry} className="combo_option">
                    <button
                      className="combo_option_button"
                      type="button"
                      role="option"
                      onClick={() => {
                        applyHistorySelection(entry);
                        setShowHistory(false);
                        suppressHistoryOpenRef.current = true;
                        inputRef.current?.focus();
                      }}
                    >
                      {entry}
                    </button>
                    <button
                      className="icon-button icon-button--compact icon-button--ghost combo_option_remove"
                      type="button"
                      title={`Remove ${entry}`}
                      aria-label={`Remove ${entry} from history`}
                      onClick={() => handleRemoveHistory(entry)}
                    >
                      <span className="icon-button_icon" aria-hidden="true">
                        <IconClose />
                      </span>
                    </button>
                  </div>
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
          <button
            className={`segmented_button ${draft.encoding === 'protobuf' ? 'segmented_button--active' : ''}`}
            onClick={() => {
              const nextTypeId = draft.protoTypeId ?? protoTypes[0]?.id;
              const next: PublishDraft = {
                ...draft,
                encoding: 'protobuf',
                protoTypeId: nextTypeId
              };
              if (!draft.payload.trim()) next.payload = DEFAULT_PUBLISH_JSON;
              onDraftChange(next);
            }}
            type="button"
            disabled={!connected || busy || protoTypes.length === 0}
          >
            Protobuf
          </button>
        </div>
        <span className="helper">{renderHelper()}</span>
      </div>
      {draft.encoding === 'protobuf' ? (
        <label className="field">
          <span>Protobuf type</span>
          <select
            value={draft.protoTypeId ?? ''}
            onChange={(event) =>
              onDraftChange({ ...draft, protoTypeId: event.target.value || undefined })
            }
            disabled={!connected || busy || protoTypes.length === 0}
          >
            <option value="">Select a message type</option>
            {protoTypes.map((type) => (
              <option key={type.id} value={type.id}>
                {type.label}
              </option>
            ))}
          </select>
          {selectedProtoType ? (
            <span className="helper">Encoding as {selectedProtoType.name}.</span>
          ) : null}
        </label>
      ) : null}
      <label className="field">
        <span>Payload</span>
        <textarea
          value={draft.payload}
          onChange={(event) => onDraftChange({ ...draft, payload: event.target.value })}
          rows={6}
          placeholder={
            draft.encoding === 'base64'
              ? 'aGVsbG8='
              : draft.encoding === 'protobuf'
                ? '{ "id": "abc123" }'
                : 'message'
          }
          disabled={!connected || busy}
        />
      </label>
      <div className="panel_actions">
        <button
          className="button"
          onClick={handlePublish}
          disabled={
            !connected ||
            busy ||
            !draft.keyexpr.trim() ||
            (draft.encoding === 'protobuf' && !draft.protoTypeId)
          }
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
    </section>
  );
};

export default PublishPanel;
