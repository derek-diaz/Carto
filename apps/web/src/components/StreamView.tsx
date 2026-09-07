import { Button as BaseButton } from '@base-ui/react/button';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { JSX, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode, UIEvent } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { CSSProperties } from 'react';
import type { CartoMessage } from '@shared/types';
import { formatBytes, formatTime } from '../utils/format';
import { summarizeJsonPreview } from '../utils/streamPreview';
import { highlightJson } from '../utils/jsonSyntax';
import { IconClose, IconFollow, IconLatest, IconSearch } from './Icons';
import type { DecoderConfig } from '../utils/proto';

const ROW_HEIGHT = 32;

const MAX_PROTO_PREVIEW_IN_FLIGHT = 2;

const PROTO_PREVIEW_PENDING_TEXT = '[protobuf decoding?]';

const PROTO_PREVIEW_UNAVAILABLE_TEXT = '[protobuf unavailable]';

export type StreamViewProps = {
  contextSummary?: ReactNode;
  contextId?: string;
  keyFocus?: { key: string; branch: boolean } | null;
  onClearKeyFocus?: () => void;
  connected?: boolean;
  paused?: boolean;
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
  contextSummary,
  contextId = 'default',
  keyFocus,
  onClearKeyFocus,
  connected = true,
  paused = false,
  messages,
  selectedMessageId,
  onSelectMessage,
  decoder,
  resolveProtobufPreview
}: StreamViewProps) => {
  const listRef = useRef<HTMLDivElement | null>(null);
  const [contexts, setContexts] = useState<
    Record<string, { followLatest: boolean; searchQuery: string }>
  >({});
  const { followLatest, searchQuery } = contexts[contextId] ?? {
    followLatest: true,
    searchQuery: ''
  };
  const setFollowLatest = (value: boolean | ((previous: boolean) => boolean)) =>
    setContexts((previous) => {
      const current = previous[contextId] ?? { followLatest: true, searchQuery: '' };
      return {
        ...previous,
        [contextId]: {
          ...current,
          followLatest: typeof value === 'function' ? value(current.followLatest) : value
        }
      };
    });
  const setSearchQuery = (value: string) =>
    setContexts((previous) => ({ ...previous, [contextId]: { followLatest, searchQuery: value } }));
  const highlightMatches = true;
  const [decodedPreviewById, setDecodedPreviewById] = useState<Record<string, string>>({});
  const decodeQueueRef = useRef<CartoMessage[]>([]);
  const decodePendingRef = useRef<Set<string>>(new Set());
  const decodeInFlightRef = useRef(0);
  const decodeGenerationRef = useRef(0);
  const pumpDecodeQueueRef = useRef<() => void>(() => {});
  const canResolveProtobufPreview =
    Boolean(resolveProtobufPreview) && Boolean(decoder && decoder.kind !== 'raw');
  const normalizedSearchQuery = searchQuery.trim().toLowerCase();
  const filtersActive = Boolean(normalizedSearchQuery || keyFocus);
  const filteredMessages = useMemo(() => {
    if (!filtersActive) return messages;
    return messages.filter((msg) => {
      if (
        keyFocus &&
        msg.key !== keyFocus.key &&
        !(keyFocus.branch && msg.key.startsWith(`${keyFocus.key}/`))
      )
        return false;
      if (!normalizedSearchQuery) return true;
      if (msg.key.toLowerCase().includes(normalizedSearchQuery)) {
        return true;
      }
      const payload = getSearchText(msg, decodedPreviewById[msg.id], canResolveProtobufPreview);
      return payload.toLowerCase().includes(normalizedSearchQuery);
    });
  }, [
    filtersActive,
    keyFocus,
    messages,
    normalizedSearchQuery,
    decodedPreviewById,
    canResolveProtobufPreview
  ]);
  // This renderer intentionally reads the virtualizer's live instance on each render.
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: filteredMessages.length,
    getScrollElement: () => listRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 10,
    getItemKey: (index) => filteredMessages[index].id
  });
  const revealedSelection = useRef<string | null>(null);
  useEffect(() => {
    if (!selectedMessageId) {
      revealedSelection.current = null;
      return;
    }
    if (revealedSelection.current === selectedMessageId) return;
    const index = filteredMessages.findIndex((message) => message.id === selectedMessageId);
    if (index < 0) return;
    // Wait for the inspector dock to take its space before revealing the row.
    const frame = requestAnimationFrame(() => {
      virtualizer.scrollToIndex(index, { align: 'auto' });
      revealedSelection.current = selectedMessageId;
    });
    return () => cancelAnimationFrame(frame);
  }, [selectedMessageId, filteredMessages, virtualizer]);
  const visibleMessagesRef = useRef(filteredMessages);
  useEffect(() => {
    visibleMessagesRef.current = filteredMessages;
  }, [filteredMessages]);
  useEffect(() => {
    const list = listRef.current;
    if (!list || !selectedMessageId) return;
    let height = list.clientHeight;
    const observer = new ResizeObserver(() => {
      if (list.clientHeight === height) return;
      height = list.clientHeight;
      const index = visibleMessagesRef.current.findIndex(
        (message) => message.id === selectedMessageId
      );
      if (index >= 0 && height > 0) virtualizer.scrollToIndex(index, { align: 'auto' });
    });
    observer.observe(list);
    return () => observer.disconnect();
  }, [selectedMessageId, virtualizer]);
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
  }, [canResolveProtobufPreview, decodedPreviewById, messages, pumpDecodeQueue]);
  useEffect(() => {
    if (!followLatest || filteredMessages.length === 0) return;
    virtualizer.scrollToIndex(filteredMessages.length - 1, { align: 'end' });
  }, [filteredMessages, followLatest, virtualizer]);
  const handleJumpToLatest = () => {
    if (filteredMessages.length === 0) return;
    virtualizer.scrollToIndex(filteredMessages.length - 1, { align: 'end' });
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
            <Input
              className="h-7 rounded-none border-0 bg-transparent text-xs shadow-none focus-visible:ring-0"
              type="text"
              placeholder="Search keys and payload previews…"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              aria-label="Search keys and payload previews"
              title="Search retained keys and previews: first 256 characters, or the decoded Protobuf preview"
            />
            {searchQuery ? (
              <Button
                variant="outline"
                size="icon-sm"
                className="icon-button icon-button--compact icon-button--ghost"
                onClick={() => setSearchQuery('')}
                type="button"
                aria-label="Clear filter"
              >
                <span className="icon-button_icon" aria-hidden="true">
                  <IconClose />
                </span>
              </Button>
            ) : null}
          </div>
        </label>
        <div className="panel_actions">
          <Button
            variant={followLatest ? 'secondary' : 'ghost'}
            size="sm"
            className="rounded-sm text-xs"
            aria-pressed={followLatest}
            title={
              followLatest
                ? 'Automatically scrolling to incoming messages. Click to stop following.'
                : 'Jump to the newest matching message and keep following incoming traffic.'
            }
            onClick={() => setFollowLatest((prev) => !prev)}
            type="button"
          >
            <span className="button_icon" aria-hidden="true">
              <IconFollow />
            </span>{' '}
            {followLatest ? 'Following' : 'Follow incoming'}
          </Button>
          {!followLatest ? (
            <Button
              variant="outline"
              size="sm"
              className="rounded-sm text-xs"
              onClick={handleJumpToLatest}
              title="Jump once to the newest matching message without enabling automatic following"
              type="button"
            >
              <span className="button_icon" aria-hidden="true">
                <IconLatest />
              </span>{' '}
              Jump to latest
            </Button>
          ) : null}
          <span className="stream-count">{countLabel}</span>
        </div>
      </div>
      {contextSummary}
      {keyFocus && (
        <div className="stream-scope">
          <BaseButton type="button" onClick={onClearKeyFocus} title="Remove key focus">
            {keyFocus.key}
            {keyFocus.branch ? '/**' : ''} <span aria-hidden="true">×</span>
          </BaseButton>
        </div>
      )}
      <div className="stream">
        <div className="stream_head">
          <div>Timestamp</div>
          <div>Key</div>
          <div>Payload preview</div>
          <div>Encoding</div>
          <div>Size</div>
        </div>
        {filteredMessages.length === 0 ? (
          <div className="investigation-empty stream-empty">
            <span className="empty-orbit" aria-hidden="true">
              ◎
            </span>
            <strong>
              {!connected
                ? 'Waiting for the connection'
                : paused
                  ? 'Your display is paused'
                  : messages.length === 0
                    ? 'Listening for your first message'
                    : 'No messages match this view'}
            </strong>
            <p>
              {!connected
                ? 'Retained previews remain available while Carto reconnects.'
                : paused
                  ? 'Resume to see the newest retained samples.'
                  : messages.length === 0
                    ? 'The subscription is ready. Check the key expression and that your publisher is sending data.'
                    : 'Search covers retained previews. Try a shorter term or remove the key focus.'}
            </p>
            {filtersActive && (
              <Button
                variant="outline"
                size="default"
                type="button"
                className="button button--ghost"
                onClick={() => {
                  setSearchQuery('');
                  onClearKeyFocus?.();
                }}
              >
                Clear filters
              </Button>
            )}
          </div>
        ) : (
          <div className="stream_body overflow-auto" ref={listRef} onScroll={handleScroll}>
            <div
              role="list"
              aria-label="Live messages"
              style={{ height: virtualizer.getTotalSize(), position: 'relative', width: '100%' }}
            >
              {virtualizer.getVirtualItems().map((item) => (
                <Row
                  key={item.key}
                  index={item.index}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    height: item.size,
                    transform: `translateY(${item.start}px)`
                  }}
                  messages={filteredMessages}
                  selectedMessageId={selectedMessageId}
                  onSelect={(message) => {
                    setFollowLatest(false);
                    onSelectMessage(message);
                  }}
                  searchQuery={normalizedSearchQuery}
                  highlightMatches={highlightMatches}
                  decodedPreviewById={decodedPreviewById}
                  decoderActive={canResolveProtobufPreview}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </section>
  );
};

const Row = ({
  index,
  style,
  messages,
  selectedMessageId,
  onSelect,
  searchQuery,
  highlightMatches,
  decodedPreviewById,
  decoderActive
}: RowData & { index: number; style: CSSProperties }) => {
  const msg = messages[index];
  const rawPreview = getPreviewText(msg, decodedPreviewById[msg.id], decoderActive);
  const preview = summarizeJsonPreview(rawPreview) ?? rawPreview;
  const keyNode = highlightText(msg.key, searchQuery, highlightMatches);
  const payloadNode = getPayloadNode(msg.id, preview, searchQuery, highlightMatches);
  return (
    <div role="listitem" style={style}>
      <BaseButton
        type="button"
        className={`stream_row ${selectedMessageId === msg.id ? 'stream_row--active' : ''}`}
        style={{ width: '100%', height: '100%' }}
        onClick={() => onSelect(msg)}
        aria-label={`${msg.kind ?? 'Sample'} ${msg.key} at ${formatTime(msg.ts)}`}
        aria-pressed={selectedMessageId === msg.id}
        aria-controls={selectedMessageId === msg.id ? 'monitor-payload-inspector' : undefined}
      >
        <div className="stream_time">{formatTime(msg.ts)}</div>
        <div className="stream_key" title={msg.key}>
          <span className={`sample-kind sample-kind--${msg.kind ?? 'unknown'}`}>
            {msg.kind ?? 'sample'}
          </span>
          {keyNode}
        </div>
        <div className="stream_payload" title={rawPreview}>
          {payloadNode}
        </div>
        <div className="stream_encoding">{msg.encoding}</div>
        <div className="stream_size">{formatBytes(msg.sizeBytes)}</div>
      </BaseButton>
    </div>
  );
};

const getPayloadNode = (
  messageId: string,
  preview: string,
  query: string,
  highlightMatches: boolean
) => {
  if (shouldHighlightJsonPreview(preview, query, highlightMatches)) {
    return highlightJson(preview, `${messageId}-`);
  }
  return highlightText(preview, query, highlightMatches);
};

export const shouldHighlightJsonPreview = (
  preview: string,
  query: string,
  highlightMatches: boolean
): boolean => isJsonLikePreview(preview) && !(query && highlightMatches);

const isJsonLikePreview = (value: string): boolean => {
  const trimmed = value.trim();
  return trimmed.startsWith('{') || trimmed.startsWith('[');
};

const getPreviewText = (
  msg: CartoMessage,
  decodedPreview: string | undefined,
  decoderActive: boolean
): string => {
  if (msg.kind === 'delete') return 'Key deleted';
  if (decodedPreview) return decodedPreview;
  if (decoderActive) return PROTO_PREVIEW_PENDING_TEXT;
  if (msg.previewText) return msg.previewText;
  if (msg.encoding === 'json') return '{json}';
  if (msg.encoding === 'text') return msg.text ?? '';
  if (msg.base64 !== undefined)
    return msg.base64 === '' ? '[empty payload]' : `base64:${msg.base64}`;
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
