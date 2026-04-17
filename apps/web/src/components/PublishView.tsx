import { useDeferredValue, useMemo } from 'react';
import type { RecentKeyStats } from '@shared/types';
import PublishPanel, { type PublishDraft } from './PublishPanel';
import type { LogInput, ToastInput } from '../utils/notifications';
import type { ProtoTypeOption } from '../utils/proto';
import { formatAge, formatBytes } from '../utils/format';
import { IconSearch } from './Icons';

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
}: PublishViewProps) => {
  const deferredFilter = useDeferredValue(filter.trim().toLowerCase());
  const activeKeyexpr = draft.keyexpr.trim();

  const filteredKeys = useMemo(() => {
    if (!deferredFilter) return keys;
    return keys.filter((entry) => entry.key.toLowerCase().includes(deferredFilter));
  }, [deferredFilter, keys]);

  return (
    <div className="app_content app_content--single publish_shell">
      <main className="publish_workspace">
        <aside className="publish_sidebar">
          <div className="publish_sidebar-header">
            <div>
              <span className="monitor_eyebrow">Observed keys</span>
            </div>
            <span className="badge badge--idle">{filteredKeys.length}</span>
          </div>

          <div className="publish_sidebar-search">
            <label className="stream_search">
              <div className="input-group input-group--filter">
                <span className="input-group_icon" aria-hidden="true">
                  <IconSearch />
                </span>
                <input
                  type="text"
                  placeholder="Filter keys..."
                  value={filter}
                  onChange={(event) => onFilterChange(event.target.value)}
                  aria-label="Filter publish keys"
                />
              </div>
            </label>
          </div>

          <div className="publish_sidebar-list" role="list" aria-label="Recent keys">
            {filteredKeys.length === 0 ? (
              <div className="publish_sidebar-empty">
                <span className="monitor_eyebrow">No keys</span>
                <p>No observed keys match the current filter.</p>
              </div>
            ) : (
              filteredKeys.slice(0, 200).map((entry) => {
                const isActive = activeKeyexpr === entry.key;

                return (
                  <button
                    key={entry.key}
                    className={`publish_keyrow ${isActive ? 'publish_keyrow--active' : ''}`}
                    onClick={() => onDraftChange({ ...draft, keyexpr: entry.key })}
                    type="button"
                  >
                    <div className="publish_keyrow-title">
                      <span className="publish_keyrow-key">{entry.key}</span>
                      <span className="publish_keyrow-count">{entry.count}</span>
                    </div>
                    <div className="publish_keyrow-meta">
                      <span>{formatAge(entry.lastSeen)} ago</span>
                      <span>{formatBytes(entry.bytes)}</span>
                    </div>
                  </button>
                );
              })
            )}
          </div>

        </aside>

        <section className="publish_stage">
          <div className="publish_stage-body">
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
          </div>
        </section>
      </main>
    </div>
  );
};

export default PublishView;
