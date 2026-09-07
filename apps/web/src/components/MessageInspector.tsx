import { Tabs, TabsList, TabsTrigger, TabsContent } from './ui/tabs';
import { NativeSelect } from './ui/native-select';
import { Button } from './ui/button';
import { Button as BaseButton } from '@base-ui/react/button';
import { useEffect, useMemo, useState } from 'react';
import type { KeyboardEventHandler, PointerEventHandler } from 'react';
import type { CartoMessage } from '@shared/types';
import { formatBytes, formatTime } from '../utils/format';
import { PayloadTextView } from './PayloadTextView';
import { usePayloadWorker } from '../store/usePayloadWorker';
import type { PayloadTask } from '../workers/payload.worker';
import type { comparePayloads } from '../utils/messageDiff';
import { IconClose, IconCopy, IconPublish } from './Icons';

type MessageInspectorProps = {
  message: CartoMessage | null;
  protoResult?: {
    data?: unknown;
    error?: string;
    label?: string;
    schemaName?: string;
    typeId?: string;
  } | null;
  subscriptionLabel?: string;
  variant?: 'side' | 'dock';
  expanded?: boolean;
  splitter?: { min: number; max: number; value: number };
  onClose: () => void;
  onResizeStart?: PointerEventHandler<HTMLButtonElement>;
  onResizeKeyDown?: KeyboardEventHandler<HTMLButtonElement>;
  onToggleExpanded?: () => void;
  connected: boolean;
  pinned: boolean;
  onPin: () => void;
  onUnpin: () => void;
  onPublish: () => void;
  comparison: CartoMessage | null;
  comparisonData?: unknown;
  comparisonBusy: boolean;
  comparisonError: string;
  onCompare: () => void;
  baselines: CartoMessage[];
  onComparePinned: (message: CartoMessage) => void;
};

type TabId = 'decoded' | 'text' | 'base64' | 'changes' | 'metadata';

const payloadValue = (message: CartoMessage, decoded?: unknown) =>
  decoded !== undefined
    ? decoded
    : message.json !== undefined
      ? message.json
      : (message.text ?? message.base64);

