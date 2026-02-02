import type { LogEntry } from '../utils/notifications';
import LogsPanel from './LogsPanel';

type LogsViewProps = {
  logs: LogEntry[];
  onClearLogs: () => void;
};

const LogsView = ({ logs, onClearLogs }: LogsViewProps) => (
  <div className="app_page app_page--full">
    <LogsPanel entries={logs} onClear={onClearLogs} />
  </div>
);

export default LogsView;
