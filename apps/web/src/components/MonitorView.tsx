import { useEffect, useState } from 'react';
import type { CartoMessage, RecentKeyStats } from '@shared/types';
import type { Subscription } from '../store/useCarto';
import type { LogInput, ToastInput } from '../utils/notifications';
import type { DecoderConfig, ProtoTypeOption } from '../utils/proto';
import KeyExplorer from './KeyExplorer';
import MessageInspector from './MessageInspector';
import {
  IconClose,
  IconHash,
  IconMonitor,
  IconPause,
  IconPlay,
  IconPlus,
  IconTrash
} from './Icons';
import StreamView from './StreamView';
import SubscribePanel from './SubscribePanel';

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
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  useEffect(() => {
    if (selectedRecentKeys.length === 0) {
      setSelectedKey(null);
      return;
    }
    if (!selectedKey || !selectedRecentKeys.some((entry) => entry.key === selectedKey)) {
      setSelectedKey(selectedRecentKeys[0]?.key ?? null);
    }
  }, [selectedKey, selectedRecentKeys]);

  if (subscriptions.length === 0) {
    return (
      <div className="app_page app_page--center">
        <SubscribePanel
          connected={connected}
          subscriptions={subscriptions}
          selectedSubId={selectedSubId}
          onSubscribe={onSubscribe}
          onUnsubscribe={onUnsubscribe}
          onPause={onPause}
          onClear={onClear}
          onSelect={setSelectedSubId}
          onLog={onLog}
          onToast={onToast}
          protoTypes={protoTypes}
          decoderById={decoderById}
          protoTypeLabels={protoTypeLabels}
        />
      </div>
    );
  }

  return (
    <div className="app_content app_content--single monitor_shell">
      <main className="monitor_workspace">
        <aside className="monitor_sidebar">
          <div className="monitor_sidebar-header">
            <div>
              <span className="monitor_eyebrow">Subscriptions</span>
            </div>
            <button
              className="icon-button icon-button--ghost"
              onClick={() => setShowSubscribe(true)}
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
          <dialog className="modal" aria-label="Add subscription" open>
            <div className="modal_backdrop" onClick={() => setShowSubscribe(false)} />
            <div className="modal_content">
              <SubscribePanel
                connected={connected}
                subscriptions={subscriptions}
                selectedSubId={selectedSubId}
                onSubscribe={onSubscribe}
                onUnsubscribe={onUnsubscribe}
                onPause={onPause}
                onClear={onClear}
                onSelect={setSelectedSubId}
                onLog={onLog}
                onToast={onToast}
                protoTypes={protoTypes}
                decoderById={decoderById}
                protoTypeLabels={protoTypeLabels}
                onClose={() => setShowSubscribe(false)}
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

        {monitorTab === 'stream' ? (
          <MessageInspector
            message={selectedMessage}
            protoResult={protoResult}
            subscriptionLabel={selectedSubscription?.keyexpr}
            variant="dock"
            onClose={onCloseInspector}
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
