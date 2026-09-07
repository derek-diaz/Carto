import { useEffect, useState } from 'react';
import type { PayloadTask } from '../workers/payload.worker';

export function usePayloadWorker<T>(task: PayloadTask | null) {
  const [state, setState] = useState<{ task: PayloadTask; result?: T; error?: string } | null>(
    null
  );
  useEffect(() => {
    if (!task) {
      setState(null);
      return;
    }
    let worker: Worker | undefined;
    try {
      worker = new Worker(new URL('../workers/payload.worker.ts', import.meta.url), {
        type: 'module'
      });
      worker.onmessage = (event: MessageEvent<{ result?: T; error?: string }>) => {
        setState({ task, ...event.data });
        worker?.terminate();
      };
      worker.onerror = () => {
        setState({
          task,
          error:
            'Payload processing could not finish. Switch views or reselect the message to retry.'
        });
        worker?.terminate();
      };
      worker.postMessage(task);
    } catch (error) {
      setState({ task, error: error instanceof Error ? error.message : String(error) });
    }
    return () => worker?.terminate();
  }, [task]);
  const current = state?.task === task ? state : null;
  return { result: current?.result, error: current?.error, pending: Boolean(task && !current) };
}
