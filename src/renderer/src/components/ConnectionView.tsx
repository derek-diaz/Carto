import type { ConnectionStatus } from '@shared/types';
import ConnectPanel from './ConnectPanel';

type ConnectionViewProps = {
  status: ConnectionStatus;
  defaultEndpoint?: string;
  onConnect: (endpoint: string, configJson?: string) => Promise<void>;
  onDisconnect: () => Promise<void>;
};

const ConnectionView = ({
  status,
  defaultEndpoint,
  onConnect,
  onDisconnect
}: ConnectionViewProps) => (
  <div className="app_page">
    <ConnectPanel
      status={status}
      defaultEndpoint={defaultEndpoint}
      onConnect={onConnect}
      onDisconnect={onDisconnect}
    />
  </div>
);

export default ConnectionView;
