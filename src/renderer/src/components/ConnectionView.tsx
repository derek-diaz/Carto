import type { ConnectionStatus, ConnectionTestParams, ConnectionTestResult, ConnectParams } from '@shared/types';
import type { LogInput, ToastInput } from '../utils/notifications';
import ConnectPanel from './ConnectPanel';

type ConnectionViewProps = {
  status: ConnectionStatus;
  defaultEndpoint?: string;
  onConnect: (params: ConnectParams) => Promise<void>;
  onTestConnection: (params: ConnectionTestParams) => Promise<ConnectionTestResult>;
  onDisconnect: () => Promise<void>;
  onLog: (entry: LogInput) => void;
  onToast: (toast: ToastInput) => void;
};

const ConnectionView = ({
  status,
  defaultEndpoint,
  onConnect,
  onTestConnection,
  onDisconnect,
  onLog,
  onToast
}: ConnectionViewProps) => (
  <div className="app_page">
    <ConnectPanel
      status={status}
      defaultEndpoint={defaultEndpoint}
      onConnect={onConnect}
      onTestConnection={onTestConnection}
      onDisconnect={onDisconnect}
      onLog={onLog}
      onToast={onToast}
    />
  </div>
);

export default ConnectionView;
