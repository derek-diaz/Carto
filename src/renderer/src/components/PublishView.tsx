import type { RecentKeyStats } from '@shared/types';
import KeyExplorer from './KeyExplorer';
import PublishPanel, { type PublishDraft } from './PublishPanel';
import type { LogInput, ToastInput } from '../utils/notifications';
import type { ProtoTypeOption } from '../utils/proto';

type PublishViewProps = {
  connected: boolean;
  publishSupport: 'supported' | 'unknown' | 'unsupported';
  draft: PublishDraft;
  onDraftChange: (draft: PublishDraft) => void;
  onPublish: (
    keyexpr: string,
    payload: string,
    encoding: PublishDraft['encoding'],
    protoTypeId?: string
  ) => Promise<void>;
  onLog: (entry: LogInput) => void;
  onToast: (toast: ToastInput) => void;
  protoTypes: ProtoTypeOption[];
  keys: RecentKeyStats[];
  filter: string;
  onFilterChange: (value: string) => void;
};

const PublishView = ({
  connected,
  publishSupport,
  draft,
  onDraftChange,
  onPublish,
  onLog,
  onToast,
  protoTypes,
  keys,
  filter,
  onFilterChange
}: PublishViewProps) => (
  <div className="app_page app_page--wide">
    <PublishPanel
      connected={connected}
      publishSupport={publishSupport}
      draft={draft}
      onDraftChange={onDraftChange}
      onPublish={onPublish}
      onLog={onLog}
      onToast={onToast}
      protoTypes={protoTypes}
    />
    <KeyExplorer keys={keys} filter={filter} onFilterChange={onFilterChange} />
  </div>
);

export default PublishView;
