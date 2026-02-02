import { useMemo, useState } from 'react';
import type { LogEntry, LogLevel } from '../utils/notifications';
import { IconCopy, IconTrash } from './Icons';

type LogsPanelProps = {
  entries: LogEntry[];
  onClear: () => void;
};

const levelLabels: Record<LogLevel, string> = {
  info: 'Info',
  warn: 'Warn',
  error: 'Error'
};

const formatTimestamp = (ts: number) => {
  const date = new Date(ts);
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
};

const LogsPanel = ({ entries, onClear }: LogsPanelProps) => {
  const [filter, setFilter] = useState<'all' | LogLevel>('all');
  const [query, setQuery] = useState('');
  const [copied, setCopied] = useState(false);

  const filtered = useMemo(() => {
    const trimmed = query.trim().toLowerCase();
    return entries.filter((entry) => {
      if (filter !== 'all' && entry.level !== filter) return false;
      if (!trimmed) return true;
      return (
        entry.message.toLowerCase().includes(trimmed) ||
        entry.source.toLowerCase().includes(trimmed) ||
        (entry.detail ? entry.detail.toLowerCase().includes(trimmed) : false)
      );
    });
  }, [entries, filter, query]);

  const handleCopy = async () => {
    if (typeof navigator === 'undefined' || !navigator.clipboard?.writeText) return;
    const lines = filtered.map((entry) => {
      const detail = entry.detail ? ` | ${entry.detail}` : '';
      return `[${new Date(entry.ts).toISOString()}] ${entry.level.toUpperCase()} ${
        entry.source
      }: ${entry.message}${detail}`;
    });
    try {
      await navigator.clipboard.writeText(lines.join('\n'));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore clipboard errors
    }
  };

  return (
    <section className="panel">
      <div className="panel_header">
        <h2>Logs</h2>
        <div className="panel_actions">
          <button
            className="button button--ghost button--compact"
            type="button"
            onClick={handleCopy}
            disabled={filtered.length === 0}
          >
            <span className="button_icon" aria-hidden="true">
              <IconCopy />
            </span>{' '}Copy
          </button>
          <button
            className="button button--danger button--compact"
            type="button"
            onClick={onClear}
            disabled={entries.length === 0}
          >
            <span className="button_icon" aria-hidden="true">
              <IconTrash />
            </span>{' '}Clear
          </button>
        </div>
      </div>

      <div className="logs_toolbar">
        <div className="segmented">
          {(['all', 'info', 'warn', 'error'] as const).map((level) => (
            <button
              key={level}
              className={`segmented_button ${filter === level ? 'segmented_button--active' : ''}`}
              type="button"
              onClick={() => setFilter(level)}
            >
              {level === 'all' ? 'All' : levelLabels[level]}
            </button>
          ))}
        </div>
        <label className="field logs_search">
          <span>Search</span>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Filter logs"
          />
        </label>
      </div>

      {copied ? <div className="notice notice--ok">Copied to clipboard.</div> : null}

      <div className="logs_list">
        {filtered.length === 0 ? (
          <div className="empty">No log entries yet.</div>
        ) : (
          filtered.map((entry) => (
            <div key={entry.id} className={`log_row log_row--${entry.level}`}>
              <div className="log_meta">
                <span className="log_time">{formatTimestamp(entry.ts)}</span>{' '}
                <span className="log_level">{entry.level.toUpperCase()}</span>{' '}
                <span className="log_source">{entry.source}</span>
              </div>
              <div className="log_message">{entry.message}</div>
              {entry.detail ? <div className="log_detail">{entry.detail}</div> : null}
            </div>
          ))
        )}
      </div>
    </section>
  );
};

export default LogsPanel;
