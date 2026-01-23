import { useEffect, useRef, useState } from 'react';
import type { Subscription } from '../store/useCarto';
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

type SubscribePanelProps = {
  connected: boolean;
  subscriptions: Subscription[];
  selectedSubId: string | null;
  onSubscribe: (keyexpr: string, bufferSize?: number) => Promise<string>;
  onUnsubscribe: (subscriptionId: string) => Promise<void>;
  onPause: (subscriptionId: string, paused: boolean) => Promise<void>;
  onClear: (subscriptionId: string) => Promise<void>;
  onSelect: (subscriptionId: string) => void;
  onClose?: () => void;
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
  onClose
}: SubscribePanelProps) => {
  const [keyexpr, setKeyexpr] = useState(DEFAULT_KEYEXPR);
  const [keyexprHistory, setKeyexprHistory] = useState<string[]>([]);
  const [bufferSize, setBufferSize] = useState('200');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const comboRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const historyRef = useRef<string[]>([]);

  const trimmedKeyexpr = keyexpr.trim();
  const validationError = trimmedKeyexpr ? getKeyexprError(trimmedKeyexpr) : null;
  const displayError = validationError ?? error;

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

  const updateHistory = (entries: string[]) => {
    historyRef.current = entries;
    setKeyexprHistory(entries);
    persistHistory(entries);
  };

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
        updateHistory(entries);
      }
    } catch {
      // ignore history parse errors
    }
  }, []);

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
      updateHistory(next);
    }
  }, [subscriptions]);

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

  const handleSubscribe = async () => {
    const nextKeyexpr = keyexpr.trim();
    const keyexprError = nextKeyexpr ? getKeyexprError(nextKeyexpr) : null;
    if (keyexprError) {
      setError(keyexprError);
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const size = Number(bufferSize);
      await onSubscribe(nextKeyexpr, Number.isFinite(size) && size > 0 ? size : undefined);
      const next = mergeHistory(historyRef.current, [nextKeyexpr]);
      updateHistory(next);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setError(message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="panel panel--subscribe">
      <div className="panel__header">
        <h2>Subscribe</h2>
        <div className="panel__actions">
          <span className="badge badge--idle">{subscriptions.length} active</span>
          {onClose ? (
            <button
              className="icon-button icon-button--compact icon-button--ghost"
              onClick={onClose}
              type="button"
              title="Close"
              aria-label="Close"
            >
              <span className="icon-button__icon" aria-hidden="true">
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
            className="combo__input"
            type="text"
            value={keyexpr}
            onChange={(event) => setKeyexpr(event.target.value)}
            onFocus={() => {
              if (keyexprHistory.length > 0) setShowHistory(true);
            }}
            placeholder="demo/**"
            disabled={!connected || busy}
          />
          <button
            className="combo__toggle"
            type="button"
            onClick={() => setShowHistory((prev) => !prev)}
            aria-label="Toggle key expression history"
            disabled={!connected || busy}
          >
            <span className="combo__icon" aria-hidden="true">
              <IconChevronDown />
            </span>
          </button>
          {showHistory ? (
            <div className="combo__menu" role="listbox">
              {keyexprHistory.length === 0 ? (
                <div className="combo__empty">No saved keyexprs yet.</div>
              ) : (
                keyexprHistory.map((entry) => (
                  <button
                    key={entry}
                    className="combo__option"
                    type="button"
                    role="option"
                    onClick={() => {
                      setKeyexpr(entry);
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
      <div className="helper">Pick a recent keyexpr from the dropdown or type a new one.</div>
      <label className="field">
        <span>Ring buffer</span>
        <input
          type="number"
          min={10}
          max={5000}
          value={bufferSize}
          onChange={(event) => setBufferSize(event.target.value)}
          disabled={!connected || busy}
        />
      </label>
      <div className="panel__actions">
        <button
          className="button"
          onClick={handleSubscribe}
          disabled={!connected || busy || !trimmedKeyexpr || Boolean(validationError)}
        >
          <span className="button__icon" aria-hidden="true">
            <IconPlus />
          </span>
          Start
        </button>
      </div>
      {displayError ? <div className="panel__error">{displayError}</div> : null}

      <div className="list">
        {subscriptions.length === 0 ? (
          <div className="empty">No active subscriptions yet.</div>
        ) : (
          subscriptions.map((sub) => (
            <div
              key={sub.id}
              className={`list__row ${selectedSubId === sub.id ? 'list__row--active' : ''}`}
              onClick={() => onSelect(sub.id)}
            >
              <div className="list__meta">
                <div className="list__title">{sub.keyexpr}</div>
                <div className="list__subtitle">Buffer {sub.bufferSize}</div>
              </div>
              <div className="list__actions">
                <button
                  className="button button--ghost"
                  onClick={(event) => {
                    event.stopPropagation();
                    void onPause(sub.id, !sub.paused).catch(() => {});
                  }}
                >
                  <span className="button__icon" aria-hidden="true">
                    {sub.paused ? <IconPlay /> : <IconPause />}
                  </span>
                  {sub.paused ? 'Resume' : 'Pause'}
                </button>
                <button
                  className="button button--ghost"
                  onClick={(event) => {
                    event.stopPropagation();
                    void onClear(sub.id).catch(() => {});
                  }}
                >
                  <span className="button__icon" aria-hidden="true">
                    <IconTrash />
                  </span>
                  Clear
                </button>
                <button
                  className="button button--danger"
                  onClick={(event) => {
                    event.stopPropagation();
                    void onUnsubscribe(sub.id).catch(() => {});
                  }}
                >
                  <span className="button__icon" aria-hidden="true">
                    <IconStop />
                  </span>
                  Stop
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
