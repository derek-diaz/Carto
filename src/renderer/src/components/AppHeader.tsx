import type { PublishDraft } from './PublishPanel';
import type { Subscription } from '../store/useCarto';
import {
  IconClock,
  IconConnection,
  IconCopy,
  IconHash,
  IconLinkOff,
  IconPause,
  IconPlay,
  IconReplay,
  IconTrash
} from './Icons';

type ActionNotice = {
  type: 'ok' | 'error';
  message: string;
};

type AppHeaderProps = {
  viewTitle: string;
  viewDescription: string;
  subscriptionCount: number;
  bufferedCount: number;
  keyCount: number;
  statusConnected: boolean;
  endpointLabel: string;
  endpointTitle: string;
  canCopyEndpoint: boolean;
  copied: boolean;
  lastEndpoint: string;
  onCopyEndpoint: () => Promise<void>;
  view: 'monitor' | 'publish' | 'connection';
  selectedSub?: Subscription;
  onTogglePause: () => Promise<void>;
  onClearBuffer: () => Promise<void>;
  onUseKeyexpr: () => void;
  useKeyexprLabel: string;
  useKeyexprTitle: string;
  canUseKeyexpr: boolean;
  onLoadLastPublish: () => void;
  lastPublish: PublishDraft | null;
  onReplayLast: () => Promise<void>;
  actionNotice: ActionNotice | null;
  onDisconnect: () => Promise<void>;
  onOpenConnection: () => void;
};

const AppHeader = ({
  viewTitle,
  viewDescription,
  subscriptionCount,
  bufferedCount,
  keyCount,
  statusConnected,
  endpointLabel,
  endpointTitle,
  canCopyEndpoint,
  copied,
  lastEndpoint,
  onCopyEndpoint,
  view,
  selectedSub,
  onTogglePause,
  onClearBuffer,
  onUseKeyexpr,
  useKeyexprLabel,
  useKeyexprTitle,
  canUseKeyexpr,
  onLoadLastPublish,
  lastPublish,
  onReplayLast,
  actionNotice,
  onDisconnect,
  onOpenConnection
}: AppHeaderProps) => (
  <header className="app_header">
    <div className="app_header-left">
      <div className="app_title">
        <h1>{viewTitle}</h1>
        <p>{viewDescription}</p>
      </div>
    </div>
    <div className="app_header-right">
      <div className="app_stats">
        <div className="stat">
          <span className="stat_label">Subscriptions</span>{' '}<span className="stat_value">{subscriptionCount}</span>
        </div>
        <div className="stat">
          <span className="stat_label">Buffered</span>{' '}<span className="stat_value">{bufferedCount}</span>
        </div>
        <div className="stat">
          <span className="stat_label">Keys</span>{' '}<span className="stat_value">{keyCount}</span>
        </div>
      </div>
      <div className={`status ${statusConnected ? 'status--ok' : 'status--idle'}`}>
        <span className={`dot ${statusConnected ? 'dot--ok' : 'dot--idle'}`} />{' '}<span>
          {statusConnected ? 'Live' : 'Idle'}
        </span>
      </div>
      <div className="header-endpoint" title={endpointTitle}>
        <span className="header-endpoint_label">
          {statusConnected ? 'Endpoint' : 'Last endpoint'}
        </span>{' '}<span className="header-endpoint_value">{endpointLabel}</span>{' '}<button
          className="icon-button icon-button--compact icon-button--ghost"
          onClick={() => onCopyEndpoint().catch(() => {})}
          disabled={!lastEndpoint || !canCopyEndpoint}
          type="button"
          title={copied ? 'Copied' : 'Copy endpoint'}
          aria-label="Copy endpoint"
        >
          <span className="icon-button_icon" aria-hidden="true">
            <IconCopy />
          </span>
        </button>
      </div>
      <div className="app_actions">
        {view === 'monitor' && selectedSub ? (
          <>
            <button
              className="button button--ghost button--compact"
              onClick={() => onTogglePause().catch(() => {})}
              title="Pause or resume (Ctrl/Cmd+Shift+P)"
              type="button"
            >
              <span className="button_icon" aria-hidden="true">
                {selectedSub.paused ? <IconPlay /> : <IconPause />}
              </span>{' '}{selectedSub.paused ? 'Resume' : 'Pause'}
            </button>
            <button
              className="button button--ghost button--compact"
              onClick={() => onClearBuffer().catch(() => {})}
              title="Clear buffer (Ctrl/Cmd+Shift+K)"
              type="button"
            >
              <span className="button_icon" aria-hidden="true">
                <IconTrash />
              </span>{' '}Clear buffer
            </button>
          </>
        ) : null}
        {view === 'publish' ? (
          <>
            <button
              className="button button--ghost button--compact"
              onClick={() => onUseKeyexpr()}
              title={useKeyexprTitle}
              type="button"
              disabled={!canUseKeyexpr}
            >
              <span className="button_icon" aria-hidden="true">
                <IconHash />
              </span>{' '}{useKeyexprLabel}
            </button>
            <button
              className="button button--ghost button--compact"
              onClick={() => onLoadLastPublish()}
              title="Load last publish"
              type="button"
              disabled={!lastPublish}
            >
              <span className="button_icon" aria-hidden="true">
                <IconClock />
              </span>{' '}Load last
            </button>
            <button
              className="button button--ghost button--compact"
              onClick={() => onReplayLast().catch(() => {})}
              title="Replay last publish (Ctrl/Cmd+Shift+R)"
              type="button"
              disabled={!lastPublish || !statusConnected}
            >
              <span className="button_icon" aria-hidden="true">
                <IconReplay />
              </span>{' '}Replay last
            </button>
          </>
        ) : null}
        {statusConnected ? (
          <button
            className="button button--danger button--compact"
            onClick={() => onDisconnect().catch(() => {})}
            title="Disconnect (Ctrl/Cmd+Shift+D)"
            type="button"
          >
            <span className="button_icon" aria-hidden="true">
              <IconLinkOff />
            </span>{' '}Disconnect
          </button>
        ) : (
          <button
            className="button button--compact"
            onClick={onOpenConnection}
            title="Connection (Ctrl/Cmd+3)"
            type="button"
          >
            <span className="button_icon" aria-hidden="true">
              <IconConnection />
            </span>{' '}Connect
          </button>
        )}
        {actionNotice ? (
          <span className={`header-notice header-notice--${actionNotice.type}`}>
            {actionNotice.message}
          </span>
        ) : null}
      </div>
    </div>
  </header>
);

export default AppHeader;


