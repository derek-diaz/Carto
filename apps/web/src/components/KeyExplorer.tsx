import { Button } from './ui/button';
import { Input } from './ui/input';
import { Button as BaseButton } from '@base-ui/react/button';
import { useMemo, useState } from 'react';
import type { CartoMessage, RecentKeyStats } from '@shared/types';
import { formatAge, formatBytes, formatTime } from '../utils/format';
import { IconChevronDown, IconHash, IconSearch } from './Icons';

type KeyExplorerProps = {
  keys: RecentKeyStats[];
  messages: CartoMessage[];
  filter: string;
  selectedKey: string | null;
  connected: boolean;
  onFilterChange: (value: string) => void;
  onSelectKey: (value: string) => void;
  onWatch: (expression: string) => Promise<void>;
  onFocus: (key: string, branch: boolean) => void;
  onPublishKey: (key: string) => void;
  onSelectMessage: (message: CartoMessage) => void;
};

type KeyNode = {
  path: string;
  name: string;
  children: Map<string, KeyNode>;
  entry?: RecentKeyStats;
  count: number;
  bytes: number;
  lastSeen: number;
  leaves: number;
};

const KeyExplorer = ({
  keys,
  messages,
  filter,
  selectedKey,
  connected,
  onFilterChange,
  onSelectKey,
  onWatch,
  onFocus,
  onPublishKey,
  onSelectMessage
}: KeyExplorerProps) => {
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState('');
  const tree = useMemo(() => {
    const root = new Map<string, KeyNode>();
    const nodes = new Map<string, KeyNode>();
    for (const entry of keys) {
      let children = root;
      let path = '';
      for (const name of entry.key.split('/')) {
        path = path ? `${path}/${name}` : name;
        let node = children.get(name);
        if (!node) {
          node = { path, name, children: new Map(), count: 0, bytes: 0, lastSeen: 0, leaves: 0 };
          children.set(name, node);
          nodes.set(path, node);
        }
        node.count += entry.count;
        node.bytes += entry.bytes;
        node.lastSeen = Math.max(node.lastSeen, entry.lastSeen);
        node.leaves += 1;
        if (path === entry.key) node.entry = entry;
        children = node.children;
      }
    }
    return { root, nodes };
  }, [keys]);
  const selected = selectedKey ? tree.nodes.get(selectedKey) : undefined;
  const recent = useMemo(
    () =>
      messages
        .filter(
          (message) => message.key === selectedKey || message.key.startsWith(`${selectedKey}/`)
        )
        .slice(-8)
        .reverse(),
    [messages, selectedKey]
  );
  const watch = async (expression: string) => {
    setBusy(true);
    setActionError('');
    try {
      await onWatch(expression);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };
  const renderNodes = (nodes: Map<string, KeyNode>, depth = 0) =>
    [...nodes.values()]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((node) => (
        <li key={node.path}>
          {node.children.size > 0 ? (
            <details open={depth < 2 || Boolean(filter)}>
              <summary>
                <span className="key-tree_chevron">
                  <IconChevronDown />
                </span>
                <span>{node.name}</span>
                <small>{node.leaves}</small>
              </summary>
              <BaseButton
                type="button"
                className={`key-tree_branch ${selectedKey === node.path ? 'is-selected' : ''}`}
                onClick={() => onSelectKey(node.path)}
              >
                Explore {node.name}
                <span>↗</span>
              </BaseButton>
              <ul>{renderNodes(node.children, depth + 1)}</ul>
            </details>
          ) : (
            <BaseButton
              type="button"
              className={`key-tree_leaf ${selectedKey === node.path ? 'is-selected' : ''}`}
              onClick={() => onSelectKey(node.path)}
              title={node.path}
              aria-pressed={selectedKey === node.path}
            >
              <span className="key-tree_dot" />
              <span>{node.name}</span>
              <small>{node.count.toLocaleString()}</small>
            </BaseButton>
          )}
        </li>
      ));

  return (
    <section className="key-space">
      <aside className="key-space_tree">
        <div className="key-space_heading">
          <span className="monitor_eyebrow">Observed keyspace</span>
          <span className="badge badge--idle">{keys.length}</span>
        </div>
        <label className="key-space_search">
          <IconSearch />
          <Input
            value={filter}
            onChange={(event) => onFilterChange(event.target.value)}
            placeholder="Find a key…"
            aria-label="Find an observed key"
          />
          {filter && (
            <BaseButton
              type="button"
              onClick={() => onFilterChange('')}
              aria-label="Clear key search"
            >
              ×
            </BaseButton>
          )}
        </label>
        <nav aria-label="Observed key hierarchy">
          <ul className="key-tree">{renderNodes(tree.root)}</ul>
        </nav>
        {keys.length === 0 && (
          <div className="investigation-empty">
            <strong>{filter ? 'No matching keys' : 'Your keyspace starts here'}</strong>
            <p>
              {filter
                ? 'Try a shorter name or clear the search.'
                : 'Keys appear as matching traffic arrives.'}
            </p>
          </div>
        )}
        <p className="key-space_note">
          Observed in this subscription. Quiet or unobserved keys may be absent.
        </p>
      </aside>
      <div className="key-space_detail">
        {selected ? (
          <>
            <div className="key-detail_intro">
              <span className="key-detail_icon">
                <IconHash />
              </span>
              <div>
                <span className="monitor_eyebrow">
                  {selected.children.size ? 'Branch overview' : 'Key overview'}
                </span>
                <h2>{selected.name}</h2>
                <code>{selected.path}</code>
              </div>
            </div>
            <div className="key-detail_metrics">
              <div>
                <span>Messages observed</span>
                <strong>{selected.count.toLocaleString()}</strong>
              </div>
              <div>
                <span>Traffic observed</span>
                <strong>{formatBytes(selected.bytes)}</strong>
              </div>
              <div>
                <span>Last observed</span>
                <strong>{formatAge(selected.lastSeen)} ago</strong>
              </div>
            </div>
            <div className="investigation-actions">
              <Button
                variant="default"
                size="default"
                className="button"
                type="button"
                onClick={() => onFocus(selected.path, selected.children.size > 0)}
              >
                View messages <span aria-hidden="true">↗</span>
              </Button>
              {selected.entry && (
                <Button
                  variant="outline"
                  size="default"
                  className="button button--ghost"
                  type="button"
                  disabled={!connected || busy}
                  onClick={() => void watch(selected.path)}
                >
                  Watch key
                </Button>
              )}
              {selected.children.size > 0 && (
                <Button
                  variant="outline"
                  size="default"
                  className="button button--ghost"
                  type="button"
                  disabled={!connected || busy}
                  onClick={() => void watch(`${selected.path}/**`)}
                >
                  Watch branch
                </Button>
              )}
              {selected.entry && (
                <Button
                  variant="outline"
                  size="default"
                  className="button button--ghost"
                  type="button"
                  disabled={!connected}
                  onClick={() => onPublishKey(selected.path)}
                >
                  Publish here
                </Button>
              )}
            </div>
            {actionError && (
              <div className="notice notice--error" role="alert">
                {actionError}
              </div>
            )}
            <div className="key-detail_recent">
              <div className="key-space_heading">
                <h3>Recent messages</h3>
                <span>From the retained buffer</span>
              </div>
              {recent.length ? (
                recent.map((message) => (
                  <BaseButton
                    className="key-sample"
                    key={message.id}
                    type="button"
                    onClick={() => onSelectMessage(message)}
                  >
                    <span className={`sample-kind sample-kind--${message.kind ?? 'unknown'}`}>
                      {message.kind ?? 'sample'}
                    </span>
                    <div>
                      <strong>{message.key}</strong>
                      <code>
                        {message.kind === 'delete'
                          ? 'Key deleted'
                          : message.previewText || message.text || 'Select to inspect payload'}
                      </code>
                    </div>
                    <time>{formatTime(message.ts)}</time>
                    <span aria-hidden="true">↗</span>
                  </BaseButton>
                ))
              ) : (
                <div className="investigation-empty">
                  <strong>No retained messages</strong>
                  <p>This key was observed earlier. Its samples may have aged out of the buffer.</p>
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="investigation-empty key-space_welcome">
            <span className="key-detail_icon">
              <IconHash />
            </span>
            <h2>Select an observed key</h2>
            <p>Inspect its traffic, focus the stream, or watch a branch.</p>
          </div>
        )}
      </div>
    </section>
  );
};

export default KeyExplorer;
