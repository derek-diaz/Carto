import type { RecentKeyStats } from '@shared/types';
import { formatAge, formatBytes } from '../utils/format';

type KeyExplorerProps = {
  keys: RecentKeyStats[];
  filter: string;
  onFilterChange: (value: string) => void;
};

const KeyExplorer = ({ keys, filter, onFilterChange }: KeyExplorerProps) => {
  return (
    <section className="panel panel--keys">
      <div className="panel_header">
        <h2>Key explorer</h2>
        <span className="badge badge--idle">{keys.length} keys</span>
      </div>
      <label className="field field--inline">
        <span>Filter</span>
        <input
          type="text"
          placeholder="search keyexpr"
          value={filter}
          onChange={(event) => onFilterChange(event.target.value)}
        />
      </label>
      <div className="table">
        <div className="table_row table_head">
          <div>Key</div>
          <div>Count</div>
          <div>Last seen</div>
          <div>Total bytes</div>
        </div>
        {keys.length === 0 ? (
          <div className="empty">No keys observed yet.</div>
        ) : (
          keys.slice(0, 200).map((entry) => (
            <div key={entry.key} className="table_row">
              <div className="table_key">{entry.key}</div>
              <div>{entry.count}</div>
              <div>{formatAge(entry.lastSeen)}</div>
              <div>{formatBytes(entry.bytes)}</div>
            </div>
          ))
        )}
      </div>
    </section>
  );
};

export default KeyExplorer;
