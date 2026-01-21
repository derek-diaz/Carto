import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { FixedSizeList } from 'react-window';
import AutoSizer from 'react-virtualized-auto-sizer';
import type { CartoMessage } from '@shared/types';
import { formatBytes, formatTime } from '../utils/format';

const ROW_HEIGHT = 56;

export type StreamViewProps = {
  title: string;
  messages: CartoMessage[];
  onSelectMessage: (msg: CartoMessage) => void;
};

type RowData = {
  messages: CartoMessage[];
  onSelect: (msg: CartoMessage) => void;
};

const StreamView = ({ title, messages, onSelectMessage }: StreamViewProps) => {
  const listRef = useRef<FixedSizeList<RowData> | null>(null);
  const listSizeRef = useRef({ height: 0 });
  const [followLatest, setFollowLatest] = useState(true);

  useEffect(() => {
    if (!followLatest || messages.length === 0) return;
    listRef.current?.scrollToItem(messages.length - 1, 'end');
  }, [messages.length, followLatest]);

  const handleJumpToLatest = () => {
    if (messages.length === 0) return;
    listRef.current?.scrollToItem(messages.length - 1, 'end');
  };

  const handleScroll = ({
    scrollOffset,
    scrollUpdateWasRequested
  }: {
    scrollOffset: number;
    scrollUpdateWasRequested: boolean;
  }) => {
    if (scrollUpdateWasRequested || !followLatest) return;
    const height = listSizeRef.current.height;
    if (!height) return;
    const totalHeight = messages.length * ROW_HEIGHT;
    const maxOffset = Math.max(0, totalHeight - height);
    const isAtBottom = scrollOffset >= maxOffset - ROW_HEIGHT;
    if (!isAtBottom) {
      setFollowLatest(false);
    }
  };

  return (
    <section className="panel panel--stream">
      <div className="panel__header">
        <h2>{title}</h2>
        <div className="panel__actions">
          <button
            className={`button button--ghost button--compact ${
              followLatest ? 'button--active' : ''
            }`}
            onClick={() => setFollowLatest((prev) => !prev)}
            type="button"
          >
            Follow
          </button>
          {!followLatest ? (
            <button
              className="button button--ghost button--compact"
              onClick={handleJumpToLatest}
              type="button"
            >
              Latest
            </button>
          ) : null}
          <span className="badge badge--idle">{messages.length} msgs</span>
        </div>
      </div>
      <div className="stream">
        {messages.length === 0 ? (
          <div className="empty">Waiting for data...</div>
        ) : (
          <AutoSizer>
            {({ height, width }) => {
              listSizeRef.current.height = height;
              return (
                <FixedSizeList
                  ref={listRef}
                  height={height}
                  width={width}
                  itemCount={messages.length}
                  itemSize={ROW_HEIGHT}
                  itemData={{ messages, onSelect: onSelectMessage } satisfies RowData}
                  onScroll={handleScroll}
                >
                  {Row}
                </FixedSizeList>
              );
            }}
          </AutoSizer>
        )}
      </div>
    </section>
  );
};

const Row = ({ index, style, data }: { index: number; style: CSSProperties; data: RowData }) => {
  const msg = data.messages[index];
  const preview = buildPreview(msg);
  return (
    <div className="stream__row" style={style} onClick={() => data.onSelect(msg)}>
      <div className="stream__meta">
        <div className="stream__time">{formatTime(msg.ts)}</div>
        <div className="stream__key">{msg.key}</div>
      </div>
      <div className="stream__payload">{preview}</div>
      <div className="stream__size">{formatBytes(msg.sizeBytes)}</div>
    </div>
  );
};

const buildPreview = (msg: CartoMessage): string => {
  if (msg.encoding === 'json') {
    try {
      const json = JSON.stringify(msg.json);
      return json.length > 140 ? `${json.slice(0, 140)}...` : json;
    } catch {
      return '{...}';
    }
  }
  if (msg.encoding === 'text') {
    const text = msg.text ?? '';
    return text.length > 140 ? `${text.slice(0, 140)}...` : text;
  }
  return msg.base64 ? `base64:${msg.base64.slice(0, 40)}...` : '[binary]';
};

export default StreamView;
