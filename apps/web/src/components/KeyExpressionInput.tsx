import { useId } from 'react';
import { Combobox } from '@base-ui/react/combobox';
import { ChevronDown, Hash, History } from 'lucide-react';

type Props = {
  value: string;
  history: string[];
  disabled?: boolean;
  onChange: (value: string) => void;
  onSelect: (value: string) => void;
};

export function KeyExpressionInput({ value, history, disabled, onChange, onSelect }: Props) {
  const id = useId();
  return (
    <div className="space-y-2">
      <label htmlFor={id} className="text-xs font-medium text-muted-foreground">
        Target key expression
      </label>
      <Combobox.Root
        items={history}
        value={history.includes(value) ? value : null}
        inputValue={value}
        onInputValueChange={(next, details) => {
          if (details.reason === 'input-change' || details.reason === 'input-clear') onChange(next);
        }}
        onValueChange={(next) => {
          if (next) onSelect(next);
        }}
        disabled={disabled}
      >
        <div className="flex h-11 items-center gap-2 rounded-lg border bg-background px-3 focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/20">
          <Hash className="size-4 shrink-0 text-muted-foreground" />
          <Combobox.Input
            id={id}
            placeholder="demo/publish"
            className="h-full min-w-0 flex-1 bg-transparent font-mono text-sm outline-none"
          />
          <Combobox.Trigger
            aria-label="Show recent publish targets"
            className="flex size-7 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ChevronDown className="size-4" />
          </Combobox.Trigger>
        </div>
        <Combobox.Portal>
          <Combobox.Positioner sideOffset={6} align="start" className="z-50">
            <Combobox.Popup className="w-(--anchor-width) max-w-(--available-width) overflow-hidden rounded-xl border bg-popover text-popover-foreground shadow-xl">
              <div className="px-3 py-2 text-xs text-muted-foreground">Recent targets</div>
              <Combobox.Empty className="px-3 pb-3 text-xs text-muted-foreground empty:hidden">
                No matching history. You can use a new key.
              </Combobox.Empty>
              <Combobox.List className="max-h-64 overflow-y-auto p-1 empty:p-0">
                {(entry: string) => (
                  <Combobox.Item
                    key={entry}
                    value={entry}
                    className="flex cursor-default items-center gap-2 rounded-md px-3 py-2 font-mono text-xs outline-none data-highlighted:bg-muted data-selected:text-primary"
                  >
                    <History className="size-3.5 shrink-0 text-muted-foreground" />
                    <span className="truncate">{entry}</span>
                  </Combobox.Item>
                )}
              </Combobox.List>
            </Combobox.Popup>
          </Combobox.Positioner>
        </Combobox.Portal>
      </Combobox.Root>
    </div>
  );
}
