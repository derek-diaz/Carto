import type { AddProtoSchemas } from '../utils/proto';
import { Dialog, DialogContent, DialogTitle } from './ui/dialog';
import { Tabs, TabsList, TabsTrigger, TabsContent } from './ui/tabs';
import { Button } from './ui/button';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import type { CaptureStats, CartoMessage, RecentKeyStats } from '@shared/types';
import type { Subscription } from '../store/useCarto';
import type { LogInput, ToastInput } from '../utils/notifications';
import type { DecoderConfig, ProtoTypeOption, ProtobufDecoder } from '../utils/proto';
import { useInspectorSplit } from '../hooks/useInspectorSplit';
import KeyExplorer from './KeyExplorer';
import MessageInspector from './MessageInspector';
import { Menu } from '@base-ui/react/menu';
import {
  Edit3,
  Pause,
  Play,
  MoreHorizontal,
  Pin,
  ChevronDown,
  Radio,
  List,
  Network,
  Trash2
} from 'lucide-react';
import { SubscriptionTabs } from './SubscriptionTabs';
import { PinnedTray } from './PinnedTray';
import { formatBytes, formatEncoding } from '../utils/format';
import StreamView from './StreamView';
import SubscribePanel from './SubscribePanel';
import DiscoveryView from './DiscoveryView';
import type { useDiscovery } from '../store/useDiscovery';

type MonitorViewProps = {
  discoveryOpen: boolean;
  setDiscoveryOpen: (open: boolean) => void;
  discovery: ReturnType<typeof useDiscovery>;
  capture?: CaptureStats;
  pinnedMessages: CartoMessage[];
  pinnedContext: Record<
    string,
    { protoResult?: { data?: unknown } | null; subscriptionLabel?: string }
  >;
  onPin: (message: CartoMessage) => void;
  onUnpin: (id: string) => void;
  onPublishMessage: (message: CartoMessage) => void;
  onPublishKey: (key: string) => void;
  getMessage: (subscriptionId: string, messageId: string) => Promise<CartoMessage | null>;
  connected: boolean;
  subscriptions: Subscription[];
  selectedSubId: string | null;
  setSelectedSubId: (value: string | null) => void;
  selectedMessages: CartoMessage[];
  selectedRecentKeys: RecentKeyStats[];
  recentKeysFilter: string;
  setRecentKeysFilter: (value: string) => void;
  monitorTab: 'stream' | 'keys';
  setMonitorTab: (tab: 'stream' | 'keys') => void;
  showSubscribe: boolean;
  setShowSubscribe: (value: boolean) => void;
  onSubscribe: (keyexpr: string, bufferSize?: number, decoder?: DecoderConfig) => Promise<string>;
  onUpdateSubscription: (
    subscriptionId: string,
    keyexpr: string,
    bufferSize?: number,
    decoder?: DecoderConfig
  ) => Promise<void>;
  onUnsubscribe: (subscriptionId: string) => Promise<void>;
  onPause: (subscriptionId: string, paused: boolean) => Promise<void>;
  onClear: (subscriptionId: string) => Promise<void>;
  onSelectMessage: (msg: CartoMessage) => void;
  selectedMessage: CartoMessage | null;
  protoResult?: {
    data?: unknown;
    error?: string;
    label?: string;
    schemaName?: string;
    typeId?: string;
  } | null;
  onCloseInspector: () => void;
  onLog: (entry: LogInput) => void;
  onToast: (toast: ToastInput) => void;
  protoTypes: ProtoTypeOption[];
  onAddProtoSchema: AddProtoSchemas;
  decoderById: Record<string, DecoderConfig | undefined>;
  selectedDecoder?: DecoderConfig;
  decodeProtobuf?: ProtobufDecoder;
  resolveProtobufPreview?: (message: CartoMessage) => Promise<string | null>;
  protoTypeLabels: Record<string, string>;
};

