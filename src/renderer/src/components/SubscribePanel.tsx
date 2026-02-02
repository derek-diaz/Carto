import { useCallback, useEffect, useRef, useState } from 'react';
import type { Subscription } from '../store/useCarto';
import type { LogInput, ToastInput } from '../utils/notifications';
import type { DecoderConfig, ProtoTypeOption } from '../utils/proto';
import {
  IconChevronDown,
  IconClose,
  IconPause,
  IconPlay,
  IconPlus,
  IconStop,
  IconTrash
} from './Icons';
import { getKeyexprError } from '@shared/keyexpr';

const DEFAULT_KEYEXPR = 'demo/**';
const KEYEXPR_HISTORY_KEY = 'carto.keyexpr.history';
const MAX_KEYEXPR_HISTORY = 8;
const HISTORY_EVENT = 'carto.history.updated';

type SubscribePanelProps = {
  connected: boolean;
  subscriptions: Subscription[];
  selectedSubId: string | null;
  onSubscribe: (keyexpr: string, bufferSize?: number, decoder?: DecoderConfig) => Promise<string>;
  onUnsubscribe: (subscriptionId: string) => Promise<void>;
  onPause: (subscriptionId: string, paused: boolean) => Promise<void>;
  onClear: (subscriptionId: string) => Promise<void>;
  onSelect: (subscriptionId: string) => void;
  onLog: (entry: LogInput) => void;
  onToast: (toast: ToastInput) => void;
  protoTypes: ProtoTypeOption[];
  decoderById: Record<string, DecoderConfig | undefined>;
  protoTypeLabels: Record<string, string>;
  onClose?: () => void;
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

const SubscribePanel = ({
  connected,
  subscriptions,
  selectedSubId,
  onSubscribe,
  onUnsubscribe,
  onPause,
  onClear,
  onSelect,
  onLog,
  onToast,
  protoTypes,
  decoderById,
  protoTypeLabels,
  onClose
}: SubscribePanelProps) => {
  const [keyexpr, setKeyexpr] = useState(DEFAULT_KEYEXPR);
  const [keyexprHistory, setKeyexprHistory] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [decoderMode, setDecoderMode] = useState<'raw' | 'protobuf'>('raw');
  const [protoTypeId, setProtoTypeId] = useState('');
  const comboRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const historyRef = useRef<string[]>([]);
  const suppressHistoryOpenRef = useRef(false);

  const trimmedKeyexpr = keyexpr.trim();
  const validationError = trimmedKeyexpr ? getKeyexprError(trimmedKeyexpr) : null;
  const displayError = validationError ?? error;

  const applyHistory = useCallback((entries: string[]) => {
    historyRef.current = entries;
    setKeyexprHistory(entries);
  }, []);

  const notifyHistoryUpdated = useCallback(() => {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(new CustomEvent(HISTORY_EVENT, { detail: { type: 'subscribe' } }));
  }, []);

  const commitHistory = useCallback(
    (entries: string[]) => {
      applyHistory(entries);
      persistHistory(entries);
      notifyHistoryUpdated();
    },
    [applyHistory, notifyHistoryUpdated]
  );

  const handleRemoveHistory = useCallback(
    (entry: string) => {
      const next = historyRef.current.filter((item) => item !== entry);
      commitHistory(next);
    },
    [commitHistory]
  );

  useEffect(() => {
    setError(null);
  }, [keyexpr]);

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
    if (subscriptions.length === 0) return;
    const next = mergeHistory(
      historyRef.current,
      subscriptions.map((sub) => sub.keyexpr)
    );
    const current = historyRef.current;
    const isSame =
      next.length === current.length && next.every((entry, index) => entry === current[index]);
    if (!isSame) {
      commitHistory(next);
    }
  }, [commitHistory, subscriptions]);

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
      if (detail?.type && detail.type !== 'subscribe') return;
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
    };
    window.addEventListener(HISTORY_EVENT, handleHistoryUpdate as EventListener);
    return () => window.removeEventListener(HISTORY_EVENT, handleHistoryUpdate as EventListener);
  }, [applyHistory]);

  useEffect(() => {
    if (decoderMode !== 'protobuf') return;
    if (!protoTypeId) return;
    if (protoTypes.some((type) => type.id === protoTypeId)) return;
    setProtoTypeId('');
  }, [decoderMode, protoTypeId, protoTypes]);

  useEffect(() => {
    if (!selectedSubId) return;
    const decoder = decoderById[selectedSubId];
    if (!decoder || decoder.kind === 'raw') {
      setDecoderMode('raw');
      setProtoTypeId('');
      return;
    }
    setDecoderMode('protobuf');
    setProtoTypeId(decoder.typeId);
  }, [decoderById, selectedSubId]);

  const reportError = (source: string, message: string, detail?: string) => {
    setError(message);
    onToast({ type: 'error', message, detail });
    onLog({ level: 'error', source, message, detail });
  };

  const handleAction = async (
    action: () => Promise<void>,
    source: string,
    detail?: string
  ) => {
    try {
      await action();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      reportError(source, message, detail);
    }
  };

  const handleSubscribe = async () => {
    const nextKeyexpr = keyexpr.trim();
    const keyexprError = nextKeyexpr ? getKeyexprError(nextKeyexpr) : null;
    if (keyexprError) {
      setError(keyexprError);
      return;
    }

    if (decoderMode === 'protobuf' && !protoTypeId) {
      setError('Select a protobuf type before subscribing.');
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const decoder: DecoderConfig | undefined =
        decoderMode === 'protobuf' && protoTypeId
          ? { kind: 'protobuf', typeId: protoTypeId }
          : { kind: 'raw' };
      await onSubscribe(nextKeyexpr, undefined, decoder);
      const next = mergeHistory(historyRef.current, [nextKeyexpr]);
      commitHistory(next);
      onLog({ level: 'info', source: 'subscribe', message: `Subscribed to ${nextKeyexpr}.` });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      reportError('subscribe', message, nextKeyexpr);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="panel panel--subscribe">
      <div className="panel_header">
        <h2>Subscribe</h2>
        <div className="panel_actions">
          <span className="badge badge--idle">{subscriptions.length} active</span>{onClose ? (
            <button
              className="icon-button icon-button--compact icon-button--ghost"
              onClick={onClose}
              type="button"
              title="Close"
              aria-label="Close"
            >
              <span className="icon-button_icon" aria-hidden="true">
                <IconClose />
              </span>
            </button>
          ) : null}
        </div>
      </div>
      <label className="field field--combo">
        <span>Key expression</span>
        <div className="combo" ref={comboRef}>
          <input
            ref={inputRef}
            className="combo_input"
            type="text"
            value={keyexpr}
            onChange={(event) => setKeyexpr(event.target.value)}
            onFocus={() => {
              if (suppressHistoryOpenRef.current) {
                suppressHistoryOpenRef.current = false;
                return;
              }
              if (keyexprHistory.length > 0) setShowHistory(true);
            }}
            placeholder="demo/**"
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
                      setKeyexpr(entry);
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
      <div className="helper">Pick a recent keyexpr from the dropdown or type a new one.</div>
      <label className="field">
        <span>Decoder</span>
        <div className="segmented">
          <button
            className={`segmented_button ${decoderMode === 'raw' ? 'segmented_button--active' : ''}`}
            type="button"
            onClick={() => setDecoderMode('raw')}
          >
            Raw
          </button>
          <button
            className={`segmented_button ${decoderMode === 'protobuf' ? 'segmented_button--active' : ''}`}
            type="button"
            onClick={() => setDecoderMode('protobuf')}
            disabled={protoTypes.length === 0}
          >
            Protobuf
          </button>
        </div>
        {protoTypes.length === 0 ? (
          <span className="helper">Add a .proto schema to enable decoding.</span>
        ) : null}
      </label>
      {decoderMode === 'protobuf' ? (
        <label className="field">
          <span>Protobuf type</span>
          <select value={protoTypeId} onChange={(event) => setProtoTypeId(event.target.value)}>
            <option value="">Select a message type</option>
            {protoTypes.map((type) => (
              <option key={type.id} value={type.id}>
                {type.label}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <div className="panel_actions">
        <button
          className="button"
          onClick={handleSubscribe}
          disabled={
            !connected ||
            busy ||
            !trimmedKeyexpr ||
            Boolean(validationError) ||
            (decoderMode === 'protobuf' && !protoTypeId)
          }
        >
          <span className="button_icon" aria-hidden="true">
            <IconPlus />
          </span>{' '}Start
        </button>
      </div>
      {displayError ? <div className="panel_error">{displayError}</div> : null}

      <div className="list">
        {subscriptions.length === 0 ? (
          <div className="empty">No active subscriptions yet.</div>
        ) : (
          subscriptions.map((sub) => (
            <div
              key={sub.id}
              className={`list_row ${selectedSubId === sub.id ? 'list_row--active' : ''}`}
              onClick={() => onSelect(sub.id)}
            >
              <div className="list_meta">
                <div className="list_title">{sub.keyexpr}</div>
                <div className="list_subtitle">
                  <span className="list_decoder">
                    {decoderById[sub.id]?.kind === 'protobuf'
                      ? `Protobuf: ${protoTypeLabels[decoderById[sub.id]?.typeId ?? ''] ?? 'Unknown'}`
                      : 'Raw'}
                  </span>
                </div>
              </div>
              <div className="list_actions">
                <button
                  className="button button--ghost"
                  onClick={(event) => {
                    event.stopPropagation();
                    handleAction(
                      () => onPause(sub.id, !sub.paused),
                      'subscribe',
                      `Pause toggle for ${sub.keyexpr}`
                    );
                  }}
                >
                  <span className="button_icon" aria-hidden="true">
                    {sub.paused ? <IconPlay /> : <IconPause />}
                  </span>{' '}{sub.paused ? 'Resume' : 'Pause'}
                </button>
                <button
                  className="button button--ghost"
                  onClick={(event) => {
                    event.stopPropagation();
                    handleAction(
                      () => onClear(sub.id),
                      'subscribe',
                      `Clear buffer for ${sub.keyexpr}`
                    );
                  }}
                >
                  <span className="button_icon" aria-hidden="true">
                    <IconTrash />
                  </span>{' '}Clear
                </button>
                <button
                  className="button button--danger"
                  onClick={(event) => {
                    event.stopPropagation();
                    handleAction(
                      () => onUnsubscribe(sub.id),
                      'subscribe',
                      `Unsubscribe ${sub.keyexpr}`
                    );
                  }}
                >
                  <span className="button_icon" aria-hidden="true">
                    <IconStop />
                  </span>{' '}Stop
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </section>
  );
};

export default SubscribePanel;
