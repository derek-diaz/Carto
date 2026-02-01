import { JSX, useEffect, useMemo, useRef, useState } from 'react';
import type { UIEvent } from 'react';
import { List } from 'react-window';
import type { ListImperativeAPI, RowComponentProps } from 'react-window';
import { AutoSizer } from 'react-virtualized-auto-sizer';
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
  const listRef = useRef<ListImperativeAPI | null>(null);
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
    listRef.current?.scrollToRow({ index: filteredMessages.length - 1, align: 'end' });
  }, [filteredMessages.length, followLatest]);

  const handleJumpToLatest = () => {
    if (filteredMessages.length === 0) return;
    listRef.current?.scrollToRow({ index: filteredMessages.length - 1, align: 'end' });
  };

  const handleScroll = (event: UIEvent<HTMLDivElement>) => {
    if (!followLatest) return;
    const target = event.currentTarget;
    const isAtBottom =
      target.scrollTop + target.clientHeight >= target.scrollHeight - ROW_HEIGHT;
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
            <span className="button__icon" aria-hidden="true"> <IconHighlighter /> </span>
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
          <AutoSizer
            renderProp={({ height, width }) => {
              if (!height || !width) return null;
              return (
                <List
                  listRef={listRef}
                  rowCount={filteredMessages.length}
                  rowHeight={ROW_HEIGHT}
                  rowComponent={Row}
                  rowProps={{
                    messages: filteredMessages,
                    onSelect: onSelectMessage,
                    keyFilter: normalizedKeyFilter,
                    contentFilter: normalizedContentFilter,
                    highlightMatches
                  } satisfies RowData}
                  onScroll={handleScroll}
                  style={{ height, width }}
                />
              );
            }}
          />
        )}
      </div>
    </section>
  );
};

const Row = ({
  index,
  style,
  ariaAttributes,
  messages,
  onSelect,
  keyFilter,
  contentFilter,
  highlightMatches
}: RowComponentProps<RowData>) => {
  const { role: _role, ...rowAria } = ariaAttributes;
  void _role;
  const msg = messages[index];
  const preview = buildPreview(msg);
  const keyNode = highlightText(msg.key, keyFilter, highlightMatches);
  const payloadNode = highlightText(preview, contentFilter, highlightMatches);
  return (
    <button
      type="button"
      className="stream__row"
      style={style}
      onClick={() => onSelect(msg)}
      {...rowAria}
    >
      <div className="stream__meta">
        <div className="stream__time">{formatTime(msg.ts)}</div>
        <div className="stream__key">{keyNode}</div>
      </div>
      <div className="stream__payload">{payloadNode}</div>
      <div className="stream__size">{formatBytes(msg.sizeBytes)}</div>
    </button>
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
