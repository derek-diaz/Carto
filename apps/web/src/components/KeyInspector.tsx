import type { RecentKeyStats } from '@shared/types';
import { formatAge, formatBytes } from '../utils/format';
import { IconClose } from './Icons';

type KeyInspectorProps = {
  keyStat: RecentKeyStats | null;
  subscriptionLabel?: string;
  onClose: () => void;
};

const KeyInspector = ({ keyStat, subscriptionLabel, onClose }: KeyInspectorProps) => {
  if (!keyStat) {
    return (
      <aside className="monitor_inspector monitor_inspector--empty monitor_inspector--dock">
        <div className="monitor_inspector-empty">
          <span className="monitor_eyebrow">Key inspector</span>
          <h3>Select a key</h3>
          <p>
            Pick any key row to inspect activity totals, payload volume, and the most recent
            traffic snapshot for that keyexpr.
          </p>
        </div>
      </aside>
    );
  }

  const averageSize = keyStat.count > 0 ? Math.round(keyStat.bytes / keyStat.count) : 0;
  const countLabel = `${keyStat.count} msg${keyStat.count === 1 ? '' : 's'}`;

  return (
    <aside className="monitor_inspector monitor_inspector--dock key_inspector">
      <div className="monitor_inspector-header">
        <div className="monitor_inspector-title">
          <span className="monitor_eyebrow">Key inspector</span>
          <h3>{keyStat.key}</h3>
          <p>
            {subscriptionLabel ? `${subscriptionLabel} • ` : ''}
            Last activity {formatAge(keyStat.lastSeen)} ago
          </p>
        </div>
        <div className="monitor_inspector-header-actions">
          <span className="badge badge--idle monitor_inspector-badge">{countLabel}</span>
          <button
            className="icon-button icon-button--ghost icon-button--compact"
            onClick={onClose}
            type="button"
            aria-label="Clear key selection"
            title="Clear key selection"
          >
            <span className="icon-button_icon" aria-hidden="true">
              <IconClose />
            </span>
          </button>
        </div>
      </div>

      <div className="monitor_inspector-layout monitor_inspector-layout--dock">
        <div className="monitor_inspector-main key_inspector-main">
          <div className="key_inspector-summary">
            <div className="key_inspector-copy">
              <span className="monitor_eyebrow">Activity snapshot</span>
              <h4>Volume and recency for the selected key</h4>
              <p>
                Use this pane to spot noisy keys quickly, compare payload weight, and decide
                whether you need to switch back to the stream tab for message-level inspection.
              </p>
            </div>

            <div className="key_inspector-stats">
              <div className="key_inspector-stat">
                <span className="key_inspector-stat-label">Messages</span>
                <strong>{keyStat.count}</strong>
                <span className="key_inspector-stat-meta">currently buffered</span>
              </div>
              <div className="key_inspector-stat">
                <span className="key_inspector-stat-label">Total bytes</span>
                <strong>{formatBytes(keyStat.bytes)}</strong>
                <span className="key_inspector-stat-meta">across this key</span>
              </div>
              <div className="key_inspector-stat">
                <span className="key_inspector-stat-label">Average size</span>
                <strong>{formatBytes(averageSize)}</strong>
                <span className="key_inspector-stat-meta">per message</span>
              </div>
              <div className="key_inspector-stat">
                <span className="key_inspector-stat-label">Last payload</span>
                <strong>{formatBytes(keyStat.lastSize)}</strong>
                <span className="key_inspector-stat-meta">most recent sample</span>
              </div>
            </div>
          </div>
        </div>

        <aside className="monitor_inspector-context key_inspector-context">
          <div className="monitor_stat">
            <span className="monitor_stat-label">Key</span>
            <span className="monitor_stat-value">{keyStat.key}</span>
          </div>
          <div className="monitor_stat">
            <span className="monitor_stat-label">Last seen</span>
            <span className="monitor_stat-value">{new Date(keyStat.lastSeen).toLocaleString()}</span>
          </div>
          <div className="monitor_stat">
            <span className="monitor_stat-label">Total bytes</span>
            <span className="monitor_stat-value">{formatBytes(keyStat.bytes)}</span>
          </div>
          <div className="monitor_stat">
            <span className="monitor_stat-label">Last payload size</span>
            <span className="monitor_stat-value">{formatBytes(keyStat.lastSize)}</span>
          </div>
        </aside>
      </div>
    </aside>
  );
};

export default KeyInspector;
