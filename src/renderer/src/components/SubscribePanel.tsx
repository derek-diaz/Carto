import { useState } from 'react';
import type { Subscription } from '../store/useCarto';
import { IconPause, IconPlay, IconPlus, IconStop, IconTrash } from './Icons';

const DEFAULT_KEYEXPR = 'demo/**';

type SubscribePanelProps = {
  connected: boolean;
  subscriptions: Subscription[];
  selectedSubId: string | null;
  onSubscribe: (keyexpr: string, bufferSize?: number) => Promise<string>;
  onUnsubscribe: (subscriptionId: string) => Promise<void>;
  onPause: (subscriptionId: string, paused: boolean) => Promise<void>;
  onClear: (subscriptionId: string) => Promise<void>;
  onSelect: (subscriptionId: string) => void;
};

const SubscribePanel = ({
  connected,
  subscriptions,
  selectedSubId,
  onSubscribe,
  onUnsubscribe,
  onPause,
  onClear,
  onSelect
}: SubscribePanelProps) => {
  const [keyexpr, setKeyexpr] = useState(DEFAULT_KEYEXPR);
  const [bufferSize, setBufferSize] = useState('200');
  const [busy, setBusy] = useState(false);

  const handleSubscribe = async () => {
    setBusy(true);
    try {
      const size = Number(bufferSize);
      await onSubscribe(keyexpr.trim(), Number.isFinite(size) && size > 0 ? size : undefined);
    } catch {
      // errors are surfaced via status events
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="panel">
      <div className="panel__header">
        <h2>Subscribe</h2>
        <span className="badge badge--idle">{subscriptions.length} active</span>
      </div>
      <label className="field">
        <span>Key expression</span>
        <input
          type="text"
          value={keyexpr}
          onChange={(event) => setKeyexpr(event.target.value)}
          placeholder="demo/**"
          disabled={!connected || busy}
        />
      </label>
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
          disabled={!connected || busy || !keyexpr.trim()}
        >
          <span className="button__icon" aria-hidden="true">
            <IconPlus />
          </span>
          Start
        </button>
      </div>

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
