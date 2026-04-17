import { JSX, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { UIEvent } from 'react';
import { List } from 'react-window';
import type { ListImperativeAPI, RowComponentProps } from 'react-window';
import { AutoSizer } from 'react-virtualized-auto-sizer';
import type { CartoMessage } from '@shared/types';
import { formatBytes, formatTime } from '../utils/format';
import { highlightJson } from '../utils/jsonSyntax';
import { IconClose, IconFollow, IconLatest, IconSearch } from './Icons';
import type { DecoderConfig } from '../utils/proto';

const ROW_HEIGHT = 46;
const MAX_PROTO_PREVIEW_IN_FLIGHT = 2;
const PROTO_PREVIEW_PENDING_TEXT = '[protobuf decoding…]';
const PROTO_PREVIEW_UNAVAILABLE_TEXT = '[protobuf unavailable]';

export type StreamViewProps = {
  messages: CartoMessage[];
  selectedMessageId?: string | null;
  onSelectMessage: (msg: CartoMessage) => void;
  decoder?: DecoderConfig;
  decodeProtobuf?: (
    decoder: DecoderConfig | undefined,
    message: Pick<CartoMessage, 'key' | 'base64' | 'payloadTruncated'> | null | undefined
  ) => {
    data?: unknown;
    error?: string;
    label?: string;
    schemaName?: string;
  } | null;
  resolveProtobufPreview?: (message: CartoMessage) => Promise<string | null>;
};

type RowData = {
  messages: CartoMessage[];
  selectedMessageId?: string | null;
  onSelect: (msg: CartoMessage) => void;
  searchQuery: string;
  highlightMatches: boolean;
  decodedPreviewById: Record<string, string>;
  decoderActive: boolean;
};

const StreamView = ({
  messages,
  selectedMessageId,
  onSelectMessage,
  decoder,
  resolveProtobufPreview
}: StreamViewProps) => {
  const listRef = useRef<ListImperativeAPI | null>(null);
  const [followLatest, setFollowLatest] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [highlightMatches, setHighlightMatches] = useState(true);
  const [decodedPreviewById, setDecodedPreviewById] = useState<Record<string, string>>({});
  const decodeQueueRef = useRef<CartoMessage[]>([]);
  const decodePendingRef = useRef<Set<string>>(new Set());
  const decodeInFlightRef = useRef(0);
  const decodeGenerationRef = useRef(0);
  const pumpDecodeQueueRef = useRef<() => void>(() => {});

  const canResolveProtobufPreview =
    Boolean(resolveProtobufPreview) && Boolean(decoder && decoder.kind !== 'raw');

  const normalizedSearchQuery = searchQuery.trim().toLowerCase();
  const filtersActive = Boolean(normalizedSearchQuery);

  const filteredMessages = useMemo(() => {
    if (!filtersActive) return messages;
    return messages.filter((msg) => {
      if (msg.key.toLowerCase().includes(normalizedSearchQuery)) {
        return true;
      }
      const payload = getSearchText(msg, decodedPreviewById[msg.id], canResolveProtobufPreview);
      return payload.toLowerCase().includes(normalizedSearchQuery);
    });
  }, [
    filtersActive,
    messages,
    normalizedSearchQuery,
    decodedPreviewById,
    canResolveProtobufPreview
  ]);

  const pumpDecodeQueue = useCallback(() => {
    if (!resolveProtobufPreview || !canResolveProtobufPreview) return;
    const generation = decodeGenerationRef.current;

    while (
      decodeInFlightRef.current < MAX_PROTO_PREVIEW_IN_FLIGHT &&
      decodeQueueRef.current.length > 0
    ) {
      const nextMessage = decodeQueueRef.current.shift();
      if (!nextMessage) continue;

      decodeInFlightRef.current += 1;
      void resolveProtobufPreview(nextMessage)
        .then((preview) => {
          if (decodeGenerationRef.current !== generation) return;
          setDecodedPreviewById((prev) => {
            const resolved = preview ?? PROTO_PREVIEW_UNAVAILABLE_TEXT;
            if (prev[nextMessage.id] === resolved) return prev;
            return { ...prev, [nextMessage.id]: resolved };
          });
        })
        .catch(() => {
          if (decodeGenerationRef.current !== generation) return;
          setDecodedPreviewById((prev) => {
            if (prev[nextMessage.id] === PROTO_PREVIEW_UNAVAILABLE_TEXT) return prev;
            return { ...prev, [nextMessage.id]: PROTO_PREVIEW_UNAVAILABLE_TEXT };
          });
        })
        .finally(() => {
          if (decodeGenerationRef.current !== generation) return;
          decodeInFlightRef.current = Math.max(0, decodeInFlightRef.current - 1);
          decodePendingRef.current.delete(nextMessage.id);
          globalThis.setTimeout(() => {
            if (decodeGenerationRef.current !== generation) return;
            pumpDecodeQueueRef.current();
          }, 0);
        });
    }
  }, [canResolveProtobufPreview, resolveProtobufPreview]);

  useEffect(() => {
    pumpDecodeQueueRef.current = pumpDecodeQueue;
  }, [pumpDecodeQueue]);

  useEffect(() => {
    decodeGenerationRef.current += 1;
    decodeQueueRef.current = [];
    decodePendingRef.current.clear();
    decodeInFlightRef.current = 0;
    setDecodedPreviewById({});
  }, [decoder, canResolveProtobufPreview, resolveProtobufPreview]);

  useEffect(() => {
    const messageIds = new Set(messages.map((message) => message.id));
    decodeQueueRef.current = decodeQueueRef.current.filter((message) => messageIds.has(message.id));
    for (const pendingId of decodePendingRef.current) {
      if (!messageIds.has(pendingId)) {
        decodePendingRef.current.delete(pendingId);
      }
    }
    setDecodedPreviewById((prev) => {
      const entries = Object.entries(prev).filter(([messageId]) => messageIds.has(messageId));
      if (entries.length === Object.keys(prev).length) {
        return prev;
      }
      return Object.fromEntries(entries);
    });
  }, [messages]);

  useEffect(() => {
    if (!canResolveProtobufPreview) return;
    if (messages.length === 0) return;

    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index];
      if (!message) continue;
      if (decodedPreviewById[message.id] !== undefined) continue;
      if (decodePendingRef.current.has(message.id)) continue;
      decodePendingRef.current.add(message.id);
      decodeQueueRef.current.push(message);
    }

    pumpDecodeQueue();
  }, [
    canResolveProtobufPreview,
    decodedPreviewById,
    messages,
    pumpDecodeQueue,
  ]);

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
    const isAtBottom = target.scrollTop + target.clientHeight >= target.scrollHeight - ROW_HEIGHT;
    if (!isAtBottom) {
      setFollowLatest(false);
    }
  };

  const totalCount = messages.length;
  const visibleCount = filteredMessages.length;
  const countLabel = filtersActive ? `${visibleCount} / ${totalCount} msgs` : `${totalCount} msgs`;

  return (
    <section className="panel panel--stream">
      <div className="panel_header">
        <label className="stream_search">
          <div className="input-group input-group--filter">
            <span className="input-group_icon" aria-hidden="true">
              <IconSearch />
            </span>
            <input
              type="text"
              placeholder="Filter by key or content..."
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              aria-label="Filter by key or content"
            />
            {searchQuery ? (
              <button
                className="icon-button icon-button--compact icon-button--ghost"
                onClick={() => setSearchQuery('')}
                type="button"
                aria-label="Clear filter"
              >
                <span className="icon-button_icon" aria-hidden="true">
                  <IconClose />
                </span>
              </button>
            ) : null}
          </div>
        </label>
        <div className="panel_actions">
          <button
            className={`button button--ghost button--compact ${
              followLatest ? 'button--active' : ''
            }`}
            onClick={() => setFollowLatest((prev) => !prev)}
            type="button"
          >
            <span className="button_icon" aria-hidden="true">
              <IconFollow />
            </span>{' '}
            Follow
          </button>
          {!followLatest ? (
            <button
              className="button button--ghost button--compact"
              onClick={handleJumpToLatest}
              type="button"
            >
              <span className="button_icon" aria-hidden="true">
                <IconLatest />
              </span>{' '}
              Latest
            </button>
          ) : null}
          <span className="badge badge--idle">{countLabel}</span>
        </div>
      </div>
      <div className="stream">
        <div className="stream_head">
          <div>Timestamp</div>
          <div>Key</div>
          <div>Content snippet</div>
          <div>Encoding</div>
          <div>Size</div>
        </div>
        {filteredMessages.length === 0 ? (
          <div className="empty">
            {messages.length === 0 ? 'Waiting for data...' : 'No matches for current filters.'}
          </div>
        ) : (
          <div className="stream_body">
            <AutoSizer
              renderProp={({ height, width }) => {
                if (!height || !width) return null;
                return (
                  <List
                    listRef={listRef}
                    rowCount={filteredMessages.length}
                    rowHeight={ROW_HEIGHT}
                    rowComponent={Row}
                    rowProps={
                      {
                        messages: filteredMessages,
                        selectedMessageId,
                        onSelect: onSelectMessage,
                        searchQuery: normalizedSearchQuery,
                        highlightMatches,
                        decodedPreviewById,
                        decoderActive: canResolveProtobufPreview
                      } satisfies RowData
                    }
                    onScroll={handleScroll}
                    style={{ height, width }}
                  />
                );
              }}
            />
          </div>
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
  selectedMessageId,
  onSelect,
  searchQuery,
  highlightMatches,
  decodedPreviewById,
  decoderActive
}: RowComponentProps<RowData>) => {
  const rowAria = ariaAttributes;
  const msg = messages[index];
  const preview = getPreviewText(msg, decodedPreviewById[msg.id], decoderActive);
  const keyNode = highlightText(msg.key, searchQuery, highlightMatches);
  const payloadNode = getPayloadNode(
    msg.id,
    preview,
    searchQuery,
    highlightMatches,
    decodedPreviewById[msg.id]
  );
  return (
    <button
      type="button"
      className={`stream_row ${selectedMessageId === msg.id ? 'stream_row--active' : ''}`}
      style={style}
      onClick={() => onSelect(msg)}
      {...rowAria}
    >
      <div className="stream_time">{formatTime(msg.ts)}</div>
      <div className="stream_key">{keyNode}</div>
      <div className="stream_payload">{payloadNode}</div>
      <div className="stream_encoding">{msg.encoding}</div>
      <div className="stream_size">{formatBytes(msg.sizeBytes)}</div>
    </button>
  );
};

const getPayloadNode = (
  messageId: string,
  preview: string,
  query: string,
  highlightMatches: boolean,
  decodedPreview?: string
) => {
  if (decodedPreview && isJsonLikePreview(decodedPreview) && !(query && highlightMatches)) {
    return highlightJson(preview, `${messageId}-`);
  }
  return highlightText(preview, query, highlightMatches);
};

const isJsonLikePreview = (value: string): boolean => {
  const trimmed = value.trim();
  return trimmed.startsWith('{') || trimmed.startsWith('[');
};

const getPreviewText = (
  msg: CartoMessage,
  decodedPreview: string | undefined,
  decoderActive: boolean
): string => {
  if (decodedPreview) return decodedPreview;
  if (decoderActive) return PROTO_PREVIEW_PENDING_TEXT;
  if (msg.previewText) return msg.previewText;
  if (msg.encoding === 'json') return '{json}';
  if (msg.encoding === 'text') return msg.text ?? '';
  if (msg.base64) return `base64:${msg.base64}`;
  return '[binary]';
};

const getSearchText = (
  msg: CartoMessage,
  decodedPreview: string | undefined,
  decoderActive: boolean
): string => {
  if (decodedPreview && decodedPreview !== PROTO_PREVIEW_UNAVAILABLE_TEXT) return decodedPreview;
  if (decoderActive) return '';
  if (msg.searchText) return msg.searchText;
  return getPreviewText(msg, decodedPreview, decoderActive);
};

const highlightText = (text: string, query: string, enabled: boolean) => {
  const segments = splitByQuery(text, query, enabled);
  if (segments.length === 1 && !segments[0].match) return text;

  const parts: Array<string | JSX.Element> = [];
  segments.forEach((segment, index) => {
    if (segment.match) {
      parts.push(
        <mark className="match" key={`${index}-${query}`}>
          {segment.text}
        </mark>
      );
      return;
    }
    if (segment.text) {
      parts.push(segment.text);
    }
  });
  return parts;
};

const splitByQuery = (
  text: string,
  query: string,
  enabled: boolean
): Array<{ text: string; match: boolean }> => {
  if (!enabled || !query) return [{ text, match: false }];
  const lowerText = text.toLowerCase();
  const lowerQuery = query.toLowerCase();
  if (!lowerText.includes(lowerQuery)) return [{ text, match: false }];

  const segments: Array<{ text: string; match: boolean }> = [];
  let start = 0;
  let index = lowerText.indexOf(lowerQuery, start);
  while (index !== -1) {
    if (index > start) {
      segments.push({ text: text.slice(start, index), match: false });
    }
    segments.push({ text: text.slice(index, index + query.length), match: true });
    start = index + query.length;
    index = lowerText.indexOf(lowerQuery, start);
  }
  if (start < text.length) {
    segments.push({ text: text.slice(start), match: false });
  }
  return segments;
};

export default StreamView;
