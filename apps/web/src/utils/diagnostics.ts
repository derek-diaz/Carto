import type { ConnectionStatus } from '@shared/types';
import type { LogEntry, LogLevel } from './notifications';

export const eventLabel = (entry: LogEntry) => {
  if (entry.source === 'connection') {
    if (entry.message === 'Connection state: connecting.') return 'Connecting…';
    if (entry.message === 'Connection state: reconnecting.') return 'Reconnecting…';
  }
  return entry.message;
};

export const filterEvents = (entries: LogEntry[], level: 'all' | LogLevel, query: string) => {
  const search = query.trim().toLowerCase();
  return entries.filter(
    (entry) =>
      (level === 'all' || entry.level === level) &&
      (!search ||
        [entry.message, entry.source, entry.detail ?? '', eventLabel(entry)].some((value) =>
          value.toLowerCase().includes(search)
        ))
  );
};

export const serializeEvents = (entries: LogEntry[]) =>
  entries
    .map(
      (entry) =>
        `[${new Date(entry.ts).toISOString()}] ${entry.level.toUpperCase()} ${entry.source}: ${entry.message}${entry.detail ? ` | ${entry.detail}` : ''}`
    )
    .join('\n');

export const diagnosticStatus = (status: ConnectionStatus) => {
  if (status.health?.state === 'reconnecting') return 'Reconnecting';
  if (status.health?.state === 'connecting') return 'Connecting';
  if (status.error) return 'Connection needs attention';
  return status.connected ? 'Connection healthy' : 'Not connected';
};
