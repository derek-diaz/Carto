import { useMemo, useRef, useState, type ReactNode } from 'react';
import { ToggleGroup } from '@base-ui/react/toggle-group';
import { Toggle } from '@base-ui/react/toggle';
import { Braces, Check, Copy, LoaderCircle, Send, Trash2 } from 'lucide-react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Textarea } from './ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { KeyExpressionInput } from './KeyExpressionInput';
import { ProtobufSchemaDialog } from './ProtobufSchemaDialog';
import type { AddProtoSchemas, ProtoTypeOption } from '../utils/proto';
import type { LogInput, ToastInput } from '../utils/notifications';
import { usePublishHistory } from '../hooks/usePublishHistory';
import { usePublishEditorSize } from '../hooks/usePublishEditorSize';
import {
  defaultWireEncoding,
  formatLabel,
  publishFormats,
  validatePublishDraft,
  type PublishDraft
} from '../utils/publishComposer';
export {
  DEFAULT_PUBLISH_KEYEXPR,
  DEFAULT_PUBLISH_JSON,
  type PublishDraft
} from '../utils/publishComposer';
type PublishPanelProps = {
  connected: boolean;
  publishSupport: 'supported' | 'unknown' | 'unsupported';
  queryableSupport: 'supported' | 'unknown' | 'unsupported';
  draft: PublishDraft;
  onDraftChange: (next: PublishDraft) => void;
  onEncodingChange: (next: PublishDraft) => void;
  validateProtoDraft: (typeId: string, payload: string) => string | null;
  onAddSchema: AddProtoSchemas;
  targetAccessory?: ReactNode;
  onPublish: (
    keyexpr: string,
    payload: string,
    encoding: PublishDraft['encoding'],
    protoTypeId?: string,
    wireEncoding?: string
  ) => Promise<void>;
  onDeclareQueryable: (
    keyexpr: string,
    payload: string,
    encoding: PublishDraft['encoding'],
    protoTypeId?: string
  ) => Promise<void>;
  getProtoSamplePayload: (typeId: string) => string | null;
  onLog: (entry: LogInput) => void;
  onToast: (toast: ToastInput) => void;
  protoTypes: ProtoTypeOption[];
};

