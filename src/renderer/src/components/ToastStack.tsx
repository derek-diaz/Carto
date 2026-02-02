import type { Toast } from '../utils/notifications';

type ToastStackProps = {
  toasts: Toast[];
  onDismiss: (id: string) => void;
};

const ToastStack = ({ toasts, onDismiss }: ToastStackProps) => (
  <div className="toast_stack" aria-live="polite" aria-atomic="true">
    {toasts.map((toast) => (
      <div
        key={toast.id}
        className={`toast toast--${toast.type}`}
        role={toast.type === 'error' ? 'alert' : 'status'}
      >
        <div className="toast_body">
          <div className="toast_title">{toast.message}</div>
          {toast.detail ? <div className="toast_detail">{toast.detail}</div> : null}
        </div>
        <button
          className="icon-button icon-button--compact icon-button--ghost"
          type="button"
          onClick={() => onDismiss(toast.id)}
          aria-label="Dismiss notification"
          title="Dismiss"
        >
          <span aria-hidden="true">x</span>
        </button>
      </div>
    ))}
  </div>
);

export default ToastStack;
