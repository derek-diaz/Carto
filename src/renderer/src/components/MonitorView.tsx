import type { CartoMessage, RecentKeyStats } from '@shared/types';
import type { Subscription } from '../store/useCarto';
import type { LogInput, ToastInput } from '../utils/notifications';
import KeyExplorer from './KeyExplorer';
import { IconClose, IconHash, IconMonitor, IconPlus } from './Icons';
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
  streamTitle: string;
  monitorTab: 'stream' | 'keys';
  setMonitorTab: (tab: 'stream' | 'keys') => void;
  showSubscribe: boolean;
  setShowSubscribe: (value: boolean) => void;
  onSubscribe: (keyexpr: string, bufferSize?: number) => Promise<string>;
  onUnsubscribe: (subscriptionId: string) => Promise<void>;
  onPause: (subscriptionId: string, paused: boolean) => Promise<void>;
  onClear: (subscriptionId: string) => Promise<void>;
  onSelectMessage: (msg: CartoMessage) => void;
  onLog: (entry: LogInput) => void;
  onToast: (toast: ToastInput) => void;
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
  streamTitle,
  monitorTab,
  setMonitorTab,
  showSubscribe,
  setShowSubscribe,
  onSubscribe,
  onUnsubscribe,
  onPause,
  onClear,
  onSelectMessage,
  onLog,
  onToast
}: MonitorViewProps) => {
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
        />
      </div>
    );
  }

  return (
    <div className="app_content app_content--single">
      <main className="main main--tabs">
        <div className="monitor-tabs">
          <div className="monitor-tabs_scroll">
            <div className="tabs tabs--subscriptions" role="tablist" aria-label="Subscriptions">
              {subscriptions.map((sub) => {
                const isActive = selectedSubId === sub.id;
                return (
                  <div
                    key={sub.id}
                    className={`tab-pill ${isActive ? 'tab-pill--active' : ''}`}
                  >
                        <button
                          className="tab-pill_select"
                          onClick={() => setSelectedSubId(sub.id)}
                          type="button"
                          title={sub.keyexpr}
                          role="tab"
                          aria-selected={isActive}
                        >
                          <span className="tabs_label">{sub.keyexpr}</span>{sub.paused ? (
                            <>{' '}<span className="tabs_status">Paused</span></>
                          ) : null}
                        </button>
                    <button
                      className="tab-pill_close"
                      onClick={() => {
                        onUnsubscribe(sub.id).catch(() => {});
                      }}
                      type="button"
                      title={`Close ${sub.keyexpr}`}
                      aria-label={`Close ${sub.keyexpr}`}
                    >
                      <span className="tab-pill_icon" aria-hidden="true">
                        <IconClose />
                      </span>
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
          <button
            className="button button--ghost monitor-tabs_add"
            onClick={() => setShowSubscribe(true)}
            type="button"
            title="Add subscription"
          >
            <span className="button_icon" aria-hidden="true">
              <IconPlus />
            </span>{' '}Add subscription
          </button>
        </div>

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
                onClose={() => setShowSubscribe(false)}
              />
            </div>
          </dialog>
        ) : null}

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
        <div
          className={`monitor-panel ${
            monitorTab === 'stream' ? 'monitor-panel--active' : ''
          }`}
        >
          <StreamView
            title={streamTitle}
            messages={selectedMessages}
            onSelectMessage={onSelectMessage}
          />
        </div>
        <div
          className={`monitor-panel ${monitorTab === 'keys' ? 'monitor-panel--active' : ''}`}
        >
          <KeyExplorer
            keys={selectedRecentKeys}
            filter={recentKeysFilter}
            onFilterChange={setRecentKeysFilter}
          />
        </div>
      </main>
    </div>
  );
};

export default MonitorView;


