import type { AddProtoSchemas } from '../utils/proto';
import { useMemo, useState, useId } from 'react';
import { ArrowRight, Hash } from 'lucide-react';
import type { DiscoveredKey } from '@shared/types';
import { formatAge, formatBytes } from '../utils/format';
import { formatJson, highlightJson } from '../utils/jsonSyntax';
import { Button } from './ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs';
import { ProtobufTypePicker } from './ProtobufTypePicker';
import { ProtobufSchemaDialog } from './ProtobufSchemaDialog';
import {
  decodeDiscoveryPreview,
  type DecoderConfig,
  type ProtoTypeOption,
  type ProtobufDecoder
} from '../utils/proto';

type Props = {
  entry: DiscoveredKey;
  elapsed: number;
  active: boolean;
  now: number;
  disabled: boolean;
  onWatch: (decoder?: DecoderConfig) => void;
  protoTypes: ProtoTypeOption[];
  decodeProtobuf?: ProtobufDecoder;
  onAddProtoSchema: AddProtoSchemas;
};

export function DiscoveredKeyPreview({
  entry,
  elapsed,
  active,
  now,
  disabled,
  onWatch,
  protoTypes,
  decodeProtobuf,
  onAddProtoSchema
}: Props) {
  const decoderId = useId();
  const [typeId, setTypeId] = useState('raw');
  const [showRaw, setShowRaw] = useState(false);
  const [tryProtobuf, setTryProtobuf] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const selectedType = protoTypes.find((type) => type.id === typeId);
  const decoder: DecoderConfig | undefined = selectedType
    ? { kind: 'protobuf', typeId: selectedType.id }
    : undefined;
  const result = useMemo(
    () =>
      selectedType && decodeProtobuf
        ? decodeDiscoveryPreview(
            entry,
            { kind: 'protobuf', typeId: selectedType.id },
            decodeProtobuf
          )
        : null,
    [entry, selectedType, decodeProtobuf]
  );
  const canTry = entry.kind !== 'delete' && Boolean(decodeProtobuf);
  const showDecoder =
    canTry &&
    (tryProtobuf ||
      /protobuf|octet-stream/i.test(entry.wireEncoding ?? '') ||
      entry.preview.startsWith('Base64 · '));
  const preview = useMemo(() => {
    if (!entry.previewTruncated) {
      try {
        return highlightJson(formatJson(JSON.parse(entry.preview)));
      } catch {
        /* Preserve non-JSON previews. */
      }
    }
    return entry.preview;
  }, [entry.preview, entry.previewTruncated]);
  return (
    <article className="min-w-0 space-y-6" aria-label="Selected key preview">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Hash className="size-4" />
            <span>Key preview</span>
            <span className="rounded-md border px-1.5 py-0.5 text-[10px]">
              {active ? (now - entry.lastSeen < 5000 ? 'Active' : 'Quiet') : 'From scan'}
            </span>
          </div>
          <h3 className="break-all font-mono text-lg font-medium tracking-tight">{entry.key}</h3>
        </div>
        <Button disabled={disabled} onClick={() => onWatch(decoder ?? { kind: 'raw' })}>
          {decoder ? 'Watch with decoder' : 'Watch key'} <ArrowRight />
        </Button>
      </header>
      <dl className="grid grid-cols-3 gap-4 border-y py-4 text-sm">
        <div>
          <dt className="text-xs text-muted-foreground">Samples</dt>
          <dd className="mt-1 font-medium tabular-nums">{entry.count.toLocaleString()}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Average rate</dt>
          <dd className="mt-1 font-medium tabular-nums">
            {(entry.count / Math.max(1, elapsed)).toFixed(1)}{' '}
            <span className="text-xs font-normal text-muted-foreground">msg/s</span>
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Last seen</dt>
          <dd className="mt-1 font-medium tabular-nums">{formatAge(entry.lastSeen)} ago</dd>
        </div>
      </dl>
      <section
        className="overflow-hidden rounded-xl border bg-background"
        aria-label="Latest payload"
      >
        <Tabs
          value={selectedType && !showRaw ? 'decoded' : 'raw'}
          onValueChange={(value) => setShowRaw(value === 'raw')}
          className="gap-0"
        >
          <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-muted/30 px-4 py-3">
            <h4 className="text-xs font-medium">Latest payload</h4>
            <span className="break-all text-xs text-muted-foreground">
              {entry.wireEncoding || entry.kind || 'Sample'} · {formatBytes(entry.lastSize)}
            </span>
          </div>
          {showDecoder ? (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b bg-muted/15 px-3 py-2">
              <div className="min-w-0 flex-1 basis-56 sm:max-w-md">
                <label id={decoderId} className="sr-only">
                  Payload message type
                </label>
                <ProtobufTypePicker
                  types={protoTypes}
                  labelledBy={decoderId}
                  value={selectedType?.id ?? 'raw'}
                  onAddSchemas={() => setAddOpen(true)}
                  onValueChange={(value) => {
                    if (value !== null) {
                      setTypeId(value);
                      setShowRaw(false);
                    }
                  }}
                />
              </div>
              <TabsList
                aria-label="Payload format"
                className="ml-auto shrink-0 rounded-md border bg-background"
              >
                <TabsTrigger
                  value="decoded"
                  disabled={!selectedType}
                  className="rounded-sm px-3 text-xs"
                >
                  Decoded
                </TabsTrigger>
                <TabsTrigger value="raw" className="rounded-sm px-3 text-xs">
                  Raw
                </TabsTrigger>
              </TabsList>
            </div>
          ) : (
            canTry && (
              <div className="border-b px-4 py-2">
                <Button variant="ghost" size="sm" onClick={() => setTryProtobuf(true)}>
                  Try Protobuf decoder
                </Button>
              </div>
            )
          )}
          <TabsContent value="decoded">
            {result?.error ? (
              <p role="alert" className="p-5 text-sm text-destructive">
                {result.error}
              </p>
            ) : (
              <>
                {result?.exact === false && (
                  <p className="border-b bg-muted/30 px-4 py-2 text-xs text-muted-foreground">
                    Possible type mismatch: the decoded fields do not reproduce the original bytes.
                  </p>
                )}
                <pre className="m-0 max-h-[420px] overflow-auto p-5 font-mono text-xs leading-7 whitespace-pre-wrap break-all text-foreground">
                  {result?.data !== undefined
                    ? highlightJson(formatJson(result.data))
                    : preview || '(empty payload)'}
                </pre>
              </>
            )}
          </TabsContent>
          <TabsContent value="raw">
            <pre className="m-0 max-h-[420px] overflow-auto p-5 font-mono text-xs leading-7 whitespace-pre-wrap break-all text-foreground">
              {preview || '(empty payload)'}
            </pre>
          </TabsContent>
        </Tabs>
      </section>
      <p className="text-xs leading-relaxed text-muted-foreground">
        {entry.previewTruncated
          ? 'Preview limited to 512 bytes. Watch this key to inspect full incoming payloads.'
          : 'Captured during discovery. Watch this key to follow incoming messages.'}
      </p>
      <ProtobufSchemaDialog open={addOpen} onOpenChange={setAddOpen} onAdd={onAddProtoSchema} />
    </article>
  );
}
