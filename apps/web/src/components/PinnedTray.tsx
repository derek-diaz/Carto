import type { CartoMessage } from '@shared/types';
import { Pin, X } from 'lucide-react';
import { Button } from './ui/button';
import { formatBytes, formatTime } from '../utils/format';

export function PinnedTray({
  messages,
  selectedId,
  onSelect,
  onUnpin
}: {
  messages: CartoMessage[];
  selectedId?: string;
  onSelect: (message: CartoMessage) => void;
  onUnpin: (id: string) => void;
}) {
  return (
    <div
      className="monitor-pinned-tray"
      id="monitor-pinned-tray"
      role="region"
      aria-label="Pinned evidence"
    >
      {messages.length === 0 ? (
        <p>Pin a message in the inspector to keep its full payload in this session.</p>
      ) : (
        messages.map((message) => (
          <div
            className="monitor-pinned-item"
            data-selected={selectedId === message.id}
            key={message.id}
          >
            <Button
              variant="ghost"
              className="monitor-pinned-select"
              onClick={() => onSelect(message)}
              title={message.key}
            >
              <Pin className="size-3 shrink-0" />
              <span>
                <code>{message.key}</code>
                <small>
                  {formatTime(message.ts)} · {formatBytes(message.sizeBytes)}
                </small>
              </span>
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              className="rounded-sm shrink-0"
              aria-label={`Unpin ${message.key}`}
              onClick={() => onUnpin(message.id)}
            >
              <X className="size-3.5" />
            </Button>
          </div>
        ))
      )}
    </div>
  );
}
