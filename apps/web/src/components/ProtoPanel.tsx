import { useMemo, useState } from 'react';
import type { LogInput, ToastInput } from '../utils/notifications';
import type { ProtoSchema } from '../utils/proto';
import { IconTrash } from './Icons';

type ProtoPanelProps = {
  schemas: ProtoSchema[];
  onAddSchema: (name: string, source: string) => boolean;
  onRemoveSchema: (id: string) => void;
  onLog: (entry: LogInput) => void;
  onToast: (toast: ToastInput) => void;
};

const MAX_PREVIEW_LINES = 6;

const ProtoPanel = ({
  schemas,
  onAddSchema,
  onRemoveSchema,
  onLog,
  onToast
}: ProtoPanelProps) => {
  const [schemaName, setSchemaName] = useState('');
  const [schemaSource, setSchemaSource] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);

  const preview = useMemo(() => {
    if (!schemaSource.trim()) return '';
    const lines = schemaSource.trim().split(/\r?\n/);
    return lines.slice(0, MAX_PREVIEW_LINES).join('\n');
  }, [schemaSource]);

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const file = files[0];
    if (!file) return;
    if (!file.name.endsWith('.proto')) {
      setError('Please drop a .proto file.');
      onToast({ type: 'warn', message: 'Unsupported file', detail: file.name });
      return;
    }
    try {
      const text = await file.text();
      const name = file.name.replace(/\.proto$/i, '');
      setSchemaName(name);
      setSchemaSource(text);
      setError(null);
      onLog({ level: 'info', source: 'protobuf', message: `Loaded ${file.name}.` });
    } catch (readError) {
      const message = readError instanceof Error ? readError.message : String(readError);
      setError(message);
      onToast({ type: 'error', message: 'Failed to read .proto', detail: message });
      onLog({ level: 'error', source: 'protobuf', message });
    }
  };

  const handleAddSchema = () => {
    const trimmedName = schemaName.trim();
    const trimmedSource = schemaSource.trim();
    if (!trimmedName) {
      setError('Schema name is required.');
      return;
    }
    if (!trimmedSource) {
      setError('Proto source is required.');
      return;
    }

    const ok = onAddSchema(trimmedName, trimmedSource);
    if (ok) {
      setSchemaName('');
      setSchemaSource('');
      setError(null);
    } else {
      setError('Failed to parse proto schema.');
    }
  };

  return (
    <section className="panel">
      <div className="panel_header">
        <h2>Protobuf</h2>
        <span className="badge badge--idle">{schemas.length} schemas</span>
      </div>

      <div
        className={`proto_drop ${dragActive ? 'proto_drop--active' : ''}`}
        onDragOver={(event) => {
          event.preventDefault();
          setDragActive(true);
        }}
        onDragLeave={() => setDragActive(false)}
        onDrop={async (event) => {
          event.preventDefault();
          setDragActive(false);
          const files = event.dataTransfer?.files ?? null;
          await handleFiles(files);
        }}
      >
        <div className="proto_drop-title">Drag and drop a .proto file</div>
        <div className="proto_drop-subtitle">or choose a file from disk</div>
        <input
          type="file"
          accept=".proto"
          onChange={async (event) => {
            const files = event.target.files;
            await handleFiles(files);
          }}
        />
      </div>

      <label className="field">
        <span>Schema name</span>
        <input
          type="text"
          value={schemaName}
          onChange={(event) => setSchemaName(event.target.value)}
          placeholder="robot_messages"
        />
      </label>

      <label className="field">
        <span>Paste .proto text</span>
        <textarea
          value={schemaSource}
          onChange={(event) => setSchemaSource(event.target.value)}
          rows={6}
          placeholder={`syntax = "proto3";
package example;
message Ping { string id = 1; }`}
        />
      </label>

      {preview ? <pre className="proto_preview">{preview}</pre> : null}

      <div className="panel_actions">
        <button className="button" type="button" onClick={handleAddSchema}>
          Add schema
        </button>
      </div>

      {error ? <div className="notice notice--error">{error}</div> : null}

      <div className="proto_list">
        {schemas.length === 0 ? (
          <div className="empty">No schemas loaded yet.</div>
        ) : (
          schemas.map((schema) => (
            <div key={schema.id} className="proto_item">
              <div className="proto_item-head">
                <div>
                  <div className="proto_item-title">{schema.name}</div>
                  <div className="proto_item-subtitle">{schema.types.length} message types</div>
                </div>
                <button
                  className="button button--ghost button--compact"
                  type="button"
                  onClick={() => onRemoveSchema(schema.id)}
                >
                  <span className="button_icon" aria-hidden="true">
                    <IconTrash />
                  </span>{' '}Remove
                </button>
              </div>
              <div className="proto_types">
                {schema.types.slice(0, 12).map((type) => (
                  <span key={type.id} className="proto_type">
                    {type.name}
                  </span>
                ))}
                {schema.types.length > 12 ? (
                  <span className="proto_type proto_type--more">
                    +{schema.types.length - 12} more
                  </span>
                ) : null}
              </div>
            </div>
          ))
        )}
      </div>
    </section>
  );
};

export default ProtoPanel;
