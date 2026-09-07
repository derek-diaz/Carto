import type { ReactNode } from 'react';
import { Toast } from '@base-ui/react/toast';
import { CircleCheck, CircleAlert, Info, X } from 'lucide-react';
import { Button } from './button';

export const notificationManager = Toast.createToastManager();
function NotificationViewport() {
  const { toasts } = Toast.useToastManager();
  return (
    <Toast.Portal>
      <Toast.Viewport className="fixed right-4 bottom-4 z-[150] flex w-85 max-w-[calc(100vw-2rem)] flex-col gap-2 outline-none">
        {toasts.map((toast) => (
          <Toast.Root
            key={toast.id}
            toast={toast}
            className="relative flex gap-3 rounded-2xl border border-border bg-popover p-4 text-popover-foreground shadow-lg transition-opacity data-starting:opacity-0 data-ending:opacity-0 data-limited:hidden"
          >
            {toast.type === 'error' ? (
              <CircleAlert className="size-4 shrink-0 text-destructive" />
            ) : toast.type === 'ok' ? (
              <CircleCheck className="size-4 shrink-0 text-primary" />
            ) : (
              <Info className="size-4 shrink-0 text-muted-foreground" />
            )}
            <Toast.Content className="min-w-0 flex-1">
              <Toast.Title className="text-sm font-medium" />
              <Toast.Description className="mt-1 text-xs leading-relaxed text-muted-foreground" />
            </Toast.Content>
            <Toast.Close
              render={<Button variant="ghost" size="icon-xs" />}
              aria-label="Dismiss notification"
            >
              <X />
            </Toast.Close>
          </Toast.Root>
        ))}
      </Toast.Viewport>
    </Toast.Portal>
  );
}
export const NotificationProvider = ({ children }: { children: ReactNode }) => (
  <Toast.Provider toastManager={notificationManager} limit={4}>
    {children}
    <NotificationViewport />
  </Toast.Provider>
);
