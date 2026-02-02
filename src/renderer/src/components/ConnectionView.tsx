import type { ConnectionStatus, ConnectionTestParams, ConnectionTestResult, ConnectParams } from '@shared/types';
import type { LogInput, ToastInput } from '../utils/notifications';
import type { ProtoSchema } from '../utils/proto';
import ConnectPanel from './ConnectPanel';
import ProtoPanel from './ProtoPanel';

type ConnectionViewProps = {
  status: ConnectionStatus;
  defaultEndpoint?: string;
  onConnect: (params: ConnectParams) => Promise<void>;
  onTestConnection: (params: ConnectionTestParams) => Promise<ConnectionTestResult>;
  onDisconnect: () => Promise<void>;
  onLog: (entry: LogInput) => void;
  onToast: (toast: ToastInput) => void;
  schemas: ProtoSchema[];
  onAddSchema: (name: string, source: string) => boolean;
  onRemoveSchema: (id: string) => void;
};

const ConnectionView = ({
  status,
  defaultEndpoint,
  onConnect,
  onTestConnection,
  onDisconnect,
  onLog,
  onToast,
  schemas,
  onAddSchema,
  onRemoveSchema
}: ConnectionViewProps) => (
  <div className="app_page app_page--wide">
    <ConnectPanel
      status={status}
      defaultEndpoint={defaultEndpoint}
      onConnect={onConnect}
      onTestConnection={onTestConnection}
      onDisconnect={onDisconnect}
      onLog={onLog}
      onToast={onToast}
    />
    <ProtoPanel
      schemas={schemas}
      onAddSchema={onAddSchema}
      onRemoveSchema={onRemoveSchema}
      onLog={onLog}
      onToast={onToast}
    />
  </div>
);

export default ConnectionView;
