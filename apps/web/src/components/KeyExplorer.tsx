import type { RecentKeyStats } from '@shared/types';
import { formatAge, formatBytes } from '../utils/format';
import { IconClose, IconSearch } from './Icons';

type KeyExplorerProps = {
  keys: RecentKeyStats[];
  filter: string;
  selectedKey: string | null;
  onFilterChange: (value: string) => void;
  onSelectKey: (value: string) => void;
};

const KeyExplorer = ({
  keys,
  filter,
  selectedKey,
  onFilterChange,
  onSelectKey
}: KeyExplorerProps) => {
  const countLabel = `${keys.length} key${keys.length === 1 ? '' : 's'}`;

  return (
    <section className="panel panel--keys key_explorer">
      <div className="panel_header">
        <label className="stream_search">
          <div className="input-group input-group--filter">
            <span className="input-group_icon" aria-hidden="true">
              <IconSearch />
            </span>
            <input
              type="text"
              placeholder="Filter by keyexpr..."
              value={filter}
              onChange={(event) => onFilterChange(event.target.value)}
              aria-label="Filter keys"
            />
            {filter ? (
              <button
                className="icon-button icon-button--compact icon-button--ghost"
                onClick={() => onFilterChange('')}
                type="button"
                aria-label="Clear key filter"
              >
                <span className="icon-button_icon" aria-hidden="true">
                  <IconClose />
                </span>
              </button>
            ) : null}
          </div>
        </label>
        <div className="panel_actions">
          <span className="badge badge--idle">{countLabel}</span>
        </div>
      </div>
      <div className="keys">
        <div className="keys_head">
          <div>Key</div>
          <div>Count</div>
          <div>Last seen</div>
          <div>Total bytes</div>
        </div>
        {keys.length === 0 ? (
          <div className="empty">No keys observed yet.</div>
        ) : (
          keys.slice(0, 200).map((entry) => (
            <button
              key={entry.key}
              className={`keys_row ${selectedKey === entry.key ? 'keys_row--active' : ''}`}
              onClick={() => onSelectKey(entry.key)}
              type="button"
            >
              <div className="keys_key">{entry.key}</div>
              <div className="keys_metric">{entry.count}</div>
              <div className="keys_metric keys_metric--muted">{formatAge(entry.lastSeen)}</div>
              <div className="keys_metric">{formatBytes(entry.bytes)}</div>
            </button>
          ))
        )}
      </div>
    </section>
  );
};

export default KeyExplorer;
