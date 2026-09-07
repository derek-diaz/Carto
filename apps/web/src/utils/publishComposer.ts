import type { PublishEncoding } from '@shared/types';
import { getKeyexprError } from '../../../../packages/core/src/shared/keyexpr';
export type PublishDraft = {
  keyexpr: string;
  encoding: PublishEncoding | 'protobuf';
  payload: string;
  protoTypeId?: string;
  wireEncoding?: string;
  publishedAt?: number;
};
export const DEFAULT_PUBLISH_KEYEXPR = 'demo/publish';
export const DEFAULT_PUBLISH_JSON = '{\n  "message": "hello from Carto"\n}';
export const publishFormats = ['json', 'text', 'base64', 'protobuf'] as const;
export const formatLabel = { json: 'JSON', text: 'Text', base64: 'Base64', protobuf: 'Protobuf' };
export const defaultWireEncoding = {
  json: 'application/json',
  text: 'text/plain',
  base64: 'application/octet-stream',
  protobuf: 'application/protobuf'
};
export function validatePublishDraft(
  draft: PublishDraft,
  typeIds: string[],
  validateProto?: (typeId: string, payload: string) => string | null
) {
  const keyError = getKeyexprError(draft.keyexpr);
  let payloadError: string | null = null;
  if (draft.encoding === 'json' || draft.encoding === 'protobuf') {
    try {
      JSON.parse(draft.payload);
    } catch (error) {
      payloadError = error instanceof Error ? error.message : 'Invalid JSON';
    }
  } else if (draft.encoding === 'base64') {
    const text = draft.payload.replace(/\s/g, '');
    if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(text))
      payloadError = 'Enter valid Base64 with complete groups and padding.';
  }
  if (draft.encoding === 'protobuf') {
    if (!draft.protoTypeId || !typeIds.includes(draft.protoTypeId))
      payloadError = 'Choose an available message type, or add its .proto schema.';
    else if (!payloadError && validateProto)
      payloadError = validateProto(draft.protoTypeId, draft.payload);
  }
  return { keyError, payloadError, valid: !keyError && !payloadError };
}
export const clampEditorHeight = (height: number) =>
  Math.min(1200, Math.max(160, Number.isFinite(height) ? height : 280));
