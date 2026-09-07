import type {
  ConnectionStatus,
  ConnectionTestParams,
  ConnectionTestResult,
  ConnectParams
} from '@shared/types';
import type { LogEntry, LogInput, ToastInput } from '../utils/notifications';
import ConnectPanel from './ConnectPanel';
import ConnectionDiagnostics from './ConnectionDiagnostics';

type ConnectionViewProps = {
  status: ConnectionStatus;
  events: LogEntry[];
  onClearEvents: () => void;
  defaultEndpoint?: string;
  onConnect: (params: ConnectParams) => Promise<void>;
  onTestConnection: (params: ConnectionTestParams) => Promise<ConnectionTestResult>;
  onLog: (entry: LogInput) => void;
  onToast: (toast: ToastInput) => void;
};

const ConnectionView = ({
  status,
  events,
  onClearEvents,
  defaultEndpoint,
  onConnect,
  onTestConnection,
  onLog,
  onToast
}: ConnectionViewProps) => (
  <div className="app_content app_content--single connection_shell [&>section:first-child]:mb-4 [&>section:first-child]:pb-0">
    <ConnectPanel
      status={status}
      defaultEndpoint={defaultEndpoint}
      onConnect={onConnect}
      onTestConnection={onTestConnection}
      onLog={onLog}
      onToast={onToast}
    />
    <ConnectionDiagnostics status={status} entries={events} onClear={onClearEvents} />
  </div>
);

export default ConnectionView;
