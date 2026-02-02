import type { ConnectionHealth } from '@shared/types';
import type { PublishDraft } from './PublishPanel';
import type { Subscription } from '../store/useCarto';
import {
  IconClock,
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
  statusConnected: boolean;
  health?: ConnectionHealth;
  endpointLabel: string;
  endpointTitle: string;
  canCopyEndpoint: boolean;
  copied: boolean;
  lastEndpoint: string;
  onCopyEndpoint: () => Promise<void>;
  view: 'monitor' | 'publish' | 'connection' | 'logs';
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
};

const AppHeader = ({
  viewTitle,
  viewDescription,
  statusConnected,
  health,
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
  onDisconnect
}: AppHeaderProps) => {
  const derivedState = health?.state ?? (statusConnected ? 'connected' : 'disconnected');
  const statusLabelMap: Record<ConnectionHealth['state'], string> = {
    connected: 'Live',
    connecting: 'Connecting',
    reconnecting: 'Reconnecting',
    disconnected: 'Idle'
  };
  const statusClassMap: Record<ConnectionHealth['state'], string> = {
    connected: 'status--ok',
    connecting: 'status--warn',
    reconnecting: 'status--warn',
    disconnected: 'status--idle'
  };
  const dotClassMap: Record<ConnectionHealth['state'], string> = {
    connected: 'dot--ok',
    connecting: 'dot--warn',
    reconnecting: 'dot--warn',
    disconnected: 'dot--idle'
  };
  const statusLabel = statusLabelMap[derivedState];
  const statusClass = statusClassMap[derivedState];
  const dotClass = dotClassMap[derivedState];
  const statusDetail = (() => {
    if (!health) return '';
    if (health.state === 'reconnecting') {
      const parts = [] as string[];
      if (health.attempt) parts.push(`Attempt ${health.attempt}.`);
      if (health.nextRetryMs) {
        parts.push(`Next retry in ${Math.round(health.nextRetryMs / 1000)}s.`);
      }
      if (health.lastError) parts.push(`Last error: ${health.lastError}`);
      return parts.join(' ');
    }
    if (health.state === 'connecting') {
      return 'Connecting to the router.';
    }
    if (health.lastError) {
      return `Last error: ${health.lastError}`;
    }
    return '';
  })();

  return (
    <header className="app_header">
      <div className="app_header-left">
        <div className="app_title">
          <h1>{viewTitle}</h1>
          <p>{viewDescription}</p>
        </div>
      </div>
      <div className="app_header-right">
        <div className={`status ${statusClass}`} title={statusDetail || undefined}>
          <span className={`dot ${dotClass}`} />{' '}<span>{statusLabel}</span>
        </div>
        <div className="header-endpoint" title={endpointTitle}>
          <span className="header-endpoint_label">
            {statusConnected ? 'Endpoint' : 'Last endpoint'}
          </span>{' '}
          <span className="header-endpoint_value">{endpointLabel}</span>{' '}
          <button
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
                </span>{' '}
                {selectedSub.paused ? 'Resume' : 'Pause'}
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
                </span>{' '}
                {useKeyexprLabel}
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
          ) : null}
          {actionNotice ? (
            <span className={`header-notice header-notice--${actionNotice.type}`}>
              {actionNotice.message}
            </span>
          ) : null}
        </div>
      </div>
    </header>
  );
};

export default AppHeader;


