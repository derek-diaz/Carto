import { useEffect, useRef } from 'react';
import { Menu } from '@base-ui/react/menu';
import { ChevronDown, Plus, X } from 'lucide-react';
import type { Subscription } from '../store/useCarto';
import { Tabs, TabsList, TabsTrigger } from './ui/tabs';
import { Button } from './ui/button';

type Props = {
  subscriptions: Subscription[];
  selectedId: string | null;
  connected: boolean;
  onSelect: (id: string) => void;
  onClose: (id: string) => Promise<void>;
  onAdd: () => void;
};

export function SubscriptionTabs({
  subscriptions,
  selectedId,
  connected,
  onSelect,
  onClose,
  onAdd
}: Props) {
  const listRef = useRef<HTMLDivElement>(null);
  const closeTab = async (id: string) => {
    const hadFocus = listRef.current?.contains(document.activeElement);
    try {
      await onClose(id);
      if (hadFocus)
        requestAnimationFrame(() => {
          listRef.current?.querySelector<HTMLElement>('[data-active]')?.focus();
        });
    } catch {
      /* The subscription handler reports failures and keeps the tab open. */
    }
  };
  useEffect(() => {
    listRef.current
      ?.querySelector('[data-active]')
      ?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [selectedId, subscriptions.length]);

  return (
    <div className="subscription-bar">
      <Tabs
        value={selectedId}
        onValueChange={(value) => onSelect(String(value))}
        className="subscription-tabs"
      >
        <TabsList
          ref={listRef}
          aria-label="Subscriptions"
          variant="line"
          className="subscription-tablist group-data-horizontal/tabs:h-[38px]"
        >
          {subscriptions.map((sub) => (
            <div className="subscription-tab" data-selected={sub.id === selectedId} key={sub.id}>
              <TabsTrigger
                value={sub.id}
                className="subscription-tab-trigger h-full rounded-none"
                title={sub.keyexpr}
                onClick={() => onSelect(sub.id)}
              >
                <span className="subscription-tab-label">{sub.keyexpr}</span>
                {sub.paused && (
                  <span className="subscription-tab-paused" aria-label="Display paused">
                    Ⅱ
                  </span>
                )}
              </TabsTrigger>
              <Button
                variant="ghost"
                size="icon-sm"
                className="subscription-tab-close"
                aria-label={`Close ${sub.keyexpr}`}
                onClick={() => void closeTab(sub.id)}
              >
                <X className="size-3.5" />
              </Button>
            </div>
          ))}
        </TabsList>
      </Tabs>
      <Button
        variant="ghost"
        size="icon-sm"
        className="rounded-sm shrink-0"
        aria-label="Add subscription"
        title="Add subscription"
        disabled={!connected}
        onClick={onAdd}
      >
        <Plus className="size-4" />
      </Button>
      {subscriptions.length > 1 && (
        <Menu.Root>
          <Menu.Trigger
            render={
              <Button
                variant="ghost"
                size="icon-sm"
                className="rounded-sm shrink-0"
                aria-label="Open subscriptions"
                title="Open subscriptions"
              />
            }
          >
            <ChevronDown className="size-4" />
          </Menu.Trigger>
          <Menu.Portal>
            <Menu.Positioner sideOffset={4} align="end" className="z-50">
              <Menu.Popup className="monitor-menu" aria-label="Open subscriptions">
                {subscriptions.map((sub) => (
                  <Menu.Item
                    key={sub.id}
                    className="monitor-menu-item"
                    onClick={() => onSelect(sub.id)}
                  >
                    <span className="w-3 shrink-0">{sub.id === selectedId ? '✓' : ''}</span>
                    <code>{sub.keyexpr}</code>
                  </Menu.Item>
                ))}
              </Menu.Popup>
            </Menu.Positioner>
          </Menu.Portal>
        </Menu.Root>
      )}
    </div>
  );
}
