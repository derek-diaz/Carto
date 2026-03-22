export type ToastType = 'info' | 'ok' | 'warn' | 'error';

export type ToastInput = {
  type: ToastType;
  message: string;
  detail?: string;
  durationMs?: number;
};

export type Toast = ToastInput & {
  id: string;
  ts: number;
};

export type LogLevel = 'info' | 'warn' | 'error';

export type LogInput = {
  level: LogLevel;
  source: string;
  message: string;
  detail?: string;
};

export type LogEntry = LogInput & {
  id: string;
  ts: number;
};
