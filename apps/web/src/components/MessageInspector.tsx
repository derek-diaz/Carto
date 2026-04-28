import { useEffect, useState } from 'react';
import type { KeyboardEventHandler, PointerEventHandler } from 'react';
import type { CartoMessage } from '@shared/types';
import { formatBytes, formatTime } from '../utils/format';
import { formatJson, highlightJson } from '../utils/jsonSyntax';
import { IconClose } from './Icons';

type MessageInspectorProps = {
  message: CartoMessage | null;
  protoResult?: {
    data?: unknown;
    error?: string;
    label?: string;
    schemaName?: string;
    typeId?: string;
  } | null;
  subscriptionLabel?: string;
  variant?: 'side' | 'dock';
  onClose: () => void;
  onResizeStart?: PointerEventHandler<HTMLButtonElement>;
  onResizeKeyDown?: KeyboardEventHandler<HTMLButtonElement>;
};

type TabId = 'json' | 'text' | 'base64' | 'protobuf';

const MessageInspector = ({
  message,
  protoResult,
  subscriptionLabel,
  variant = 'side',
  onClose,
  onResizeStart,
  onResizeKeyDown
}: MessageInspectorProps) => {
  const [tab, setTab] = useState<TabId>('json');
  const protobufJson = protoResult?.data === undefined ? '' : formatJson(protoResult.data);
  const messageJson = formatJson(message?.json);
  const dockBadge =
    variant === 'dock'
      ? protoResult?.data !== undefined || message?.json
        ? 'Valid JSON'
        : message?.encoding?.toUpperCase()
      : null;

  useEffect(() => {
    if (!message) return;
    if (protoResult?.data !== undefined) {
      setTab('protobuf');
    } else if (message.json) {
      setTab('json');
    } else if (message.text) {
      setTab('text');
    } else {
      setTab('base64');
    }
  }, [message, protoResult?.data]);

  if (!message) {
    return (
      <aside
        className={`monitor_inspector monitor_inspector--empty ${
          variant === 'dock' ? 'monitor_inspector--dock' : ''
        }`}
      >
        {variant === 'dock' ? (
          <button
            className="monitor_inspector-resizer"
            onPointerDown={onResizeStart}
            onKeyDown={onResizeKeyDown}
            type="button"
            aria-label="Resize inspector"
            title="Resize inspector"
          />
        ) : null}
        <div className="monitor_inspector-empty">
          <span className="monitor_eyebrow">Inspector</span>
          <h3>Select a message</h3>
          <p>
            Pick any stream row to inspect the full payload, metadata, and decoded protobuf output
            without leaving the workspace.
          </p>
        </div>
      </aside>
    );
  }

  return (
    <aside className={`monitor_inspector ${variant === 'dock' ? 'monitor_inspector--dock' : ''}`}>
      {variant === 'dock' ? (
        <button
          className="monitor_inspector-resizer"
          onPointerDown={onResizeStart}
          onKeyDown={onResizeKeyDown}
          type="button"
          aria-label="Resize inspector"
          title="Resize inspector"
        />
      ) : null}
      <div className="monitor_inspector-header">
        <div className="monitor_inspector-title">
          <span className="monitor_eyebrow">
            {variant === 'dock' ? 'Payload inspector' : 'Inspector'}
          </span>
          <h3>{variant === 'dock' ? message.key : message.key}</h3>
          <p>
            {subscriptionLabel ? `${subscriptionLabel} • ` : ''}
            {formatTime(message.ts)}
          </p>
        </div>
        <div className="monitor_inspector-header-actions">
          {dockBadge ? (
            <span className="badge badge--ok monitor_inspector-badge">{dockBadge}</span>
          ) : null}
          <button
            className="icon-button icon-button--ghost icon-button--compact"
            onClick={onClose}
            type="button"
            aria-label="Close inspector"
            title="Close inspector"
          >
            <span className="icon-button_icon" aria-hidden="true">
              <IconClose />
            </span>
          </button>
        </div>
      </div>

      <div
        className={`monitor_inspector-layout ${variant === 'dock' ? 'monitor_inspector-layout--dock' : ''}`}
      >
        <div className="monitor_inspector-main">
          <div className="monitor_inspector-tabs">
            {protoResult ? (
              <button
                className={`tab ${tab === 'protobuf' ? 'tab--active' : ''}`}
                disabled={protoResult.data === undefined && !protoResult.error}
                onClick={() => setTab('protobuf')}
                type="button"
              >
                Protobuf
              </button>
            ) : null}
            <button
              className={`tab ${tab === 'json' ? 'tab--active' : ''}`}
              disabled={!message.json}
              onClick={() => setTab('json')}
              type="button"
            >
              JSON
            </button>
            <button
              className={`tab ${tab === 'text' ? 'tab--active' : ''}`}
              disabled={!message.text}
              onClick={() => setTab('text')}
              type="button"
            >
              Text
            </button>
            <button
              className={`tab ${tab === 'base64' ? 'tab--active' : ''}`}
              disabled={!message.base64}
              onClick={() => setTab('base64')}
              type="button"
            >
              Base64
            </button>
          </div>

          <div className="monitor_inspector-body">
            {message.payloadTruncated ? (
              <div className="notice notice--info-warning">
                Showing preview payload ({formatBytes(message.previewBytes ?? 0)} of{' '}
                {formatBytes(message.sizeBytes)}).
              </div>
            ) : null}
            {!message.json && !message.text && !message.base64 ? (
              <div className="notice notice--info">Loading full payload…</div>
            ) : null}
            {tab === 'protobuf' && protoResult ? (
              protoResult.data === undefined ? (
                <div className="notice notice--error">
                  {protoResult.error ?? 'Unable to decode protobuf payload.'}
                </div>
              ) : (
                <pre className="json_code">{highlightJson(protobufJson)}</pre>
              )
            ) : null}
            {tab === 'json' ? <pre className="json_code">{highlightJson(messageJson)}</pre> : null}
            {tab === 'text' ? (
              <pre>{message.payloadTruncated ? `${message.text ?? ''}\n...` : message.text}</pre>
            ) : null}
            {tab === 'base64' ? (
              <pre>
                {message.payloadTruncated ? `${message.base64 ?? ''}\n...` : (message.base64 ?? '')}
              </pre>
            ) : null}
          </div>
        </div>

        <aside className="monitor_inspector-context">
          <div className="monitor_stat">
            <span className="monitor_stat-label">Key</span>
            <span className="monitor_stat-value">{message.key}</span>
          </div>
          <div className="monitor_stat">
            <span className="monitor_stat-label">Timestamp</span>
            <span className="monitor_stat-value">{new Date(message.ts).toLocaleString()}</span>
          </div>
          <div className="monitor_stat">
            <span className="monitor_stat-label">Encoding</span>
            <span className="monitor_stat-value">{message.encoding}</span>
          </div>
          <div className="monitor_stat">
            <span className="monitor_stat-label">Size</span>
            <span className="monitor_stat-value">{formatBytes(message.sizeBytes)}</span>
          </div>
          {protoResult?.label ? (
            <div className="monitor_inspector-schema">
              <span className="monitor_stat-label">Decoder</span>
              <strong>{protoResult.label}</strong>
              {protoResult.schemaName ? <span>{protoResult.schemaName}</span> : null}
            </div>
          ) : null}
        </aside>
      </div>
    </aside>
  );
};

export default MessageInspector;