const PublishPanel = ({
  connected,
  publishSupport,
  queryableSupport,
  draft,
  onDraftChange,
  onEncodingChange,
  onPublish,
  onDeclareQueryable,
  getProtoSamplePayload,
  validateProtoDraft,
  onAddSchema,
  onLog,
  onToast,
  protoTypes,
  targetAccessory
}: PublishPanelProps) => {
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [schemaOpen, setSchemaOpen] = useState(false);
  const [feedback, setFeedback] = useState<{ error: boolean; message: string } | null>(null);
  const { entries, targets, remember } = usePublishHistory();
  const { ref: editorRef, height: editorHeight } = usePublishEditorSize();
  const validation = useMemo(
    () =>
      validatePublishDraft(
        draft,
        protoTypes.map((type) => type.id),
        validateProtoDraft
      ),
    [draft, protoTypes, validateProtoDraft]
  );
  const canSend = connected && !busy && publishSupport !== 'unsupported' && validation.valid;
  const type = protoTypes.find((entry) => entry.id === draft.protoTypeId);
  const jsonMode = draft.encoding === 'json' || draft.encoding === 'protobuf';
  const send = async (queryable = false) => {
    if (
      busyRef.current ||
      !connected ||
      !validation.valid ||
      (queryable ? queryableSupport : publishSupport) === 'unsupported'
    )
      return;
    busyRef.current = true;
    setBusy(true);
    setFeedback(null);
    const snapshot = { ...draft, keyexpr: draft.keyexpr.trim() };
    try {
      if (queryable)
        await onDeclareQueryable(
          snapshot.keyexpr,
          snapshot.payload,
          snapshot.encoding,
          snapshot.protoTypeId
        );
      else
        await onPublish(
          snapshot.keyexpr,
          snapshot.payload,
          snapshot.encoding,
          snapshot.protoTypeId,
          snapshot.wireEncoding
        );
      if (!queryable) remember(snapshot);
      setFeedback({
        error: false,
        message: `${queryable ? 'Serving' : 'Sent to'} ${snapshot.keyexpr}`
      });
      onLog({
        level: 'info',
        source: queryable ? 'queryable' : 'publish',
        message: `${queryable ? 'Declared queryable' : 'Published to'} ${snapshot.keyexpr}.`
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setFeedback({ error: true, message });
      onLog({
        level: 'error',
        source: queryable ? 'queryable' : 'publish',
        message,
        detail: snapshot.keyexpr
      });
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };
  const switchFormat = (encoding: PublishDraft['encoding']) => {
    if (encoding === draft.encoding) return;
    const firstType = protoTypes[0];
    onEncodingChange({
      keyexpr: draft.keyexpr,
      encoding,
      payload:
        encoding === 'protobuf'
          ? (firstType && getProtoSamplePayload(firstType.id)) || '{}'
          : encoding === 'json'
            ? '{}'
            : '',
      protoTypeId: encoding === 'protobuf' ? firstType?.id : undefined
    });
    setFeedback(null);
  };
  return (
    <section
      className="min-w-0 space-y-3"
      aria-label="Message composer"
      onKeyDown={(event) => {
        if ((event.ctrlKey || event.metaKey) && event.key === 'Enter' && !schemaOpen) {
          event.preventDefault();
          if (!event.repeat && !event.nativeEvent.isComposing && canSend) void send();
        }
      }}
    >
      <KeyExpressionInput
        value={draft.keyexpr}
        history={targets}
        disabled={busy}
        onChange={(keyexpr) => onDraftChange({ ...draft, keyexpr })}
        onSelect={(keyexpr) => onDraftChange({ ...draft, keyexpr })}
      />
      {validation.keyError && (
        <p className="text-xs text-destructive" role="alert">
          {validation.keyError}
        </p>
      )}
      {targetAccessory}
      <div className="overflow-hidden rounded-md border">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-card px-2 py-1.5">
          <ToggleGroup
            value={[draft.encoding]}
            onValueChange={(values) => {
              if (values[0]) switchFormat(values[0] as PublishDraft['encoding']);
            }}
            className="flex gap-0.5"
            aria-label="Payload format"
            disabled={busy}
          >
            {publishFormats.map((format) => (
              <Toggle
                key={format}
                value={format}
                className="rounded-sm border border-transparent px-3 py-1.5 text-xs text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring data-pressed:border-border data-pressed:bg-background data-pressed:text-foreground"
              >
                {formatLabel[format]}
              </Toggle>
            ))}
          </ToggleGroup>
          <div className="flex items-center gap-1">
            {jsonMode && (
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label="Format JSON"
                title="Format JSON"
                disabled={busy || !!validation.payloadError}
                onClick={() =>
                  onDraftChange({
                    ...draft,
                    payload: JSON.stringify(JSON.parse(draft.payload), null, 2)
                  })
                }
              >
                <Braces />
              </Button>
            )}
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label="Copy payload"
              title="Copy payload"
              onClick={() => {
                void navigator.clipboard.writeText(draft.payload).then(
                  () => setFeedback({ error: false, message: 'Payload copied' }),
                  (error) =>
                    onToast({ type: 'error', message: 'Copy failed', detail: String(error) })
                );
              }}
            >
              <Copy />
            </Button>
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label="Clear payload"
              title="Clear payload"
              disabled={busy}
              onClick={() => onDraftChange({ ...draft, payload: '' })}
            >
              <Trash2 />
            </Button>
          </div>
        </div>
        {draft.encoding === 'protobuf' && (
          <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2">
            <span className="text-xs text-muted-foreground">Message type</span>
            <Select
              value={type?.id ?? ''}
              onValueChange={(protoTypeId) =>
                onDraftChange({ ...draft, protoTypeId: protoTypeId ?? undefined })
              }
              disabled={busy || !protoTypes.length}
            >
              <SelectTrigger
                className="h-8 min-w-0 max-w-full flex-1 rounded-sm font-mono text-xs"
                aria-label="Protobuf message type"
              >
                <SelectValue placeholder="Choose a message type">
                  {type ? `${type.fullName} · ${type.schemaName}` : undefined}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {protoTypes.map((entry) => (
                  <SelectItem key={entry.id} value={entry.id}>
                    {entry.fullName} · {entry.schemaName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {type && (
              <Button
                variant="ghost"
                size="sm"
                disabled={busy}
                onClick={() =>
                  onDraftChange({ ...draft, payload: getProtoSamplePayload(type.id) || '{}' })
                }
              >
                Use example
              </Button>
            )}
            <Button variant="outline" size="sm" disabled={busy} onClick={() => setSchemaOpen(true)}>
              Add schemas
            </Button>
          </div>
        )}
        <Textarea
          ref={editorRef}
          style={{ height: editorHeight }}
          wrap="off"
          aria-label="Payload editor"
          aria-invalid={!!validation.payloadError}
          aria-describedby="publish-validation"
          value={draft.payload}
          onChange={(event) => onDraftChange({ ...draft, payload: event.target.value })}
          disabled={busy}
          spellCheck={false}
          className="block min-h-40 max-h-300 w-full resize-y rounded-none border-0 bg-background p-4 font-mono text-[13px] leading-relaxed shadow-none field-sizing-fixed focus-visible:ring-inset"
        />
        <div className="flex items-start justify-between gap-3 border-t bg-card px-3 py-2 text-xs text-muted-foreground">
          <span
            id="publish-validation"
            className={
              validation.payloadError ? 'text-destructive break-words' : 'flex items-center gap-1.5'
            }
          >
            {validation.payloadError || (
              <>
                <Check className="size-3.5" />
                {jsonMode
                  ? `Valid ${formatLabel[draft.encoding]}`
                  : `${formatLabel[draft.encoding]} payload`}
              </>
            )}
          </span>
          <span className="shrink-0 tabular-nums">
            {draft.payload.length.toLocaleString()} characters
          </span>
        </div>
      </div>
      <details className="border-b pb-2 text-xs">
        <summary className="w-fit cursor-pointer py-1 text-muted-foreground hover:text-foreground">
          Options{' '}
          <span className="ml-2">· {draft.wireEncoding?.trim() || 'Automatic encoding'}</span>
        </summary>
        <div className="flex flex-wrap items-end gap-3 py-2">
          <label className="min-w-56 flex-1 space-y-1 text-muted-foreground">
            Wire encoding
            <Input
              className="h-8 rounded-sm font-mono text-xs"
              value={draft.wireEncoding || ''}
              placeholder={defaultWireEncoding[draft.encoding]}
              disabled={busy}
              onChange={(event) => onDraftChange({ ...draft, wireEncoding: event.target.value })}
            />
          </label>
          <Button
            variant="outline"
            size="sm"
            disabled={!connected || busy || !validation.valid || queryableSupport === 'unsupported'}
            onClick={() => void send(true)}
          >
            Serve queryable
          </Button>
        </div>
        <p className="pb-1 text-muted-foreground">
          Wire encoding applies to sent messages. Queryable replies use the selected format.
        </p>
      </details>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="text-xs text-muted-foreground">
          {!connected
            ? 'Connect to send messages.'
            : publishSupport === 'unsupported'
              ? 'Publishing is unavailable on this connection.'
              : 'Resize the editor from its bottom-right corner.'}
        </span>
        <Button
          size="sm"
          disabled={!canSend}
          title="Send message (Ctrl/Cmd+Enter)"
          onClick={() => void send()}
        >
          {busy ? <LoaderCircle className="animate-spin" /> : <Send />} Send message{' '}
          <kbd className="ml-2 text-[10px] opacity-65">
            {navigator.platform.includes('Mac') ? '⌘' : 'Ctrl'}+Enter
          </kbd>
        </Button>
      </div>
      {feedback && (
        <p
          role={feedback.error ? 'alert' : 'status'}
          className={`text-xs break-words whitespace-pre-wrap ${feedback.error ? 'text-destructive' : 'text-muted-foreground'}`}
        >
          {feedback.message}
        </p>
      )}
      <details className="border-t pt-2 text-xs">
        <summary className="w-fit cursor-pointer py-1 text-muted-foreground hover:text-foreground">
          Recent publishes · {entries.length}
        </summary>
        {entries.length === 0 ? (
          <p className="py-2 text-muted-foreground">Sent messages will appear here for reuse.</p>
        ) : (
          <ul className="max-h-64 overflow-auto py-1">
            {entries.map((entry) => (
              <li key={entry.keyexpr}>
                <button
                  type="button"
                  disabled={busy}
                  className="grid w-full gap-1 border-b px-2 py-2 text-left hover:bg-muted focus-visible:outline-ring"
                  onClick={() => {
                    onDraftChange({ ...entry });
                    setFeedback(null);
                  }}
                  title="Restore draft without sending"
                >
                  <span className="flex min-w-0 flex-wrap justify-between gap-2">
                    <span className="truncate font-mono">{entry.keyexpr}</span>
                    <span className="text-muted-foreground">
                      {formatLabel[entry.encoding]} ·{' '}
                      {entry.publishedAt
                        ? new Date(entry.publishedAt).toLocaleTimeString()
                        : 'Saved draft'}
                    </span>
                  </span>
                  <span className="truncate font-mono text-muted-foreground">
                    {entry.payload.slice(0, 120) || '(empty payload)'}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </details>
      <ProtobufSchemaDialog open={schemaOpen} onOpenChange={setSchemaOpen} onAdd={onAddSchema} />
    </section>
  );
};
export default PublishPanel;
