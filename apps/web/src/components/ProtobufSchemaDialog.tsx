import { useRef, useState } from 'react';
import { Collapsible } from '@base-ui/react/collapsible';
import { ChevronDown, FileCode2, Upload, X } from 'lucide-react';
import type { AddProtoSchemas, ProtoSource } from '../utils/proto';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Textarea } from './ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter
} from './ui/dialog';

type Props = { open: boolean; onOpenChange: (open: boolean) => void; onAdd: AddProtoSchemas };
export function ProtobufSchemaDialog({ open, onOpenChange, onAdd }: Props) {
  const [files, setFiles] = useState<ProtoSource[]>([]);
  const [name, setName] = useState('');
  const [source, setSource] = useState('');
  const [error, setError] = useState('');
  const [reading, setReading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const stageFiles = (incoming: ProtoSource[]) => {
    setFiles((current) => [
      ...current.filter((file) => !incoming.some((next) => next.name === file.name)),
      ...incoming
    ]);
    setError('');
  };
  const readFiles = async (list: FileList | null) => {
    if (!list?.length) return;
    const selected = Array.from(list);
    if (selected.some((file) => !file.name.toLowerCase().endsWith('.proto'))) {
      setError('Choose .proto files, including any shared definitions.');
      return;
    }
    setReading(true);
    setError('');
    try {
      const loaded = await Promise.all(
        selected.map(async (file) => ({
          name: file.webkitRelativePath || file.name,
          source: await file.text()
        }))
      );
      if (new Set(loaded.map((file) => file.name)).size !== loaded.length) {
        setError(
          'Two selected files have the same name. Add them separately with distinct file names.'
        );
        return;
      }
      stageFiles(loaded);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setReading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };
  const close = (next: boolean) => {
    if (reading) return;
    if (!next) {
      setFiles([]);
      setName('');
      setSource('');
      setError('');
    }
    onOpenChange(next);
  };
  const pendingPaste = Boolean(name.trim() || source.trim());
  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add Protobuf files</DialogTitle>
          <DialogDescription>
            Load the payload schema and its shared definitions together. Then choose the payload’s
            message type to decode.
          </DialogDescription>
        </DialogHeader>
        <div
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            if (!reading) void readFiles(event.dataTransfer.files);
          }}
          className={`rounded-xl border border-dashed p-5 text-center ${dragging ? 'border-primary bg-primary/5' : 'bg-muted/20'}`}
        >
          <Upload className="mx-auto mb-2 size-5 text-muted-foreground" />
          <p className="text-sm font-medium">Drop your .proto files here</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Select common.proto, payload.proto, and any other dependencies.
          </p>
          <Button
            className="mt-3"
            variant="outline"
            disabled={reading}
            onClick={() => inputRef.current?.click()}
          >
            {reading ? 'Reading files…' : 'Choose files'}
          </Button>
          <input
            ref={inputRef}
            type="file"
            multiple
            accept=".proto"
            className="hidden"
            aria-label="Choose Protobuf files"
            onChange={(event) => void readFiles(event.target.files)}
          />
        </div>
        {files.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-medium">
              {files.length} {files.length === 1 ? 'file' : 'files'} ready to add
            </p>
            <ul className="max-h-44 space-y-1 overflow-auto">
              {files.map((file) => (
                <li key={file.name} className="flex items-center gap-2 rounded-lg border px-3 py-2">
                  <FileCode2 className="size-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate text-sm" title={file.name}>
                    {file.name}
                  </span>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    disabled={reading}
                    aria-label={`Remove ${file.name}`}
                    onClick={() => {
                      setFiles((current) => current.filter((item) => item.name !== file.name));
                      setError('');
                    }}
                  >
                    <X />
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        )}
        <Collapsible.Root>
          <Collapsible.Trigger className="group flex w-full items-center justify-between rounded-md py-1 text-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
            Paste a definition instead{' '}
            <ChevronDown className="size-4 transition-transform group-data-open:rotate-180" />
          </Collapsible.Trigger>
          <Collapsible.Panel className="space-y-3 pt-4">
            <label className="block space-y-2 text-sm">
              <span>File name</span>
              <Input
                value={name}
                disabled={reading}
                placeholder="common.proto"
                onChange={(event) => setName(event.target.value)}
              />
            </label>
            <label className="block space-y-2 text-sm">
              <span>Protobuf definition</span>
              <Textarea
                value={source}
                disabled={reading}
                className="min-h-32 font-mono text-xs"
                placeholder={
                  'syntax = "proto3";\npackage common;\n\nmessage Header { string id = 1; }'
                }
                onChange={(event) => setSource(event.target.value)}
              />
            </label>
            <Button
              variant="outline"
              size="sm"
              disabled={reading || !name.trim() || !source.trim()}
              onClick={() => {
                stageFiles([{ name: name.trim(), source: source.trim() }]);
                setName('');
                setSource('');
              }}
            >
              Add to file list
            </Button>
            <p className="text-xs text-muted-foreground">
              Repeat for each shared definition and payload schema.
            </p>
          </Collapsible.Panel>
        </Collapsible.Root>
        {error && (
          <p
            role="alert"
            className="break-words rounded-lg bg-destructive/10 p-3 text-xs leading-relaxed text-destructive"
          >
            {error}
          </p>
        )}
        {pendingPaste && (
          <p className="text-xs text-muted-foreground">
            Add the pasted definition to the file list before saving.
          </p>
        )}
        <DialogFooter>
          <Button variant="ghost" disabled={reading} onClick={() => close(false)}>
            Cancel
          </Button>
          <Button
            disabled={reading || !files.length || pendingPaste}
            onClick={() => {
              const result = onAdd(files);
              if (result.ok) close(false);
              else setError(result.error || 'Could not load these definitions.');
            }}
          >
            Add {files.length || ''} {files.length === 1 ? 'schema' : 'schemas'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
