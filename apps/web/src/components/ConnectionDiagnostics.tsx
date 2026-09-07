import { useEffect, useMemo, useState } from 'react';
import { Collapsible } from '@base-ui/react/collapsible';
import { ChevronDown, Copy, Trash2 } from 'lucide-react';
import { createColumnHelper } from '@tanstack/react-table';
import type { ConnectionStatus } from '@shared/types';
import type { LogEntry, LogLevel } from '../utils/notifications';
import { diagnosticStatus, eventLabel, filterEvents, serializeEvents } from '../utils/diagnostics';
import { DataTable, dataTableFeatures } from './DataTable';
import { Button } from './ui/button';
import { Input } from './ui/input';

const levelLabels: Record<LogLevel, string> = { info: 'Info', warn: 'Warning', error: 'Error' };
const formatTimestamp = (ts: number) =>
  new Date(ts).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });

const column = createColumnHelper<typeof dataTableFeatures, LogEntry>();
const columns = column.columns([
  column.accessor('ts', {
    header: 'Time',
    sortFn: (a, b) => a.original.ts - b.original.ts,
    cell: ({ row }) => (
      <span className="font-mono text-xs whitespace-nowrap">
        {formatTimestamp(row.original.ts)}
      </span>
    )
  }),
  column.accessor('level', {
    header: 'Level',
    sortFn: (a, b) => a.original.level.localeCompare(b.original.level),
    cell: ({ row }) => (
      <span
        className={row.original.level === 'error' ? 'text-destructive' : 'text-muted-foreground'}
      >
        {levelLabels[row.original.level]}
      </span>
    )
  }),
  column.accessor('source', {
    header: 'Source',
    sortFn: (a, b) => a.original.source.localeCompare(b.original.source)
  }),
  column.accessor('message', {
    header: 'Message',
    enableSorting: false,
    cell: ({ row }) => (
      <div className="min-w-48">
        <p>{row.original.message}</p>
        {row.original.detail && (
          <pre className="mt-1 whitespace-pre-wrap break-all text-xs text-muted-foreground">
            {row.original.detail}
          </pre>
        )}
      </div>
    )
  })
]);