const MessageInspector = ({
  message,
  protoResult,
  subscriptionLabel,
  variant = 'dock',
  expanded,
  splitter,
  onClose,
  onResizeStart,
  onResizeKeyDown,
  onToggleExpanded,
  connected,
  pinned,
  onPin,
  onUnpin,
  onPublish,
  comparison,
  comparisonData,
  comparisonBusy,
  comparisonError,
  onCompare,
  baselines,
  onComparePinned
}: MessageInspectorProps) => {
  const [tab, setTab] = useState<TabId>('decoded');
  const [copyStatus, setCopyStatus] = useState('');
  const hasDecoded = protoResult?.data !== undefined || message?.json !== undefined;
  const complete = Boolean(
    message?.payloadLoaded && !message.payloadUnavailable && !message.payloadTruncated
  );
  const compareAsBytes = (protoResult?.data !== undefined) !== (comparisonData !== undefined);
  useEffect(() => {
    setTab('decoded');
    setCopyStatus('');
  }, [message?.id]);
  useEffect(() => {
    if (!copyStatus) return;
    const timer = setTimeout(() => setCopyStatus(''), 3000);
    return () => clearTimeout(timer);
  }, [copyStatus]);
  const formatTask = useMemo<PayloadTask | null>(
    () =>
      tab === 'decoded' && hasDecoded && message
        ? { kind: 'format', value: payloadValue(message, protoResult?.data) }
        : null,
    [tab, hasDecoded, message, protoResult?.data]
  );
  const formatted = usePayloadWorker<string>(formatTask);
  const diffTask = useMemo<PayloadTask | null>(
    () =>
      tab === 'changes' && complete && comparison?.payloadLoaded && message
        ? {
            kind: 'diff',
            before: compareAsBytes ? comparison.base64 : payloadValue(comparison, comparisonData),
            after: compareAsBytes ? message.base64 : payloadValue(message, protoResult?.data)
          }
        : null,
    [tab, complete, comparison, message, compareAsBytes, comparisonData, protoResult?.data]
  );
  const diffJob = usePayloadWorker<ReturnType<typeof comparePayloads>>(diffTask);
  const diff = diffJob.result;
  const diffText = useMemo(() => JSON.stringify(diff?.changes ?? [], null, 2), [diff]);
  if (!message) return null;
  const decodedText =
    formatted.result ?? message.text ?? message.base64 ?? message.previewText ?? '';
  const copy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopyStatus('Copied to clipboard');
    } catch {
      setCopyStatus('Clipboard unavailable. Select the text and copy it manually.');
    }
  };
  const metadata = {
    operation: message.kind ?? 'Not provided',
    wireEncoding: message.wireEncoding ?? 'Not provided',
    displayedAs: protoResult?.data !== undefined ? 'Protobuf' : message.encoding,
    sampleTime: new Date(message.ts).toISOString(),
    ...(message.receivedAt !== undefined
      ? { receivedByCarto: new Date(message.receivedAt).toISOString() }
      : {}),
    subscription: subscriptionLabel ?? 'Not available',
    sizeBytes: message.sizeBytes
  };
  const currentText =
    tab === 'metadata'
      ? JSON.stringify(metadata, null, 2)
      : tab === 'changes'
        ? diffText
        : tab === 'base64'
          ? (message.base64 ?? '')
          : tab === 'text'
            ? (message.text ?? '')
            : decodedText;
  return (
    <aside
      id="monitor-payload-inspector"
      aria-label={`Payload inspector for ${message.key} at ${formatTime(message.ts)}`}
      className={`monitor_inspector investigation-inspector ${variant === 'dock' ? 'monitor_inspector--dock' : ''}`}
    >
      {variant === 'dock' && (
        <BaseButton
          className="monitor_inspector-resizer"
          onPointerDown={onResizeStart}
          onKeyDown={onResizeKeyDown}
          onDoubleClick={onToggleExpanded}
          type="button"
          role="separator"
          aria-orientation="horizontal"
          aria-valuemin={splitter?.min}
          aria-valuemax={splitter?.max}
          aria-valuenow={splitter?.value}
          aria-valuetext={
            expanded ? 'Inspector expanded' : `${splitter?.value ?? 0} pixels for payload inspector`
          }
          aria-controls="monitor-payload-inspector"
          aria-label="Resize inspector"
          title="Drag to resize · Arrow keys to adjust · Double-click to expand"
        />
      )}
      <div className="monitor_inspector-header">
        <div className="monitor_inspector-title">
          <span className="monitor_eyebrow">
            Payload inspector · Selected message{' '}
            {pinned && <span className="inspector-pin-label">· Pinned</span>}
          </span>
          <h3>{message.key}</h3>
          <p>
            {message.kind?.toUpperCase() ?? 'Sample'} · {formatTime(message.ts)} ·{' '}
            {formatBytes(message.sizeBytes)}
            {message.wireEncoding ? ` · ${message.wireEncoding}` : ''}
            {protoResult?.label ? ` · ${protoResult.label}` : ''}
          </p>
        </div>
        <div className="monitor_inspector-header-actions">
          <Button
            variant={pinned ? 'secondary' : 'ghost'}
            size="sm"
            className="rounded-md text-xs"
            type="button"
            onClick={pinned ? onUnpin : onPin}
            disabled={!complete}
            aria-pressed={pinned}
            title="Keep this full payload in the app session"
          >
            {pinned ? 'Unpin' : 'Pin message'}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="rounded-md text-xs"
            type="button"
            onClick={onPublish}
            disabled={!complete || !connected || message.kind === 'delete'}
            title={
              message.kind === 'delete'
                ? 'Delete events have no publishable payload'
                : 'Open an editable draft; nothing is sent yet'
            }
          >
            <span className="button_icon">
              <IconPublish />
            </span>
            Edit & republish
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="monitor_inspector-expand rounded-md text-xs"
            type="button"
            onClick={onToggleExpanded}
            aria-pressed={expanded}
          >
            {expanded ? 'Restore' : 'Expand'}
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            className="rounded-md text-muted-foreground"
            type="button"
            onClick={onClose}
            aria-label="Close inspector"
          >
            <span className="icon-button_icon">
              <IconClose />
            </span>
          </Button>
        </div>
      </div>
      <div className="monitor_inspector-layout monitor_inspector-layout--dock">
        <Tabs
          value={tab}
          onValueChange={(value) => {
            setTab(value as TabId);
            if (value === 'changes' && !comparison && !comparisonBusy) onCompare();
          }}
          className="monitor_inspector-main gap-0"
        >
          <div className="flex shrink-0 flex-wrap items-center justify-between gap-x-4 border-b bg-card px-5">
            <TabsList
              aria-label="Payload views"
              variant="line"
              className="min-w-0 gap-2 p-0 group-data-horizontal/tabs:h-11"
            >
              {(
                [
                  {
                    id: 'decoded',
                    label: protoResult
                      ? 'Protobuf'
                      : message.json !== undefined
                        ? 'JSON'
                        : message.text !== undefined
                          ? 'Text'
                          : 'Payload'
                  },
                  ...(message.text !== undefined && hasDecoded
                    ? [{ id: 'text', label: 'Text' }]
                    : []),
                  { id: 'base64', label: 'Base64' },
                  { id: 'changes', label: 'Changes' },
                  { id: 'metadata', label: 'Metadata' }
                ] as { id: TabId; label: string }[]
              ).map((item) => (
                <TabsTrigger
                  value={item.id}
                  key={item.id}
                  className="h-full flex-none rounded-none px-3 text-xs focus-visible:ring-inset after:bg-primary group-data-horizontal/tabs:after:bottom-0"
                  disabled={
                    (item.id === 'base64' && message.base64 === undefined) ||
                    (item.id === 'changes' && !complete)
                  }
                >
                  {item.label}
                  {item.id === 'changes' && diff ? (
                    <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] tabular-nums">
                      {diff.changes.length}
                    </span>
                  ) : null}
                </TabsTrigger>
              ))}
            </TabsList>
            <Button
              variant="ghost"
              size="sm"
              className="my-1.5 rounded-md text-xs text-muted-foreground"
              type="button"
              disabled={
                (tab !== 'metadata' && !complete) ||
                (tab === 'changes' && !diff) ||
                formatted.pending
              }
              onClick={() => void copy(currentText)}
            >
              <span className="button_icon">
                <IconCopy />
              </span>
              Copy {tab === 'changes' ? 'changes' : tab === 'metadata' ? 'metadata' : 'payload'}
            </Button>
          </div>
          {copyStatus && (
            <div className="copy-feedback" role="status">
              {copyStatus}
            </div>
          )}
          <TabsContent value={tab} className="monitor_inspector-body">
            {message.payloadUnavailable ? (
              <div className="notice notice--info-warning">{message.payloadUnavailable}</div>
            ) : message.payloadTruncated ? (
              <div className="notice notice--info-warning">
                Preview only · {formatBytes(message.previewBytes ?? 0)} of{' '}
                {formatBytes(message.sizeBytes)}. Full-payload actions become available when loading
                completes.
              </div>
            ) : !complete ? (
              <div className="notice notice--info">Loading full payload…</div>
            ) : null}
            {message.kind === 'delete' && (
              <div className="notice notice--info-warning">
                Delete event · this sample marks a deletion, not an empty published value.
              </div>
            )}
            {tab === 'metadata' ? (
              <dl className="inspector-metadata">
                {Object.entries(metadata).map(([key, value]) => (
                  <div key={key}>
                    <dt>
                      {{
                        operation: 'Operation',
                        wireEncoding: 'Wire encoding',
                        displayedAs: 'Displayed as',
                        sampleTime: 'Sample time',
                        receivedByCarto: 'Received by Carto',
                        subscription: 'Subscription',
                        sizeBytes: 'Payload bytes'
                      }[key] ?? key}
                    </dt>
                    <dd>{value}</dd>
                  </div>
                ))}
              </dl>
            ) : tab === 'changes' ? (
              <>
                <div className="diff-controls">
                  <span>Compare against</span>
                  <Button
                    variant="outline"
                    size="sm"
                    type="button"
                    className="rounded-md text-xs"
                    onClick={onCompare}
                    disabled={comparisonBusy}
                  >
                    Previous on this key
                  </Button>
                  {baselines.length > 0 && (
                    <NativeSelect
                      aria-label="Pinned comparison baseline"
                      defaultValue=""
                      onChange={(event) => {
                        const baseline = baselines.find((entry) => entry.id === event.target.value);
                        if (baseline) onComparePinned(baseline);
                      }}
                    >
                      <option value="">Pinned baseline…</option>
                      {baselines.map((entry) => (
                        <option key={entry.id} value={entry.id}>
                          {formatTime(entry.ts)}
                        </option>
                      ))}
                    </NativeSelect>
                  )}
                </div>
                {comparisonBusy || diffJob.pending ? (
                  <div className="investigation-empty">Preparing comparison…</div>
                ) : comparisonError || diffJob.error ? (
                  <div className="investigation-empty">
                    <strong>Baseline unavailable</strong>
                    <p>{comparisonError || diffJob.error}</p>
                  </div>
                ) : comparison && diff ? (
                  <>
                    <div className="diff-legend">
                      <span>Before · {formatTime(comparison.ts)}</span>
                      <span>After · {formatTime(message.ts)}</span>
                    </div>
                    {compareAsBytes && (
                      <div className="notice notice--info">
                        Comparing raw Base64 because both payloads could not be decoded into the
                        same representation.
                      </div>
                    )}
                    {comparison.wireEncoding !== message.wireEncoding && (
                      <div className="notice notice--info">
                        Wire encoding changed: {comparison.wireEncoding ?? 'not provided'} →{' '}
                        {message.wireEncoding ?? 'not provided'}
                      </div>
                    )}
                    {comparison.kind !== message.kind && (
                      <div className="notice notice--info">
                        Operation changed: {comparison.kind ?? 'unknown'} →{' '}
                        {message.kind ?? 'unknown'}
                      </div>
                    )}
                    {diff.changes.length ? (
                      <div className="diff-list">
                        {diff.changes.map((change) => (
                          <div
                            className={`diff-field diff-field--${change.kind}`}
                            key={change.path}
                          >
                            <div className="diff-path">
                              <code>{change.path}</code>
                              <span>{change.kind}</span>
                              <BaseButton
                                type="button"
                                onClick={() => void copy(change.path)}
                                aria-label={`Copy field path ${change.path}`}
                              >
                                Copy path
                              </BaseButton>
                            </div>
                            <div className="diff-values">
                              <pre>{change.before ?? 'Not present'}</pre>
                              <pre>{change.after ?? 'Not present'}</pre>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="investigation-empty">
                        <strong>No payload changes</strong>
                        <p>The compared values are identical.</p>
                      </div>
                    )}
                    {diff.truncated && (
                      <div className="notice notice--info-warning">
                        Comparison shortened for a large payload. Showing the first{' '}
                        {diff.changes.length} changes.
                      </div>
                    )}
                  </>
                ) : (
                  <div className="investigation-empty">
                    Choose an earlier message or a pinned baseline.
                  </div>
                )}
              </>
            ) : tab === 'decoded' && protoResult?.error ? (
              <div className="notice notice--error">{protoResult.error}</div>
            ) : formatted.pending ? (
              <div className="payload-processing" role="status">
                Formatting {formatBytes(message.sizeBytes)} payload…
              </div>
            ) : (
              <>
                {formatted.error && (
                  <div className="notice notice--info-warning">
                    {formatted.error} Showing original content.
                  </div>
                )}
                {complete &&
                  tab === 'decoded' &&
                  !hasDecoded &&
                  message.wireEncoding?.includes('json') && (
                    <div className="notice notice--info-warning">
                      Structured JSON is unavailable. Showing original content.
                    </div>
                  )}
                <PayloadTextView
                  key={`${message.id}:${tab}`}
                  text={currentText}
                  json={tab === 'decoded' && hasDecoded && !formatted.error}
                  payloadBytes={message.sizeBytes}
                />
              </>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </aside>
  );
};

export default MessageInspector;
