import { Button } from './ui/button';
import type { ConnectionHealth } from '@shared/types';
import { IconCopy, IconLinkOff } from './Icons';

type ActionNotice = {
  type: 'ok' | 'error';
  message: string;
};

type AppHeaderProps = {
  quietConnection?: boolean;
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
  actionNotice: ActionNotice | null;
  onDisconnect: () => Promise<void>;
};

const AppHeader = ({
  quietConnection = false,
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
          {viewDescription ? <p>{viewDescription}</p> : null}
        </div>
      </div>
      <div className="app_header-right">
        <div className={`status ${statusClass}`} title={statusDetail || undefined}>
          <span className={`dot ${dotClass}`} /> <span>{statusLabel}</span>
        </div>
        <div className="header-endpoint" title={endpointTitle}>
          <span className="header-endpoint_label">
            {statusConnected ? 'Endpoint' : 'Last endpoint'}
          </span>{' '}
          <span className="header-endpoint_value">{endpointLabel}</span>{' '}
          <Button
            variant="outline"
            size="icon-sm"
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
          </Button>
        </div>
        <div className="app_actions">
          {statusConnected ? (
            <Button
              variant={quietConnection ? 'ghost' : 'destructive'}
              size="sm"
              className={
                quietConnection ? 'text-muted-foreground' : 'button button--danger button--compact'
              }
              onClick={() => onDisconnect().catch(() => {})}
              title="Disconnect (Ctrl/Cmd+Shift+D)"
              type="button"
            >
              <span className="button_icon" aria-hidden="true">
                <IconLinkOff />
              </span>{' '}
              Disconnect
            </Button>
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
