import { useMemo, useState } from 'react';
import { Combobox } from '@base-ui/react/combobox';
import { Braces, Check, ChevronDown, FileCode2, Plus, Search } from 'lucide-react';
import { Button } from './ui/button';
import type { ProtoTypeOption } from '../utils/proto';

type DecoderOption = { value: string; label: string; description: string };
type Props = {
  types: ProtoTypeOption[];
  value: string;
  onValueChange: (value: string) => void;
  labelledBy: string;
  onAddSchemas: () => void;
};

export function ProtobufTypePicker({
  types,
  value,
  onValueChange,
  labelledBy,
  onAddSchemas
}: Props) {
  const [open, setOpen] = useState(false);
  const items = useMemo<DecoderOption[]>(
    () => [
      { value: 'raw', label: 'Raw payload', description: 'View original bytes without decoding' },
      ...types.map((type) => ({
        value: type.id,
        label: type.fullName,
        description: type.schemaName
      }))
    ],
    [types]
  );
  const selected = items.find((item) => item.value === value) ?? items[0];
  return (
    <Combobox.Root
      open={open}
      onOpenChange={setOpen}
      items={items}
      value={selected}
      onValueChange={(item) => {
        if (item) onValueChange(item.value);
      }}
      isItemEqualToValue={(item, current) => item.value === current.value}
      itemToStringLabel={(item) => item.label}
      filter={(item, query) =>
        `${item.label} ${item.description}`.toLowerCase().includes(query.toLowerCase())
      }
      autoHighlight
    >
      <Combobox.Trigger
        aria-labelledby={labelledBy}
        title={
          selected.value === 'raw' ? selected.label : `${selected.label} · ${selected.description}`
        }
        className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-sm outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
      >
        {selected.value === 'raw' ? (
          <Braces className="size-4 shrink-0 text-muted-foreground" />
        ) : (
          <FileCode2 className="size-4 shrink-0 text-primary" />
        )}
        <span className="min-w-0 flex-1 truncate text-left">{selected.label}</span>
        <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
      </Combobox.Trigger>
      <Combobox.Portal>
        <Combobox.Positioner side="bottom" align="start" sideOffset={8} className="z-50">
          <Combobox.Popup className="flex max-h-(--available-height) w-[min(420px,var(--available-width))] flex-col overflow-hidden rounded-xl border bg-popover text-popover-foreground shadow-xl outline-none">
            <div className="flex shrink-0 items-center gap-2 border-b px-3">
              <Search className="size-4 shrink-0 text-muted-foreground" />
              <Combobox.Input
                aria-label="Search message types"
                placeholder="Search message types…"
                className="h-11 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
              />
            </div>
            <Combobox.Empty className="px-4 py-6 text-center text-sm text-muted-foreground empty:hidden">
              No matching message types.
            </Combobox.Empty>
            <Combobox.List className="max-h-72 min-h-0 overflow-y-auto overscroll-contain p-1.5 empty:p-0">
              {(item: DecoderOption) => (
                <Combobox.Item
                  key={item.value}
                  value={item}
                  className="flex cursor-default items-center gap-3 rounded-lg px-3 py-2.5 outline-none select-none data-highlighted:bg-muted data-selected:bg-primary/5"
                >
                  {item.value === 'raw' ? (
                    <Braces className="size-4 shrink-0 text-muted-foreground" />
                  ) : (
                    <FileCode2 className="size-4 shrink-0 text-muted-foreground" />
                  )}
                  <div className="min-w-0 flex-1" title={`${item.label} · ${item.description}`}>
                    <div
                      className={
                        item.value === 'raw'
                          ? 'truncate text-sm font-medium'
                          : 'truncate font-mono text-xs font-medium'
                      }
                    >
                      {item.label}
                    </div>
                    <div className="mt-1 truncate text-xs text-muted-foreground">
                      {item.description}
                    </div>
                  </div>
                  <Combobox.ItemIndicator className="text-primary">
                    <Check className="size-4" />
                  </Combobox.ItemIndicator>
                </Combobox.Item>
              )}
            </Combobox.List>
            <div className="shrink-0 border-t p-1.5">
              <Button
                variant="ghost"
                className="w-full justify-start rounded-lg px-3"
                onClick={() => {
                  setOpen(false);
                  onAddSchemas();
                }}
              >
                <Plus /> Add schema files…
              </Button>
            </div>
          </Combobox.Popup>
        </Combobox.Positioner>
      </Combobox.Portal>
    </Combobox.Root>
  );
}
