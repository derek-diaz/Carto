import { useEffect, useRef, useState } from 'react';
import type {
  CSSProperties,
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent
} from 'react';
import type { CartoMessage, RecentKeyStats } from '@shared/types';
import type { Subscription } from '../store/useCarto';
import type { LogInput, ToastInput } from '../utils/notifications';
import type { DecoderConfig, ProtoTypeOption } from '../utils/proto';
import {
  clampInspectorHeight,
  FALLBACK_MAX_INSPECTOR_HEIGHT,
  MIN_INSPECTOR_HEIGHT,
  MIN_STREAM_HEIGHT
} from '../utils/inspectorSizing';
import KeyExplorer from './KeyExplorer';
import MessageInspector from './MessageInspector';
import {
  IconClose,
  IconEdit,
  IconHash,
  IconMonitor,
  IconPause,
  IconPlay,
  IconPlus,
  IconTrash
} from './Icons';
import StreamView from './StreamView';
import SubscribePanel from './SubscribePanel';

const INSPECTOR_HEIGHT_STORAGE_KEY = 'carto.monitor.inspectorHeight.v3';
const DEFAULT_INSPECTOR_HEIGHT = 320;

const readInspectorHeight = () => {
  if (typeof globalThis === 'undefined' || !('localStorage' in globalThis)) {
    return DEFAULT_INSPECTOR_HEIGHT;
  }
  const stored = Number(globalThis.localStorage.getItem(INSPECTOR_HEIGHT_STORAGE_KEY));
  if (!Number.isFinite(stored)) return DEFAULT_INSPECTOR_HEIGHT;
  return clampInspectorHeight(stored);
};

const persistInspectorHeight = (value: number) => {
  if ('localStorage' in globalThis) {
    globalThis.localStorage.setItem(INSPECTOR_HEIGHT_STORAGE_KEY, String(Math.round(value)));
  }
};

type MonitorViewProps = {
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
  decoderById: Record<string, DecoderConfig | undefined>;
  selectedDecoder?: DecoderConfig;
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
  protoTypeLabels: Record<string, string>;
};

