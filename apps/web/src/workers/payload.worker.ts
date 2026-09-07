import { comparePayloads } from '../utils/messageDiff';

export type PayloadTask =
  { kind: 'format'; value: unknown } | { kind: 'diff'; before: unknown; after: unknown };

// Formatting and comparisons never compete with the live stream on the UI thread.
self.onmessage = (event: MessageEvent<PayloadTask>) => {
  try {
    const task = event.data;
    const result =
      task.kind === 'format'
        ? JSON.stringify(task.value, null, 2)
        : comparePayloads(task.before, task.after);
    self.postMessage({ result });
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : String(error) });
  }
};
