import type { AddProtoSchemas } from '../utils/proto';
import { DiscoveryControls } from './DiscoveryControls';
import { Input } from './ui/input';
import { Button } from './ui/button';
import { Button as BaseButton } from '@base-ui/react/button';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { DiscoveryParams, DiscoverySnapshot, DiscoveredKey } from '@shared/types';
import { suggestSubscriptions } from '../utils/discoverySuggestions';
import { DiscoveredKeyPreview } from './DiscoveredKeyPreview';
import type { DecoderConfig, ProtoTypeOption, ProtobufDecoder } from '../utils/proto';
import { ArrowRight, Plus, Radio, Search } from 'lucide-react';

type Props = {
  embedded?: boolean;
  connected: boolean;
  snapshot: DiscoverySnapshot | null;
  error: string;
  onStart: (params: DiscoveryParams) => Promise<void>;
  onStop: () => Promise<void>;
  onWatch: (expression: string, decoder?: DecoderConfig) => Promise<void>;
  protoTypes: ProtoTypeOption[];
  decodeProtobuf?: ProtobufDecoder;
  onAddProtoSchema: AddProtoSchemas;
  onManual: () => void;
  hasSubscriptions: boolean;
};

type Branch = {
  path: string;
  name: string;
  children: Map<string, Branch>;
  entry?: DiscoveredKey;
  count: number;
};