const MonitorView = ({
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
  decoderById,
  selectedDecoder,
  decodeProtobuf,
  resolveProtobufPreview,
  protoTypeLabels
}: MonitorViewProps) => {
  const selectedSubscription = subscriptions.find((sub) => sub.id === selectedSubId) ?? null;
  const [editingSubscriptionId, setEditingSubscriptionId] = useState<string | null>(null);
  const editingSubscription =
    subscriptions.find((sub) => sub.id === editingSubscriptionId) ?? null;
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [inspectorHeight, setInspectorHeight] = useState(readInspectorHeight);
  const [inspectorExpanded, setInspectorExpanded] = useState(false);
  const workspaceRef = useRef<HTMLElement | null>(null);
  const inspectorHeightRef = useRef(inspectorHeight);
  const inspectorRestoreHeightRef = useRef(inspectorHeight);

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
    inspectorHeightRef.current = inspectorHeight;
    workspaceRef.current?.style.setProperty('--monitor-inspector-height', `${inspectorHeight}px`);
  }, [inspectorHeight]);

  useEffect(() => {
    const handleViewportResize = () => {
      const workspaceHeight = workspaceRef.current?.getBoundingClientRect().height;
      if (!workspaceHeight) return;
      const desiredHeight = inspectorExpanded
        ? workspaceHeight - MIN_STREAM_HEIGHT
        : inspectorHeightRef.current;
      const nextHeight = clampInspectorHeight(desiredHeight, workspaceHeight);
      if (nextHeight === inspectorHeightRef.current) return;
      inspectorHeightRef.current = nextHeight;
      setInspectorHeight(nextHeight);
    };
    handleViewportResize();
    globalThis.addEventListener('resize', handleViewportResize);
    return () => globalThis.removeEventListener('resize', handleViewportResize);
  }, [inspectorExpanded]);

  useEffect(() => {
    if (selectedRecentKeys.length === 0) {
      setSelectedKey(null);
      return;
    }
    if (!selectedKey || !selectedRecentKeys.some((entry) => entry.key === selectedKey)) {
      setSelectedKey(selectedRecentKeys[0]?.key ?? null);
    }
  }, [selectedKey, selectedRecentKeys]);

  const handleInspectorResizeStart = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (monitorTab !== 'stream') return;
    event.preventDefault();
    const workspace = workspaceRef.current;
    if (!workspace) return;

    const pointerId = event.pointerId;
    event.currentTarget.setPointerCapture(pointerId);
    const startY = event.clientY;
    const startHeight = inspectorHeightRef.current;
    const workspaceHeight = workspace.getBoundingClientRect().height;
    let hasMoved = false;

    const handlePointerMove = (moveEvent: PointerEvent) => {
      if (!hasMoved) {
        hasMoved = true;
        setInspectorExpanded(false);
      }
      const nextHeight = clampInspectorHeight(
        startHeight + startY - moveEvent.clientY,
        workspaceHeight
      );
      inspectorHeightRef.current = nextHeight;
      workspace.style.setProperty('--monitor-inspector-height', `${nextHeight}px`);
    };

    const handlePointerEnd = () => {
      const nextHeight = inspectorHeightRef.current;
      setInspectorHeight(nextHeight);
      persistInspectorHeight(nextHeight);
      globalThis.removeEventListener('pointermove', handlePointerMove);
      globalThis.removeEventListener('pointerup', handlePointerEnd);
      globalThis.removeEventListener('pointercancel', handlePointerEnd);
    };

    globalThis.addEventListener('pointermove', handlePointerMove);
    globalThis.addEventListener('pointerup', handlePointerEnd, { once: true });
    globalThis.addEventListener('pointercancel', handlePointerEnd, { once: true });
  };

  const handleInspectorResizeKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (monitorTab !== 'stream') return;
    const workspaceHeight = workspaceRef.current?.getBoundingClientRect().height;
    const step = event.shiftKey ? 48 : 24;
    let nextHeight: number | null = null;

    if (event.key === 'ArrowUp') {
      nextHeight = inspectorHeightRef.current + step;
    } else if (event.key === 'ArrowDown') {
      nextHeight = inspectorHeightRef.current - step;
    } else if (event.key === 'Home') {
      nextHeight = MIN_INSPECTOR_HEIGHT;
    } else if (event.key === 'End') {
      nextHeight = workspaceHeight
        ? workspaceHeight - MIN_STREAM_HEIGHT
        : FALLBACK_MAX_INSPECTOR_HEIGHT;
    }

    if (nextHeight === null) return;
    event.preventDefault();
    const clampedHeight = clampInspectorHeight(nextHeight, workspaceHeight);
    inspectorHeightRef.current = clampedHeight;
    setInspectorHeight(clampedHeight);
    setInspectorExpanded(false);
    persistInspectorHeight(clampedHeight);
  };

  const restoreInspectorHeight = () => {
    const workspaceHeight = workspaceRef.current?.getBoundingClientRect().height;
    const nextHeight = clampInspectorHeight(inspectorRestoreHeightRef.current, workspaceHeight);
    inspectorHeightRef.current = nextHeight;
    setInspectorHeight(nextHeight);
    setInspectorExpanded(false);
  };

  const handleToggleInspectorExpanded = () => {
    if (inspectorExpanded) {
      restoreInspectorHeight();
      return;
    }
    const workspaceHeight = workspaceRef.current?.getBoundingClientRect().height;
    if (!workspaceHeight) return;
    inspectorRestoreHeightRef.current = inspectorHeightRef.current;
    const nextHeight = clampInspectorHeight(
      workspaceHeight - MIN_STREAM_HEIGHT,
      workspaceHeight
    );
    inspectorHeightRef.current = nextHeight;
    setInspectorHeight(nextHeight);
    setInspectorExpanded(true);
  };

  const handleCloseInspector = () => {
    if (inspectorExpanded) restoreInspectorHeight();
    onCloseInspector();
  };

  if (subscriptions.length === 0) {
    return (
      <div className="monitor_start">
        <section className="monitor_start-intro" aria-labelledby="monitor-start-title">
          <span className="monitor_start-kicker">Live monitor</span>
          <h2 id="monitor-start-title">Watch Zenoh messages as they arrive</h2>
          <p>
            Subscribe to a key expression and Carto will collect matching messages, discover keys,
            and let you inspect each payload.
          </p>

          <div className="monitor_start-examples">
            <div>
              <code>robot/telemetry</code>
              <span>One exact key</span>
            </div>
            <div>
              <code>demo/**</code>
              <span>Everything below a branch</span>
            </div>
            <div>
              <code>**</code>
              <span>Every key visible to this router</span>
            </div>
          </div>

          <p className="monitor_start-note">
            You can run multiple subscriptions side by side and give each one its own decoder.
          </p>
        </section>

        <SubscribePanel
          connected={connected}
          subscriptions={subscriptions}
          selectedSubId={selectedSubId}
          onSubscribe={onSubscribe}
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
          variant="onboarding"
        />
      </div>
    );
  }

  return (
    <div className="app_content app_content--single monitor_shell">
      <main
        className={`monitor_workspace ${
          monitorTab === 'stream' && selectedMessage ? 'monitor_workspace--inspector' : ''
        }`}
        ref={workspaceRef}
        style={{ '--monitor-inspector-height': `${inspectorHeight}px` } as CSSProperties}
      >
        <aside className="monitor_sidebar">
          <div className="monitor_sidebar-header">
            <div>
              <span className="monitor_eyebrow">Subscriptions</span>
            </div>
            <button
              className="icon-button icon-button--ghost"
              onClick={openNewSubscription}
              type="button"
              title="Add subscription"
              aria-label="Add subscription"
            >
              <span className="icon-button_icon" aria-hidden="true">
                <IconPlus />
              </span>
            </button>
          </div>

          <div className="monitor_sidebar-list" role="tablist" aria-label="Subscriptions">
            {subscriptions.map((sub) => {
              const isActive = selectedSubId === sub.id;
              const decoderLabel = getDecoderLabel(decoderById[sub.id], protoTypeLabels);

              return (
                <div
                  key={sub.id}
                  className={`monitor_subscription ${isActive ? 'monitor_subscription--active' : ''}`}
                >
                  <button
                    className="monitor_subscription-select"
                    onClick={() => setSelectedSubId(sub.id)}
                    type="button"
                    title={sub.keyexpr}
                    role="tab"
                    aria-selected={isActive}
                  >
                    <div className="monitor_subscription-title">
                      <span>{sub.keyexpr}</span>
                      {sub.paused ? <span className="tabs_status">Paused</span> : null}
                    </div>
                    <div className="monitor_subscription-meta">
                      <span>{decoderLabel}</span>
                      <span>{sub.bufferSize} msg buffer</span>
                    </div>
                  </button>

                  <div className="monitor_subscription-actions">
                    <button
                      className="icon-button icon-button--ghost icon-button--compact"
                      onClick={() => openEditSubscription(sub.id)}
                      type="button"
                      title={`Edit ${sub.keyexpr}`}
                      aria-label={`Edit ${sub.keyexpr}`}
                    >
                      <span className="icon-button_icon" aria-hidden="true">
                        <IconEdit />
                      </span>
                    </button>
                    <button
                      className="icon-button icon-button--ghost icon-button--compact"
                      onClick={() => {
                        onPause(sub.id, !sub.paused).catch(() => {});
                      }}
                      type="button"
                      title={sub.paused ? 'Resume stream' : 'Pause stream'}
                      aria-label={sub.paused ? 'Resume stream' : 'Pause stream'}
                    >
                      <span className="icon-button_icon" aria-hidden="true">
                        {sub.paused ? <IconPlay /> : <IconPause />}
                      </span>
                    </button>
                    <button
                      className="icon-button icon-button--ghost icon-button--compact"
                      onClick={() => {
                        onClear(sub.id).catch(() => {});
                      }}
                      type="button"
                      title="Clear buffer"
                      aria-label="Clear buffer"
                    >
                      <span className="icon-button_icon" aria-hidden="true">
                        <IconTrash />
                      </span>
                    </button>
                    <button
                      className="icon-button icon-button--ghost icon-button--compact"
                      onClick={() => {
                        onUnsubscribe(sub.id).catch(() => {});
                      }}
                      type="button"
                      title={`Close ${sub.keyexpr}`}
                      aria-label={`Close ${sub.keyexpr}`}
                    >
                      <span className="icon-button_icon" aria-hidden="true">
                        <IconClose />
                      </span>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </aside>

        {showSubscribe ? (
          <dialog
            className="modal"
            aria-label={editingSubscription ? 'Edit subscription' : 'Add subscription'}
            aria-modal="true"
            onKeyDown={(event) => {
              if (event.key !== 'Escape') return;
              event.preventDefault();
              closeSubscriptionModal();
            }}
            open
          >
            <div className="modal_backdrop" onClick={closeSubscriptionModal} />
            <div className="modal_content">
              <SubscribePanel
                connected={connected}
                subscriptions={subscriptions}
                selectedSubId={selectedSubId}
                onSubscribe={onSubscribe}
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
            </div>
          </dialog>
        ) : null}

        <section className={`monitor_stage ${monitorTab === 'keys' ? 'monitor_stage--full' : ''}`}>
          <div className="monitor_stage-header">
            <div className="tabs">
              <button
                className={`tabs_button ${monitorTab === 'stream' ? 'tabs_button--active' : ''}`}
                onClick={() => setMonitorTab('stream')}
                type="button"
              >
                <span className="tabs_icon" aria-hidden="true">
                  <IconMonitor />
                </span>{' '}Stream{' '}<span className="tabs_badge">{selectedMessages.length}</span>
              </button>
              <button
                className={`tabs_button ${monitorTab === 'keys' ? 'tabs_button--active' : ''}`}
                onClick={() => setMonitorTab('keys')}
                type="button"
              >
                <span className="tabs_icon" aria-hidden="true">
                  <IconHash />
                </span>{' '}Keys{' '}<span className="tabs_badge">{selectedRecentKeys.length}</span>
              </button>
            </div>
          </div>

          <div className="monitor_stage-body">
            <div
              className={`monitor-panel ${
                monitorTab === 'stream' ? 'monitor-panel--active' : ''
              }`}
            >
              <StreamView
                messages={selectedMessages}
                selectedMessageId={selectedMessage?.id ?? null}
                onSelectMessage={onSelectMessage}
                decoder={selectedDecoder}
                decodeProtobuf={decodeProtobuf}
                resolveProtobufPreview={resolveProtobufPreview}
              />
            </div>

            <div
              className={`monitor-panel ${monitorTab === 'keys' ? 'monitor-panel--active' : ''}`}
            >
              <KeyExplorer
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
            message={selectedMessage}
            protoResult={protoResult}
            subscriptionLabel={selectedSubscription?.keyexpr}
            variant="dock"
            expanded={inspectorExpanded}
            onClose={handleCloseInspector}
            onResizeStart={handleInspectorResizeStart}
            onResizeKeyDown={handleInspectorResizeKeyDown}
            onToggleExpanded={handleToggleInspectorExpanded}
          />
        ) : null}
      </main>
    </div>
  );
};

const getDecoderLabel = (
  decoder: DecoderConfig | undefined,
  protoTypeLabels: Record<string, string>
) => {
  if (!decoder || decoder.kind === 'raw') return 'Raw payload';
  if (decoder.kind === 'protobuf') {
    return protoTypeLabels[decoder.typeId] ?? 'Protobuf';
  }
  return `${decoder.typeIds.length} protobuf types`;
};

export default MonitorView;
