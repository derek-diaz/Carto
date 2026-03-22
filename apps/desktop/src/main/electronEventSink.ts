import type { WebContents } from 'electron';
import type { CartoMessageBatchEvent, ConnectionStatus } from '../../../../packages/core/src/shared/types';
import type { CartoEventSink } from '../../../../packages/core/src/backend/eventSink';

const DISPOSED_FRAME_RE = /render frame was disposed|object has been destroyed/i;

const canSendToRenderer = (contents: WebContents): boolean => {
  try {
    if (contents.isDestroyed() || contents.isCrashed()) return false;
    const frame = contents.mainFrame;
    return Boolean(frame) && !frame.isDestroyed();
  } catch {
    return false;
  }
};

const send = (contents: WebContents, channel: string, payload: unknown): void => {
  if (!canSendToRenderer(contents)) return;
  try {
    contents.send(channel, payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (DISPOSED_FRAME_RE.test(message)) {
      return;
    }
    console.error(`[carto] failed to send ${channel}: ${message}`);
  }
};

export const createElectronEventSink = (contents: WebContents): CartoEventSink => ({
  sendMessage: (payload: CartoMessageBatchEvent) => {
    send(contents, 'carto.message', payload);
  },
  sendStatus: (status: ConnectionStatus) => {
    send(contents, 'carto.status', status);
  }
});
