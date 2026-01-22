import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { FixedSizeList } from 'react-window';
import AutoSizer from 'react-virtualized-auto-sizer';
import type { CartoMessage } from '@shared/types';
import { formatBytes, formatTime } from '../utils/format';
import { IconClose, IconFollow, IconHash, IconHighlighter, IconLatest, IconSearch } from './Icons';

const ROW_HEIGHT = 56;

export type StreamViewProps = {
  title: string;
  messages: CartoMessage[];
  onSelectMessage: (msg: CartoMessage) => void;
};

type RowData = {
  messages: CartoMessage[];
  onSelect: (msg: CartoMessage) => void;
  keyFilter: string;
  contentFilter: string;
  highlightMatches: boolean;
};

const StreamView = ({ title, messages, onSelectMessage }: StreamViewProps) => {
  const listRef = useRef<FixedSizeList<RowData> | null>(null);
  const listSizeRef = useRef({ height: 0 });
  const [followLatest, setFollowLatest] = useState(true);
  const [keyFilter, setKeyFilter] = useState('');
  const [contentFilter, setContentFilter] = useState('');
  const [highlightMatches, setHighlightMatches] = useState(true);

  const normalizedKeyFilter = keyFilter.trim().toLowerCase();
  const normalizedContentFilter = contentFilter.trim().toLowerCase();
  const filtersActive = Boolean(normalizedKeyFilter || normalizedContentFilter);

  const filteredMessages = useMemo(() => {
    if (!filtersActive) return messages;
    return messages.filter((msg) => {
      if (normalizedKeyFilter && !msg.key.toLowerCase().includes(normalizedKeyFilter)) {
        return false;
      }
      if (normalizedContentFilter) {
        const payload = getSearchablePayload(msg);
        if (!payload.toLowerCase().includes(normalizedContentFilter)) {
          return false;
        }
      }
      return true;
    });
  }, [filtersActive, messages, normalizedContentFilter, normalizedKeyFilter]);

  useEffect(() => {
    if (!followLatest || filteredMessages.length === 0) return;
    listRef.current?.scrollToItem(filteredMessages.length - 1, 'end');
  }, [filteredMessages.length, followLatest]);

  const handleJumpToLatest = () => {
    if (filteredMessages.length === 0) return;
    listRef.current?.scrollToItem(filteredMessages.length - 1, 'end');
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
    const totalHeight = filteredMessages.length * ROW_HEIGHT;
    const maxOffset = Math.max(0, totalHeight - height);
    const isAtBottom = scrollOffset >= maxOffset - ROW_HEIGHT;
    if (!isAtBottom) {
      setFollowLatest(false);
    }
  };

  const totalCount = messages.length;
  const visibleCount = filteredMessages.length;
  const countLabel = filtersActive ? `${visibleCount} / ${totalCount} msgs` : `${totalCount} msgs`;

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
            <span className="button__icon" aria-hidden="true">
              <IconFollow />
            </span>
            Follow
          </button>
          {!followLatest ? (
            <button
              className="button button--ghost button--compact"
              onClick={handleJumpToLatest}
              type="button"
            >
              <span className="button__icon" aria-hidden="true">
                <IconLatest />
              </span>
              Latest
            </button>
          ) : null}
          <span className="badge badge--idle">{countLabel}</span>
        </div>
      </div>
      <div className="panel__toolbar stream__filters">
        <div className="stream__filter-grid">
          <label className="stream__filter">
            <span className="stream__filter-label">Key</span>
            <div className="input-group input-group--filter">
              <span className="input-group__icon" aria-hidden="true">
                <IconHash />
              </span>
              <input
                type="text"
                placeholder="Key contains…"
                value={keyFilter}
                onChange={(event) => setKeyFilter(event.target.value)}
                aria-label="Filter by key"
              />
              {keyFilter ? (
                <button
                  className="icon-button icon-button--compact icon-button--ghost"
                  onClick={() => setKeyFilter('')}
                  type="button"
                  aria-label="Clear key filter"
                >
                  <span className="icon-button__icon" aria-hidden="true">
                    <IconClose />
                  </span>
                </button>
              ) : null}
            </div>
          </label>
          <label className="stream__filter">
            <span className="stream__filter-label">Content</span>
            <div className="input-group input-group--filter">
              <span className="input-group__icon" aria-hidden="true">
                <IconSearch />
              </span>
              <input
                type="text"
                placeholder="Payload contains…"
                value={contentFilter}
                onChange={(event) => setContentFilter(event.target.value)}
                aria-label="Filter by payload content"
              />
              {contentFilter ? (
                <button
                  className="icon-button icon-button--compact icon-button--ghost"
                  onClick={() => setContentFilter('')}
                  type="button"
                  aria-label="Clear content filter"
                >
                  <span className="icon-button__icon" aria-hidden="true">
                    <IconClose />
                  </span>
                </button>
              ) : null}
            </div>
          </label>
        </div>
        <div className="stream__filter-actions">
          <button
            className={`button button--ghost button--compact ${
              highlightMatches ? 'button--active' : ''
            }`}
            onClick={() => setHighlightMatches((prev) => !prev)}
            type="button"
            disabled={!filtersActive}
          >
            <span className="button__icon" aria-hidden="true">
              <IconHighlighter />
            </span>
            Highlight
          </button>
          <button
            className="button button--ghost button--compact"
            onClick={() => {
              setKeyFilter('');
              setContentFilter('');
            }}
            type="button"
            disabled={!filtersActive}
          >
            <span className="button__icon" aria-hidden="true">
              <IconClose />
            </span>
            Clear
          </button>
        </div>
      </div>
      <div className="stream">
        {filteredMessages.length === 0 ? (
          <div className="empty">
            {messages.length === 0 ? 'Waiting for data...' : 'No matches for current filters.'}
          </div>
        ) : (
          <AutoSizer>
            {({ height, width }) => {
              listSizeRef.current.height = height;
              return (
                <FixedSizeList
                  ref={listRef}
                  height={height}
                  width={width}
                  itemCount={filteredMessages.length}
                  itemSize={ROW_HEIGHT}
                  itemData={{
                    messages: filteredMessages,
                    onSelect: onSelectMessage,
                    keyFilter: normalizedKeyFilter,
                    contentFilter: normalizedContentFilter,
                    highlightMatches
                  } satisfies RowData}
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
  const keyNode = highlightText(msg.key, data.keyFilter, data.highlightMatches);
  const payloadNode = highlightText(preview, data.contentFilter, data.highlightMatches);
  return (
    <div className="stream__row" style={style} onClick={() => data.onSelect(msg)}>
      <div className="stream__meta">
        <div className="stream__time">{formatTime(msg.ts)}</div>
        <div className="stream__key">{keyNode}</div>
      </div>
      <div className="stream__payload">{payloadNode}</div>
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

const getSearchablePayload = (msg: CartoMessage): string => {
  if (msg.encoding === 'json') {
    try {
      return JSON.stringify(msg.json ?? {});
    } catch {
      return '';
    }
  }
  if (msg.encoding === 'text') {
    return msg.text ?? '';
  }
  return msg.base64 ?? '';
};

const highlightText = (text: string, query: string, enabled: boolean) => {
  if (!enabled || !query) return text;
  const lowerText = text.toLowerCase();
  const lowerQuery = query.toLowerCase();
  if (!lowerText.includes(lowerQuery)) return text;

  const parts: Array<string | JSX.Element> = [];
  let start = 0;
  let index = lowerText.indexOf(lowerQuery, start);
  while (index !== -1) {
    if (index > start) {
      parts.push(text.slice(start, index));
    }
    parts.push(
      <mark className="match" key={`${index}-${query}`}>
        {text.slice(index, index + query.length)}
      </mark>
    );
    start = index + query.length;
    index = lowerText.indexOf(lowerQuery, start);
  }
  if (start < text.length) {
    parts.push(text.slice(start));
  }
  return parts;
};

export default StreamView;