const DiscoveryView = ({
  embedded = false,
  connected,
  snapshot,
  error,
  onStart,
  onStop,
  onWatch,
  protoTypes,
  decodeProtobuf,
  onAddProtoSchema,
  onManual,
  hasSubscriptions
}: Props) => {
  const [filter, setFilter] = useState('');
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState('');
  const [now, setNow] = useState(() => Date.now());
  const detailRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (selectedKey && window.matchMedia('(max-width: 760px)').matches) {
      detailRef.current?.scrollIntoView({
        block: 'start',
        behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'
      });
    }
  }, [selectedKey]);
  const active =
    connected && Boolean(snapshot && ['starting', 'running', 'stopping'].includes(snapshot.state));
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (snapshot?.startedAt) {
      setSelectedKey(null);
      setFilter('');
    }
  }, [snapshot?.startedAt, snapshot?.keyexpr, snapshot?.durationSeconds]);
  const keys = useMemo(() => snapshot?.keys ?? [], [snapshot?.keys]);
  const selected = keys.find((key) => key.key === selectedKey) ?? keys[0];
  const suggestions = useMemo(() => suggestSubscriptions(keys.map((key) => key.key)), [keys]);
  const tree = useMemo(() => {
    const root = new Map<string, Branch>();
    for (const entry of keys.filter((key) =>
      key.key.toLowerCase().includes(filter.toLowerCase())
    )) {
      let children = root;
      let path = '';
      // Extremely deep keys remain selectable without constructing an unbounded nested DOM.
      const chunks = entry.key.split('/');
      const names =
        chunks.length > 16 ? [...chunks.slice(0, 15), chunks.slice(15).join('/')] : chunks;
      for (const name of names) {
        path = path ? `${path}/${name}` : name;
        let node = children.get(name);
        if (!node) {
          node = { path, name, children: new Map(), count: 0 };
          children.set(name, node);
        }
        node.count += 1;
        if (path === entry.key) node.entry = entry;
        children = node.children;
      }
    }
    return root;
  }, [keys, filter]);
  const elapsed = snapshot?.startedAt
    ? Math.max(0, ((snapshot.endedAt ?? now) - snapshot.startedAt) / 1000)
    : 0;
  const act = async (action: () => Promise<void>) => {
    setBusy(true);
    setActionError('');
    try {
      await action();
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };
  const renderNodes = (nodes: Map<string, Branch>, depth = 0) =>
    [...nodes.values()]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((node) => (
        <li key={node.path}>
          {node.children.size > 0 ? (
            <details open={depth < 2 || Boolean(filter)}>
              <summary>
                <span>{node.name}</span>
                <small>{node.count}</small>
              </summary>
              {node.entry && (
                <BaseButton
                  type="button"
                  aria-pressed={selected?.key === node.path}
                  onClick={() => setSelectedKey(node.path)}
                >
                  Inspect this key
                </BaseButton>
              )}
              <ul>{renderNodes(node.children, depth + 1)}</ul>
            </details>
          ) : (
            <BaseButton
              type="button"
              className={selected?.key === node.path ? 'is-selected' : ''}
              aria-pressed={selected?.key === node.path}
              onClick={() => setSelectedKey(node.path)}
              title={node.path}
            >
              <span
                className={
                  active && now - (node.entry?.lastSeen ?? 0) < 5000
                    ? 'size-1.5 shrink-0 rounded-full bg-primary'
                    : 'size-1.5 shrink-0 rounded-full bg-muted-foreground/40'
                }
              />
              <span>{node.name}</span>
              <small>{node.entry?.count.toLocaleString()}</small>
            </BaseButton>
          )}
        </li>
      ));
  return (
    <section
      className="flex h-full min-h-0 flex-col overflow-auto bg-background text-foreground"
      aria-labelledby="discovery-title"
    >
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-4 border-b bg-card px-5 py-4">
        <div className="space-y-1">
          <h2 id="discovery-title" className="text-base font-semibold tracking-tight">
            Traffic explorer
          </h2>
          <p className="text-xs text-muted-foreground">
            Browse observed keys and choose what to watch.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <DiscoveryControls
            connected={connected}
            active={active}
            busy={busy}
            snapshot={snapshot}
            onStart={(params) => act(() => onStart(params))}
            onStop={() => act(onStop)}
          />
          <span className="mx-1 h-5 border-l" aria-hidden="true" />
          <Button variant="ghost" size="sm" onClick={onManual}>
            <Plus className="size-4" />{' '}
            {!embedded && hasSubscriptions ? 'Back to monitoring' : 'Add subscription'}
          </Button>
        </div>
      </header>
      {(actionError || error || snapshot?.error) && (
        <div
          className="shrink-0 border-b bg-destructive/10 px-5 py-3 text-sm text-destructive"
          role="alert"
        >
          {actionError || error || snapshot?.error}
        </div>
      )}
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b px-5 py-2.5 text-xs text-muted-foreground">
        <span role="status" aria-atomic="true" className="flex min-w-0 items-center gap-2">
          <span
            className={
              active
                ? 'size-1.5 shrink-0 rounded-full bg-primary'
                : 'size-1.5 shrink-0 rounded-full bg-muted-foreground/50'
            }
          />
          {!connected
            ? 'Offline · saved scan'
            : active
              ? 'Listening for traffic…'
              : snapshot?.state === 'error'
                ? 'Scan interrupted'
                : snapshot?.startedAt
                  ? snapshot.reason === 'timeout'
                    ? 'Scan complete'
                    : 'Scan stopped'
                  : 'Ready to scan'}
          {active && (
            <span className="tabular-nums">
              · {Math.max(0, Math.ceil((snapshot?.durationSeconds ?? 15) - elapsed))}s left
            </span>
          )}
          {snapshot?.keyexpr && snapshot.keyexpr !== '**' && (
            <code className="max-w-48 truncate" title={snapshot.keyexpr}>
              {snapshot.keyexpr}
            </code>
          )}
        </span>
        {snapshot?.startedAt && (
          <span className="tabular-nums">
            {keys.length.toLocaleString()} keys · {(snapshot.received ?? 0).toLocaleString()}{' '}
            samples
          </span>
        )}
      </div>
      {active && (
        <div className="h-0.5 shrink-0 bg-muted" aria-hidden="true">
          <div
            className="h-full bg-primary transition-[width] duration-1000 motion-reduce:transition-none"
            style={{
              width: `${Math.min(100, (elapsed / (snapshot?.durationSeconds ?? 15)) * 100)}%`
            }}
          />
        </div>
      )}
      {Boolean(snapshot?.omitted) && (
        <p className="shrink-0 border-b bg-muted/40 px-5 py-3 text-xs text-muted-foreground">
          Index limit reached. {snapshot?.omitted.toLocaleString()} samples from additional or
          oversized keys were omitted. Use Scan options to narrow the scope. Up to{' '}
          {snapshot?.limit.toLocaleString()} keys are kept.
        </p>
      )}
      <div className="grid min-h-0 flex-1 grid-cols-[minmax(250px,30%)_minmax(0,1fr)] max-md:flex max-md:flex-col">
        <aside
          className="flex min-h-0 flex-col border-r bg-card max-md:max-h-72 max-md:shrink-0 max-md:border-r-0 max-md:border-b"
          aria-label="Observed keys"
        >
          <div className="space-y-3 p-4">
            <div className="flex items-center justify-between text-xs font-medium">
              <span>Observed keys</span>
              <span className="rounded-md bg-muted px-2 py-0.5 tabular-nums text-muted-foreground">
                {keys.length}
              </span>
            </div>
            <div className="relative">
              <Search className="pointer-events-none absolute top-1/2 left-3 z-10 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="h-9 rounded-lg pl-9"
                aria-label="Find a discovered key"
                placeholder="Filter keys…"
                value={filter}
                onChange={(event) => setFilter(event.target.value)}
              />
            </div>
          </div>
          <nav
            className="discovery-key-tree min-h-20 flex-1 overflow-auto px-3 pb-4"
            aria-label="Discovered key hierarchy"
          >
            <ul>{renderNodes(tree)}</ul>
            {tree.size === 0 && (
              <p className="px-2 py-4 text-xs leading-relaxed text-muted-foreground">
                {filter
                  ? 'No matching keys.'
                  : active
                    ? 'Waiting for the first message…'
                    : 'No keys observed yet.'}
              </p>
            )}
          </nav>
          <p className="border-t px-4 py-3 text-[11px] leading-relaxed text-muted-foreground">
            Only keys that sent traffic during the scan appear here.
          </p>
        </aside>
        <div
          className="min-h-0 min-w-0 overflow-auto bg-card/40 p-6 max-md:overflow-visible max-sm:p-4"
          ref={detailRef}
        >
          {selected ? (
            <DiscoveredKeyPreview
              key={selected.key}
              protoTypes={protoTypes}
              decodeProtobuf={decodeProtobuf}
              onAddProtoSchema={onAddProtoSchema}
              entry={selected}
              elapsed={elapsed}
              active={active}
              now={now}
              disabled={!connected || busy}
              onWatch={(decoder) => void act(() => onWatch(selected.key, decoder))}
            />
          ) : (
            <div className="flex min-h-64 items-center justify-center py-12">
              <div className="max-w-sm space-y-3 text-center">
                <Radio className="mx-auto size-6 text-muted-foreground" />
                <h3 className="text-base font-medium">
                  {!connected
                    ? 'Connect to explore traffic'
                    : active
                      ? 'Listening for messages'
                      : snapshot?.startedAt
                        ? 'No traffic observed'
                        : 'Find active keys'}
                </h3>
                <p className="text-sm leading-relaxed text-muted-foreground">
                  {!connected
                    ? 'Open Connection to connect to a router.'
                    : active
                      ? 'Keys will appear here as your system publishes. You can also add a subscription directly.'
                      : snapshot?.startedAt
                        ? 'Check that a publisher is running, or try a longer or more focused scan.'
                        : 'Scan your connection to see its active keys and preview their payloads.'}
                </p>
              </div>
            </div>
          )}
          {suggestions.length > 0 && (
            <section className="mt-8 space-y-3 border-t pt-5" aria-label="Suggested subscriptions">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h4 className="text-xs font-medium">Watch a group</h4>
                <span className="text-[11px] text-muted-foreground">
                  Inferred from observed keys
                </span>
              </div>
              {suggestions.map((suggestion) => (
                <div
                  key={suggestion.expression}
                  className="flex flex-wrap items-center gap-3 rounded-lg border px-3 py-2"
                >
                  <code className="min-w-0 flex-1 break-all text-xs">{suggestion.expression}</code>
                  <span className="text-xs text-muted-foreground">{suggestion.count} keys</span>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={!connected || busy}
                    aria-label={`Watch ${suggestion.expression}`}
                    onClick={() => void act(() => onWatch(suggestion.expression))}
                  >
                    Watch <ArrowRight />
                  </Button>
                </div>
              ))}
              <p className="text-[11px] text-muted-foreground">
                Wildcards may also match keys outside this scan.
              </p>
            </section>
          )}
        </div>
      </div>
    </section>
  );
};

export default DiscoveryView;
