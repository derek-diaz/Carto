import { useEffect, useId, useState } from 'react';
import { useForm } from '@tanstack/react-form';
import { RefreshCw, SlidersHorizontal, Square } from 'lucide-react';
import type { DiscoveryParams, DiscoverySnapshot } from '@shared/types';
import { getKeyexprError } from '@shared/keyexpr';
import { Button } from './ui/button';
import { Input } from './ui/input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter
} from './ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';

const durations = [15, 30, 60].map((value) => ({ value, label: `${value} seconds` }));
type Props = {
  connected: boolean;
  active: boolean;
  busy: boolean;
  snapshot: DiscoverySnapshot | null;
  onStart: (params: DiscoveryParams) => Promise<void>;
  onStop: () => Promise<void>;
};
export const DiscoveryControls = ({
  connected,
  active,
  busy,
  snapshot,
  onStart,
  onStop
}: Props) => {
  const [open, setOpen] = useState(false);
  const scopeId = useId();
  const durationId = useId();
  const form = useForm({
    defaultValues: {
      keyexpr: snapshot?.keyexpr ?? '**',
      durationSeconds: snapshot?.durationSeconds ?? 15
    },
    onSubmit: async ({ value }) => {
      if (!connected || active) return;
      await onStart({ ...value, keyexpr: value.keyexpr.trim() });
      setOpen(false);
    }
  });
  useEffect(() => {
    if (snapshot?.startedAt)
      form.reset({ keyexpr: snapshot.keyexpr, durationSeconds: snapshot.durationSeconds });
  }, [snapshot?.startedAt, snapshot?.keyexpr, snapshot?.durationSeconds, form]);

  return (
    <div className="flex items-center gap-1">
      {active ? (
        <Button
          size="sm"
          variant="outline"
          disabled={busy || snapshot?.state === 'stopping'}
          onClick={() => void onStop()}
        >
          <Square /> Stop scan
        </Button>
      ) : (
        <Button
          size="sm"
          variant="outline"
          disabled={!connected || busy}
          onClick={() =>
            void onStart({
              keyexpr: snapshot?.keyexpr ?? '**',
              durationSeconds: snapshot?.durationSeconds ?? 15
            })
          }
        >
          <RefreshCw /> {busy ? 'Starting…' : snapshot?.startedAt ? 'Scan again' : 'Scan for keys'}
        </Button>
      )}
      <Button
        size="icon-sm"
        variant="ghost"
        aria-label="Scan options"
        title="Scan options"
        disabled={!connected || active || busy}
        onClick={() => setOpen(true)}
      >
        <SlidersHorizontal />
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Scan for specific traffic</DialogTitle>
            <DialogDescription>
              Narrow the scope or listen longer for less frequent messages.
            </DialogDescription>
          </DialogHeader>
          <form
            className="space-y-5"
            onSubmit={(event) => {
              event.preventDefault();
              void form.handleSubmit();
            }}
          >
            <form.Field
              name="keyexpr"
              validators={{
                onChange: ({ value }) => getKeyexprError(value) ?? undefined,
                onSubmit: ({ value }) => getKeyexprError(value) ?? undefined
              }}
            >
              {(field) => (
                <div className="space-y-2">
                  <label htmlFor={scopeId} className="text-sm font-medium">
                    Key expression
                  </label>
                  <Input
                    id={scopeId}
                    className="font-mono"
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(event) => field.handleChange(event.target.value)}
                    disabled={active || busy}
                    spellCheck={false}
                    aria-invalid={field.state.meta.errors.length > 0}
                    aria-describedby={`${scopeId}-help`}
                  />
                  <p
                    id={`${scopeId}-help`}
                    className={
                      field.state.meta.errors.length
                        ? 'text-xs text-destructive'
                        : 'text-xs text-muted-foreground'
                    }
                  >
                    {field.state.meta.errors.length
                      ? field.state.meta.errors.join(' ')
                      : 'Use ** for all visible keys, or a scope such as robots/**.'}
                  </p>
                </div>
              )}
            </form.Field>
            <form.Field name="durationSeconds">
              {(field) => (
                <div className="space-y-2">
                  <label id={durationId} className="text-sm font-medium">
                    Scan duration
                  </label>
                  <Select
                    items={durations}
                    value={field.state.value}
                    onValueChange={(value) => value !== null && field.handleChange(value)}
                    disabled={active || busy}
                  >
                    <SelectTrigger className="w-full" aria-labelledby={durationId}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {durations.map((item) => (
                        <SelectItem key={item.value} value={item.value}>
                          {item.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </form.Field>
            <form.Subscribe selector={(state) => [state.canSubmit, state.isSubmitting]}>
              {([canSubmit, submitting]) => (
                <DialogFooter>
                  <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    disabled={!connected || active || busy || !canSubmit || submitting}
                  >
                    {busy || submitting ? 'Starting…' : 'Start scan'}
                  </Button>
                </DialogFooter>
              )}
            </form.Subscribe>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
};
