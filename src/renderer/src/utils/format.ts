export const formatBytes = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(value >= 10 ? 1 : 2)} ${units[unitIndex]}`;
};

export const formatTime = (ts: number): string => {
  const date = new Date(ts);
  return new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    fractionalSecondDigits: 3
  }).format(date);
};

export const formatAge = (ts: number): string => {
  const delta = Math.max(0, Date.now() - ts);
  if (delta < 1000) return `${delta} ms`;
  if (delta < 60_000) return `${Math.round(delta / 1000)} s`;
  if (delta < 3_600_000) return `${Math.round(delta / 60_000)} m`;
  return `${Math.round(delta / 3_600_000)} h`;
};
