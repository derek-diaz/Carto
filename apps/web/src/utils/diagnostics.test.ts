import { expect, it } from 'vitest';
import { diagnosticStatus, eventLabel, filterEvents, serializeEvents } from './diagnostics';
import type { LogEntry } from './notifications';

const entries: LogEntry[] = [
  {
    id: 'a',
    ts: 2000,
    level: 'error',
    source: 'publish',
    message: 'Publish failed.',
    detail: 'robot/pose: access denied'
  },
  {
    id: 'b',
    ts: 1000,
    level: 'warn',
    source: 'protobuf',
    message: 'Schema unavailable.',
    detail: 'common.proto missing'
  },
  { id: 'c', ts: 0, level: 'info', source: 'connection', message: 'Connection state: connecting.' }
];

it('searches original messages, sources and full details without losing severity or order', () => {
  expect(filterEvents(entries, 'all', ' ACCESS DENIED ')).toEqual([entries[0]]);
  expect(filterEvents(entries, 'warn', 'PROTOBUF')).toEqual([entries[1]]);
  expect(filterEvents(entries, 'error', 'common.proto')).toEqual([]);
  expect(filterEvents(entries, 'all', '')).toEqual(entries);
});

it('makes lifecycle entries readable while retaining original copyable details', () => {
  expect(eventLabel(entries[2])).toBe('Connecting…');
  expect(entries[2].message).toBe('Connection state: connecting.');
  expect(serializeEvents(entries)).toBe(
    '[1970-01-01T00:00:02.000Z] ERROR publish: Publish failed. | robot/pose: access denied\n[1970-01-01T00:00:01.000Z] WARN protobuf: Schema unavailable. | common.proto missing\n[1970-01-01T00:00:00.000Z] INFO connection: Connection state: connecting.'
  );
  expect(serializeEvents([])).toBe('');
});

it('does not label disconnected, reconnecting or failed connections healthy', () => {
  expect(diagnosticStatus({ connected: true })).toBe('Connection healthy');
  expect(diagnosticStatus({ connected: false })).toBe('Not connected');
  expect(diagnosticStatus({ connected: true, health: { state: 'reconnecting' } })).toBe(
    'Reconnecting'
  );
  expect(diagnosticStatus({ connected: false, health: { state: 'connecting' } })).toBe(
    'Connecting'
  );
  expect(diagnosticStatus({ connected: true, error: 'Session lost' })).toBe(
    'Connection needs attention'
  );
});