const MonitorView = ({
  discoveryOpen,
  setDiscoveryOpen,
  discovery,
  capture,
  pinnedMessages,
  pinnedContext,
  onPin,
  onUnpin,
  onPublishMessage,
  onPublishKey,
  getMessage,
  connected,
  subscriptions,
  selectedSubId,
  setSelectedSubId,
  selectedMessages,
  selectedRecentKeys,
  recentKeysFilter,
  setRecentKeysFilter,
  monitorTab,
  setMonitorTab,
  showSubscribe,
  setShowSubscribe,
  onSubscribe,
  onUpdateSubscription,
  onUnsubscribe,
  onPause,
  onClear,
  onSelectMessage,
  selectedMessage,
  protoResult,
  onCloseInspector,
  onLog,
  onToast,
  protoTypes,
  onAddProtoSchema,
  decoderById,
  selectedDecoder,
  decodeProtobuf,
  resolveProtobufPreview,
  protoTypeLabels
}: MonitorViewProps) => {
  const selectedSubscription = subscriptions.find((sub) => sub.id === selectedSubId) ?? null;
  const [editingSubscriptionId, setEditingSubscriptionId] = useState<string | null>(null);
  const editingSubscription = subscriptions.find((sub) => sub.id === editingSubscriptionId) ?? null;
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [keyFocus, setKeyFocus] = useState<{ key: string; branch: boolean } | null>(null);
  const [pinnedOpen, setPinnedOpen] = useState(false);
  const [comparison, setComparison] = useState<CartoMessage | null>(null);
  const [comparisonBusy, setComparisonBusy] = useState(false);
  const [comparisonError, setComparisonError] = useState('');
  const comparisonRequest = useRef(0);
  useEffect(() => {
    comparisonRequest.current += 1;
    setComparison(null);
    setComparisonBusy(false);
    setComparisonError('');
  }, [selectedMessage?.id]);
  useEffect(() => {
    setKeyFocus(null);
    setSelectedKey(null);
  }, [selectedSubId]);
  const compareWith = async (baseline?: CartoMessage) => {
    if (!selectedMessage) return;
    const request = ++comparisonRequest.current;
    setComparison(null);
    setComparisonError('');
    const index = selectedMessages.findIndex((message) => message.id === selectedMessage.id);
    const previous =
      baseline ??
      selectedMessages
        .slice(0, Math.max(0, index))
        .reverse()
        .find((message) => message.key === selectedMessage.key);
    if (!previous) {
      setComparisonError(
        'No earlier message for this key remains in the buffer. Pin a baseline while traffic arrives.'
      );
      return;
    }
    setComparisonBusy(true);
    try {
      const full =
        baseline ?? (selectedSubId ? await getMessage(selectedSubId, previous.id) : null);
      if (request !== comparisonRequest.current) return;
      if (!full || full.payloadUnavailable || full.payloadTruncated)
        throw new Error(
          'The earlier payload has expired. Choose a newer message or a pinned baseline.'
        );
      setComparison(full);
    } catch (error) {
      if (request === comparisonRequest.current)
        setComparisonError(error instanceof Error ? error.message : String(error));
    } finally {
      if (request === comparisonRequest.current) setComparisonBusy(false);
    }
  };
  const watchKey = async (expression: string) => {
    const existing = subscriptions.find((sub) => sub.keyexpr === expression);
    if (existing) setSelectedSubId(existing.id);
    else await onSubscribe(expression, selectedSubscription?.bufferSize, selectedDecoder);
    setKeyFocus(null);
    setMonitorTab('stream');
  };
  const split = useInspectorSplit(!discoveryOpen, monitorTab === 'stream');
  const { workspaceRef, height: inspectorHeight, expanded: inspectorExpanded } = split;
  useEffect(() => {
    if (!editingSubscriptionId) return;
    if (!subscriptions.some((sub) => sub.id === editingSubscriptionId)) {
      setEditingSubscriptionId(null);
      setShowSubscribe(false);
    }
  }, [editingSubscriptionId, setShowSubscribe, subscriptions]);
  const closeSubscriptionModal = () => {
    setEditingSubscriptionId(null);
    setShowSubscribe(false);
  };
  const openNewSubscription = () => {
    setEditingSubscriptionId(null);
    setShowSubscribe(true);
  };
  const openEditSubscription = (subscriptionId: string) => {
    setEditingSubscriptionId(subscriptionId);
    setShowSubscribe(true);
  };
  useEffect(() => {
    if (selectedRecentKeys.length === 0) {
      setSelectedKey(null);
      return;
    }
    if (
      selectedKey &&
      !selectedRecentKeys.some(
        (entry) => entry.key === selectedKey || entry.key.startsWith(`${selectedKey}/`)
      )
    ) {
      setSelectedKey(selectedRecentKeys[0]?.key ?? null);
    }
  }, [selectedKey, selectedRecentKeys]);
  const handleCloseInspector = () => {
    split.close();
    onCloseInspector();
  };
  const comparisonData = useMemo(
    () =>
      comparison && pinnedContext[comparison.id]
        ? pinnedContext[comparison.id].protoResult?.data
        : decodeProtobuf?.(selectedDecoder, comparison)?.data,
    [comparison, pinnedContext, decodeProtobuf, selectedDecoder]
  );
  const mode = discoveryOpen ? 'discovery' : monitorTab;
  const changeMode = (value: string) => {
    setDiscoveryOpen(value === 'discovery');
    if (value !== 'discovery') setMonitorTab(value as 'stream' | 'keys');
  };
  const selectSubscription = (id: string) => {
    setSelectedSubId(id);
    setDiscoveryOpen(false);
  };
  const averageSize = selectedMessages.length
    ? selectedMessages.reduce((sum, message) => sum + message.sizeBytes, 0) /
      selectedMessages.length
    : null;
  const encodings = new Set(
    selectedMessages.map((message) => message.wireEncoding ?? message.encoding)
  );
  return (
    <div className="app_content app_content--single monitor_shell monitor-instrument">
      <SubscriptionTabs
        subscriptions={subscriptions}
        selectedId={selectedSubId}
        connected={connected}
        onSelect={selectSubscription}
        onClose={onUnsubscribe}
        onAdd={openNewSubscription}
      />
      <Tabs
        value={mode}
        onValueChange={(value) => changeMode(String(value))}
        className="monitor-mode-root gap-0"
      >
        <div className="monitor-mode-bar">
          <TabsList
            aria-label="Monitor workspace mode"
            variant="line"
            className="monitor-mode-list group-data-horizontal/tabs:h-9"
          >
            <TabsTrigger value="stream">
              <List className="size-3.5" />
              Stream
            </TabsTrigger>
            <TabsTrigger value="keys">
              <Network className="size-3.5" />
              Explore keys
            </TabsTrigger>
            <TabsTrigger value="discovery">
              <Radio className="size-3.5" />
              Discover traffic
            </TabsTrigger>
          </TabsList>
          <Button
            variant="ghost"
            size="sm"
            className="monitor-pinned-toggle"
            onClick={() => setPinnedOpen(!pinnedOpen)}
            aria-expanded={pinnedOpen}
            aria-controls="monitor-pinned-tray"
          >
            <Pin className="size-3.5" />
            Pinned <span>{pinnedMessages.length}/8</span>
            <ChevronDown className={`size-3 ${pinnedOpen ? 'rotate-180' : ''}`} />
          </Button>
        </div>
        {pinnedOpen && (
          <PinnedTray
            messages={pinnedMessages}
            selectedId={selectedMessage?.id}
            onUnpin={onUnpin}
            onSelect={(message) => {
              onSelectMessage(message);
              changeMode('stream');
            }}
          />
        )}
        <TabsContent value="discovery" className="monitor-discovery-panel">
          <DiscoveryView
            connected={connected}
            snapshot={discovery.snapshot}
            error={discovery.error}
            onStart={discovery.start}
            onStop={discovery.stop}
            protoTypes={protoTypes}
            decodeProtobuf={decodeProtobuf}
            onAddProtoSchema={onAddProtoSchema}
            hasSubscriptions={subscriptions.length > 0}
            onManual={openNewSubscription}
            embedded
            onWatch={async (expression, decoder) => {
              const existing = subscriptions.find((sub) => sub.keyexpr === expression);
              if (existing) {
                if (decoder)
                  await onUpdateSubscription(existing.id, expression, existing.bufferSize, decoder);
                setSelectedSubId(existing.id);
              } else await onSubscribe(expression, undefined, decoder);
              onCloseInspector();
              setKeyFocus(null);
              changeMode('stream');
            }}
          />
        </TabsContent>
        {!discoveryOpen && (
          <TabsContent value={monitorTab} className="monitor-working-panel">
            <main
              className={`monitor_workspace ${monitorTab === 'stream' && selectedMessage ? 'monitor_workspace--inspector' : ''} ${monitorTab === 'stream' && selectedMessage && inspectorExpanded ? 'monitor_workspace--expanded' : ''}`}
              ref={workspaceRef}
              style={{ '--monitor-inspector-height': `${inspectorHeight}px` } as CSSProperties}
            >
              <section className="monitor_stage">
                {selectedSubscription ? (
                  <>
                    <div className="monitor-active-bar">
                      <div
                        className={`capture-state ${!connected || selectedSubscription.paused ? 'capture-state--paused' : ''}`}
                      >
                        <span />
                        {!connected
                          ? 'Offline'
                          : selectedSubscription.paused
                            ? 'Display paused'
                            : 'Listening'}
                      </div>
                      <code className="monitor-active-key" title={selectedSubscription.keyexpr}>
                        {selectedSubscription.keyexpr}
                      </code>
                      <div className="monitor-active-actions">
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={!connected}
                          onClick={() => openEditSubscription(selectedSubscription.id)}
                        >
                          <Edit3 className="size-3.5" />
                          Edit
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          title="Pause or resume (Ctrl/Cmd+Shift+P)"
                          disabled={!connected}
                          onClick={() =>
                            void onPause(
                              selectedSubscription.id,
                              !selectedSubscription.paused
                            ).catch(() => {})
                          }
                        >
                          {selectedSubscription.paused ? (
                            <Play className="size-3.5" />
                          ) : (
                            <Pause className="size-3.5" />
                          )}
                          {selectedSubscription.paused ? 'Resume' : 'Pause'}
                        </Button>
                        <Menu.Root>
                          <Menu.Trigger
                            render={
                              <Button
                                variant="ghost"
                                size="icon-sm"
                                aria-label="Subscription actions"
                              />
                            }
                          >
                            <MoreHorizontal className="size-4" />
                          </Menu.Trigger>
                          <Menu.Portal>
                            <Menu.Positioner sideOffset={4} align="end" className="z-50">
                              <Menu.Popup className="monitor-menu">
                                <div className="monitor-menu-caption">
                                  {getDecoderLabel(selectedDecoder, protoTypeLabels)} ·{' '}
                                  {selectedSubscription.bufferSize.toLocaleString()} message buffer
                                </div>
                                <Menu.Item
                                  className="monitor-menu-item"
                                  title="Clear buffer (Ctrl/Cmd+Shift+K)"
                                  disabled={!connected}
                                  onClick={() =>
                                    void onClear(selectedSubscription.id)
                                      .then(handleCloseInspector)
                                      .catch(() => {})
                                  }
                                >
                                  <Trash2 className="size-3.5" />
                                  Clear buffer
                                </Menu.Item>
                              </Menu.Popup>
                            </Menu.Positioner>
                          </Menu.Portal>
                        </Menu.Root>
                      </div>
                    </div>
                    {(!connected || selectedSubscription.paused) && (
                      <div className="capture-explanation">
                        {!connected
                          ? 'Offline. Retained previews and pinned payloads remain available.'
                          : `Display paused. Incoming traffic still fills the latest ${selectedSubscription.bufferSize.toLocaleString()} samples; older payloads can expire.`}
                      </div>
                    )}
                  </>
                ) : (
                  <div className="monitor-no-subscription">
                    <strong>No open subscriptions</strong>
                    <span>Add a key expression or discover traffic to start inspecting.</span>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={!connected}
                      onClick={openNewSubscription}
                    >
                      Add subscription
                    </Button>
                  </div>
                )}
                <div className="monitor_stage-body" hidden={!selectedSubscription}>
                  <div hidden={monitorTab !== 'stream'} className="monitor-panel">
                    <StreamView
                      contextSummary={
                        <>
                          {selectedSubscription && (
                            <div className="monitor-stream-status" aria-label="Stream statistics">
                              {capture && (
                                <span>
                                  <strong>{capture.received.toLocaleString()}</strong> received
                                </span>
                              )}
                              <span title="Messages currently retained in the display">
                                <strong>
                                  {selectedMessages.length.toLocaleString()} /{' '}
                                  {selectedSubscription.bufferSize.toLocaleString()}
                                </strong>{' '}
                                retained
                              </span>
                              {averageSize !== null && Number.isFinite(averageSize) && (
                                <span title="Average payload size in the retained display buffer">
                                  <strong>{formatBytes(Math.round(averageSize))}</strong> avg
                                </span>
                              )}
                              {encodings.size > 0 && (
                                <span
                                  className="monitor-status-encoding"
                                  title={[...encodings].join(', ')}
                                >
                                  {encodings.size === 1
                                    ? formatEncoding([...encodings][0])
                                    : `${encodings.size} encodings`}
                                </span>
                              )}
                              {Boolean(capture?.skipped) && (
                                <span
                                  className="capture-loss"
                                  title="Known samples discarded from display queues or the paused buffer; not a measure of network loss"
                                >
                                  {capture?.skipped.toLocaleString()} skipped before display
                                </span>
                              )}
                            </div>
                          )}
                        </>
                      }
                      contextId={selectedSubId ?? 'pinned'}
                      keyFocus={keyFocus}
                      onClearKeyFocus={() => setKeyFocus(null)}
                      connected={connected}
                      paused={selectedSubscription?.paused}
                      messages={selectedMessages}
                      selectedMessageId={selectedMessage?.id ?? null}
                      onSelectMessage={onSelectMessage}
                      decoder={selectedDecoder}
                      decodeProtobuf={decodeProtobuf}
                      resolveProtobufPreview={resolveProtobufPreview}
                    />
                  </div>
                  <div hidden={monitorTab !== 'keys'} className="monitor-panel">
                    <KeyExplorer
                      messages={selectedMessages}
                      connected={connected}
                      onWatch={watchKey}
                      onFocus={(key, branch) => {
                        setKeyFocus({ key, branch });
                        setMonitorTab('stream');
                      }}
                      onPublishKey={onPublishKey}
                      onSelectMessage={(message) => {
                        onSelectMessage(message);
                        setMonitorTab('stream');
                      }}
                      keys={selectedRecentKeys}
                      filter={recentKeysFilter}
                      selectedKey={selectedKey}
                      onFilterChange={setRecentKeysFilter}
                      onSelectKey={setSelectedKey}
                    />
                  </div>
                </div>
              </section>
              {monitorTab === 'stream' && selectedMessage ? (
                <MessageInspector
                  pinned={pinnedMessages.some((message) => message.id === selectedMessage.id)}
                  onPin={() => onPin(selectedMessage)}
                  onUnpin={() => onUnpin(selectedMessage.id)}
                  onPublish={() => onPublishMessage(selectedMessage)}
                  connected={connected}
                  comparison={comparison}
                  comparisonData={comparisonData}
                  comparisonBusy={comparisonBusy}
                  comparisonError={comparisonError}
                  onCompare={() => void compareWith()}
                  baselines={pinnedMessages.filter(
                    (message) =>
                      message.key === selectedMessage.key && message.id !== selectedMessage.id
                  )}
                  onComparePinned={(message) => void compareWith(message)}
                  message={selectedMessage}
                  protoResult={protoResult}
                  subscriptionLabel={
                    pinnedContext[selectedMessage.id]?.subscriptionLabel ??
                    selectedSubscription?.keyexpr
                  }
                  variant="dock"
                  expanded={inspectorExpanded}
                  onClose={handleCloseInspector}
                  onResizeStart={split.onResizeStart}
                  onResizeKeyDown={split.onResizeKeyDown}
                  onToggleExpanded={split.toggleExpanded}
                  splitter={split.separator}
                />
              ) : null}
            </main>
          </TabsContent>
        )}
      </Tabs>
      <Dialog
        open={showSubscribe}
        onOpenChange={(open) => {
          if (!open) closeSubscriptionModal();
        }}
      >
        <DialogContent
          className="max-h-[85vh] overflow-y-auto sm:max-w-2xl"
          showCloseButton={false}
        >
          <DialogTitle className="sr-only">
            {editingSubscription ? 'Edit subscription' : 'Add subscription'}
          </DialogTitle>
          <SubscribePanel
            connected={connected}
            subscriptions={subscriptions}
            selectedSubId={selectedSubId}
            onSubscribe={async (...args) => {
              const id = await onSubscribe(...args);
              changeMode('stream');
              return id;
            }}
            onUpdateSubscription={onUpdateSubscription}
            onUnsubscribe={onUnsubscribe}
            onPause={onPause}
            onClear={onClear}
            onSelect={setSelectedSubId}
            onLog={onLog}
            onToast={onToast}
            protoTypes={protoTypes}
            decoderById={decoderById}
            protoTypeLabels={protoTypeLabels}
            editingSubscription={editingSubscription}
            onClose={closeSubscriptionModal}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
};

const getDecoderLabel = (
  decoder: DecoderConfig | undefined,
  protoTypeLabels: Record<string, string>
) => {
  if (!decoder || decoder.kind === 'raw') return 'Automatic payload';
  if (decoder.kind === 'protobuf') return protoTypeLabels[decoder.typeId] ?? 'Protobuf';
  return `${decoder.typeIds.length} protobuf types`;
};

export default MonitorView;