export default function ConnectionDiagnostics({
  entries,
  status,
  onClear
}: {
  entries: LogEntry[];
  status: ConnectionStatus;
  onClear: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [level, setLevel] = useState<'all' | LogLevel>('all');
  const [query, setQuery] = useState('');
  const [feedback, setFeedback] = useState('');
  const filtered = useMemo(() => filterEvents(entries, level, query), [entries, level, query]);
  const errors = entries.filter((entry) => entry.level === 'error').length;
  const warnings = entries.filter((entry) => entry.level === 'warn').length;
  const issueSummary = [
    errors ? `${errors} error${errors === 1 ? '' : 's'}` : '',
    warnings ? `${warnings} warning${warnings === 1 ? '' : 's'}` : ''
  ]
    .filter(Boolean)
    .join(' · ');
  useEffect(() => {
    if (!feedback) return;
    const timer = setTimeout(() => setFeedback(''), 3000);
    return () => clearTimeout(timer);
  }, [feedback]);
  const copyEntries = expanded ? filtered : entries;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(serializeEvents(copyEntries));
      setFeedback(`Copied ${copyEntries.length} event${copyEntries.length === 1 ? '' : 's'}.`);
    } catch {
      setFeedback('Clipboard unavailable. Expand diagnostics to select and copy the text.');
    }
  };
  return (
    <section
      aria-label="Connection diagnostics"
      className="mx-auto mb-10 w-full max-w-3xl px-6 text-foreground max-sm:px-4"
    >
      <Collapsible.Root open={expanded} onOpenChange={setExpanded} className="border-t pt-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">Recent events</h2>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              className="rounded-sm text-xs text-muted-foreground"
              disabled={!copyEntries.length}
              onClick={() => void copy()}
              title={
                expanded
                  ? 'Copy matching events with full details'
                  : 'Copy all recorded events with full details'
              }
            >
              <Copy className="size-3.5" />
              Copy
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="rounded-sm text-xs text-muted-foreground"
              disabled={!entries.length}
              title="Clear recorded events for this app session"
              onClick={() => {
                onClear();
                setQuery('');
                setLevel('all');
                setExpanded(false);
                setFeedback('Events cleared.');
              }}
            >
              <Trash2 className="size-3.5" />
              Clear
            </Button>
          </div>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          <span className="font-medium">{diagnosticStatus(status)}</span>
          {issueSummary
            ? ` · ${issueSummary} recorded`
            : status.connected
              ? ' · No recorded warnings or errors'
              : ''}
        </p>
        {feedback && (
          <p role="status" className="mt-2 text-xs text-muted-foreground">
            {feedback}
          </p>
        )}
        {!entries.length && (
          <p className="mt-3 text-xs text-muted-foreground">
            Connection and runtime events appear here during this session.
          </p>
        )}
        {!expanded && entries.length > 0 && (
          <ol aria-label="Recent runtime events" className="mt-3 divide-y divide-border/50">
            {entries.slice(0, 5).map((entry) => (
              <li
                key={entry.id}
                className="grid grid-cols-[70px_minmax(0,1fr)] items-baseline gap-x-3 py-2 text-xs sm:grid-cols-[70px_minmax(0,1fr)_auto]"
              >
                <time
                  dateTime={new Date(entry.ts).toISOString()}
                  title={new Date(entry.ts).toLocaleString()}
                  className="font-mono tabular-nums text-muted-foreground"
                >
                  {formatTimestamp(entry.ts)}
                </time>
                <span className="line-clamp-2 min-w-0 break-words" title={entry.message}>
                  <span
                    className={
                      entry.level === 'error' ? 'text-destructive' : 'text-muted-foreground'
                    }
                    title={levelLabels[entry.level]}
                    aria-label={levelLabels[entry.level]}
                  >
                    {entry.level === 'info' ? '·' : '!'}{' '}
                  </span>
                  {eventLabel(entry)}
                </span>
                <span className="hidden text-[11px] text-muted-foreground sm:block">
                  {entry.source}
                </span>
              </li>
            ))}
          </ol>
        )}
        {entries.length > 0 && (
          <Collapsible.Trigger
            render={
              <Button
                variant="ghost"
                size="sm"
                className="group mt-2 -ml-2 rounded-sm text-xs text-muted-foreground"
              />
            }
          >
            <ChevronDown className={`size-3.5 ${expanded ? 'rotate-180' : ''}`} />
            {expanded ? 'Hide diagnostics' : 'View diagnostics'}{' '}
            <span className="tabular-nums">({entries.length})</span>
          </Collapsible.Trigger>
        )}
        <Collapsible.Panel className="space-y-3 pt-3">
          <div className="flex flex-wrap items-center gap-2">
            <div role="group" aria-label="Event severity" className="flex items-center gap-0.5">
              {(['all', 'info', 'warn', 'error'] as const).map((value) => (
                <Button
                  key={value}
                  variant={level === value ? 'secondary' : 'ghost'}
                  size="sm"
                  className="rounded-sm px-2 text-xs"
                  aria-pressed={level === value}
                  onClick={() => setLevel(value)}
                >
                  {value === 'all' ? 'All' : levelLabels[value]}
                </Button>
              ))}
            </div>
            <Input
              aria-label="Search diagnostics"
              type="search"
              placeholder="Search events, sources, and details…"
              className="h-8 min-w-48 flex-1 rounded-sm text-xs"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
          {filtered.length ? (
            <div className="max-h-80 overflow-auto [&>div]:rounded-sm [&_td]:px-3 [&_td]:py-2 [&_td]:text-xs [&_th_button]:h-7 [&_th_button]:text-xs">
              <DataTable data={filtered} columns={columns} label="Runtime diagnostics" />
            </div>
          ) : (
            <p className="py-3 text-xs text-muted-foreground">No events match your filters.</p>
          )}
          <p className="text-[11px] text-muted-foreground">
            Up to 200 events from this app session. Details and copied text retain the original
            messages.
          </p>
        </Collapsible.Panel>
      </Collapsible.Root>
    </section>
  );
}
