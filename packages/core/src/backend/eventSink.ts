import type { CartoMessageBatchEvent, ConnectionStatus } from '../shared/types';

export type CartoEventSink = {
  sendMessage: (payload: CartoMessageBatchEvent) => void;
  sendStatus: (status: ConnectionStatus) => void;
};
