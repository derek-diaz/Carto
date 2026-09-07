import { Button } from './ui/button';
import { Button as BaseButton } from '@base-ui/react/button';
import { Input } from './ui/input';
import { useDeferredValue, useMemo } from 'react';
import type { QueryableInfo, RecentKeyStats } from '@shared/types';
import PublishPanel, { type PublishDraft } from './PublishPanel';
import type { LogInput, ToastInput } from '../utils/notifications';
import type { AddProtoSchemas, ProtoTypeOption } from '../utils/proto';
import { formatAge } from '../utils/format';
import { IconClose, IconSearch } from './Icons';

type PublishViewProps = {
  connected: boolean;
  publishSupport: 'supported' | 'unknown' | 'unsupported';
  queryableSupport: 'supported' | 'unknown' | 'unsupported';
  draft: PublishDraft;
  onDraftChange: (draft: PublishDraft) => void;
  onEncodingChange: (draft: PublishDraft) => void;
  validateProtoDraft: (typeId: string, payload: string) => string | null;
  onAddSchema: AddProtoSchemas;
  onPublish: (
    keyexpr: string,
    payload: string,
    encoding: PublishDraft['encoding'],
    protoTypeId?: string,
    wireEncoding?: string
  ) => Promise<void>;
  onDeclareQueryable: (
    keyexpr: string,
    payload: string,
    encoding: PublishDraft['encoding'],
    protoTypeId?: string
  ) => Promise<void>;
  queryables: QueryableInfo[];
  onUndeclareQueryable: (queryableId: string) => Promise<void>;
  getProtoSamplePayload: (typeId: string) => string | null;
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
  queryableSupport,
  draft,
  onDraftChange,
  onEncodingChange,
  validateProtoDraft,
  onAddSchema,
  onPublish,
  onDeclareQueryable,
  queryables,
  onUndeclareQueryable,
  getProtoSamplePayload,
  onLog,
  onToast,
  protoTypes,
  keys,
  filter,
  onFilterChange
}: PublishViewProps) => {
  const deferredFilter = useDeferredValue(filter.trim().toLowerCase());
  const activeKeyexpr = draft.keyexpr.trim();

  const handleUndeclare = async (entry: QueryableInfo) => {
    try {
      await onUndeclareQueryable(entry.id);
      onToast({ type: 'ok', message: 'Queryable stopped', detail: entry.keyexpr });
      onLog({
        level: 'info',
        source: 'queryable',
        message: `Undeclared queryable ${entry.keyexpr}.`
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      onToast({ type: 'error', message: 'Undeclare failed', detail: message });
      onLog({ level: 'error', source: 'queryable', message, detail: entry.keyexpr });
    }
  };

  const filteredKeys = useMemo(() => {
    if (!deferredFilter) return keys;
    return keys.filter((entry) => entry.key.toLowerCase().includes(deferredFilter));
  }, [deferredFilter, keys]);

  return (
    <div className="app_content app_content--single min-h-0 flex-1 overflow-auto bg-background p-0">
      <main className="min-w-0 p-4 lg:p-5">
        <PublishPanel
          connected={connected}
          publishSupport={publishSupport}
          queryableSupport={queryableSupport}
          draft={draft}
          onDraftChange={onDraftChange}
          onEncodingChange={onEncodingChange}
          validateProtoDraft={validateProtoDraft}
          onAddSchema={onAddSchema}
          onPublish={onPublish}
          onDeclareQueryable={onDeclareQueryable}
          getProtoSamplePayload={getProtoSamplePayload}
          onLog={onLog}
          onToast={onToast}
          protoTypes={protoTypes}
          targetAccessory={
            <details className="group border-b pb-2 text-xs">
              <summary className="w-fit cursor-pointer py-1 text-muted-foreground hover:text-foreground">
                Observed keys · {keys.length}
              </summary>
              <div className="space-y-3 px-4 pt-5 pb-3">
                <div className="flex items-center justify-between text-xs">
                  <h2 className="font-medium">Observed keys</h2>
                  <span className="text-muted-foreground tabular-nums">{keys.length}</span>
                </div>
                <div className="relative">
                  <IconSearch className="pointer-events-none absolute top-2.5 left-2.5 size-4 text-muted-foreground" />
                  <Input
                    className="h-9 rounded-lg border bg-background pl-8 text-xs"
                    placeholder="Find a key…"
                    value={filter}
                    onChange={(event) => onFilterChange(event.target.value)}
                    aria-label="Filter publish keys"
                  />
                </div>
              </div>
              <ul className="max-h-64 space-y-1 overflow-auto px-2 pb-3" aria-label="Recent keys">
                {filteredKeys.length === 0 ? (
                  <li className="px-2 py-5 text-xs leading-relaxed text-muted-foreground">
                    {filter
                      ? 'No matching keys.'
                      : 'Keys appear here as traffic arrives. You can also enter a target directly.'}
                  </li>
                ) : (
                  filteredKeys.slice(0, 200).map((entry) => (
                    <li key={entry.key}>
                      <BaseButton
                        className={`flex w-full flex-col gap-1 rounded-sm border px-3 py-2 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring ${activeKeyexpr === entry.key ? 'border-primary/20 bg-primary/10' : 'border-transparent hover:bg-muted/60'}`}
                        onClick={(event) => {
                          onDraftChange({ ...draft, keyexpr: entry.key });
                          event.currentTarget.closest('details')?.removeAttribute('open');
                        }}
                        aria-pressed={activeKeyexpr === entry.key}
                        title={entry.key}
                      >
                        <span
                          className={`w-full truncate font-mono text-xs ${activeKeyexpr === entry.key ? 'text-primary' : 'text-foreground'}`}
                        >
                          {entry.key}
                        </span>
                        <span className="flex w-full justify-between gap-2 text-[11px] text-muted-foreground">
                          <span>{entry.count.toLocaleString()} samples</span>
                          <span>{formatAge(entry.lastSeen)} ago</span>
                        </span>
                      </BaseButton>
                    </li>
                  ))
                )}
              </ul>
            </details>
          }
        />
        {queryables.length > 0 && (
          <section
            className="max-h-60 shrink-0 overflow-auto border-t p-3"
            aria-label="Active queryables"
          >
            <h2 className="mb-3 flex items-center justify-between px-1 text-xs font-medium">
              Queryables <span className="text-muted-foreground">{queryables.length}</span>
            </h2>
            <ul className="space-y-2" aria-label="Queryables">
              {queryables.map((entry) => (
                <li key={entry.id} className="flex items-center gap-2 rounded-lg border p-2">
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-mono text-xs" title={entry.keyexpr}>
                      {entry.keyexpr}
                    </div>
                    <div className="mt-1 text-[11px] text-muted-foreground">
                      {entry.encoding} · {formatAge(entry.createdAt)} ago
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="rounded-md"
                    title={`Stop ${entry.keyexpr}`}
                    aria-label={`Stop queryable ${entry.keyexpr}`}
                    onClick={() => void handleUndeclare(entry)}
                  >
                    <IconClose />
                  </Button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>
    </div>
  );
};
export default PublishView;
