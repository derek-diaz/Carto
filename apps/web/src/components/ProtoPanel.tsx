import { useState } from 'react';
import { FileCode2, Plus, Trash2 } from 'lucide-react';
import { Button } from './ui/button';
import { ProtobufSchemaDialog } from './ProtobufSchemaDialog';
import type { AddProtoSchemas, ProtoSchema } from '../utils/proto';
import type { LogInput, ToastInput } from '../utils/notifications';

type ProtoPanelProps = {
  schemas: ProtoSchema[];
  onAddSchema: AddProtoSchemas;
  onRemoveSchema: (id: string) => void;
  onLog: (entry: LogInput) => void;
  onToast: (toast: ToastInput) => void;
  className?: string;
  showCountBadge?: boolean;
};

export default function ProtoPanel({
  schemas,
  onAddSchema,
  onRemoveSchema,
  className,
  showCountBadge = true
}: ProtoPanelProps) {
  const [open, setOpen] = useState(false);
  return (
    <section className={`panel ${className ?? ''}`.trim()}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">
            Protobuf schemas{' '}
            {showCountBadge && (
              <span className="ml-2 text-sm font-normal text-muted-foreground">
                {schemas.length}
              </span>
            )}
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Shared definitions are available to every payload schema.
          </p>
        </div>
        <Button onClick={() => setOpen(true)}>
          <Plus /> Add schemas
        </Button>
      </div>
      <div className="mt-5 space-y-3">
        {schemas.length === 0 ? (
          <p className="rounded-xl border border-dashed p-6 text-sm text-muted-foreground">
            Add your common definitions and payload files together to start decoding.
          </p>
        ) : (
          schemas.map((schema) => (
            <div key={schema.id} className="rounded-xl border bg-card p-4">
              <div className="flex items-start gap-3">
                <FileCode2 className="mt-1 size-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <h3 className="break-all text-sm font-medium">{schema.name}</h3>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {schema.types.length} message types
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Remove ${schema.name}`}
                  onClick={() => onRemoveSchema(schema.id)}
                >
                  <Trash2 />
                </Button>
              </div>
              {schema.types.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {schema.types.slice(0, 12).map((type) => (
                    <code
                      key={type.id}
                      className="max-w-full break-all rounded-md bg-muted px-2 py-1 text-xs"
                    >
                      {type.name}
                    </code>
                  ))}
                  {schema.types.length > 12 && (
                    <span className="text-xs text-muted-foreground">
                      +{schema.types.length - 12} more
                    </span>
                  )}
                </div>
              )}
            </div>
          ))
        )}
      </div>
      <ProtobufSchemaDialog open={open} onOpenChange={setOpen} onAdd={onAddSchema} />
    </section>
  );
}
