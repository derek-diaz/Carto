import type { ReactNode } from 'react';
import { Collapsible } from '@base-ui/react/collapsible';
import { ChevronDown, Settings2 } from 'lucide-react';

export function DisclosureSection({
  title,
  description,
  children
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <Collapsible.Root className="rounded-xl border bg-card">
      <Collapsible.Trigger className="group flex w-full items-center gap-3 rounded-xl p-4 text-left outline-none transition-colors hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring">
        <Settings2 className="size-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium">{title}</span>
          <span className="mt-1 block text-xs text-muted-foreground">{description}</span>
        </span>
        <ChevronDown className="size-4 shrink-0 text-muted-foreground transition-transform group-data-open:rotate-180" />
      </Collapsible.Trigger>
      <Collapsible.Panel className="border-t p-4 sm:p-5">{children}</Collapsible.Panel>
    </Collapsible.Root>
  );
}
