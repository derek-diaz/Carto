import { useEffect, useState } from 'react';
import type { CartoMessage } from '@shared/types';
import { formatBytes, formatTime } from '../utils/format';
import { IconClose } from './Icons';

type MessageDrawerProps = {
  message: CartoMessage | null;
  protoResult?: {
    data?: unknown;
    error?: string;
    label?: string;
    schemaName?: string;
  } | null;
  onClose: () => void;
};

type TabId = 'json' | 'text' | 'base64' | 'protobuf';

const MessageDrawer = ({ message, protoResult, onClose }: MessageDrawerProps) => {
  const [tab, setTab] = useState<TabId>('json');

  useEffect(() => {
    if (!message) return;
    if (protoResult?.data) {
      setTab('protobuf');
    } else if (message.json) {
      setTab('json');
    } else if (message.text) {
      setTab('text');
    } else {
      setTab('base64');
    }
  }, [message, protoResult?.data]);

  if (!message) return null;

  return (
    <aside className="drawer">
      <div className="drawer_header">
        <div>
          <div className="drawer_title">Message detail</div>
          <div className="drawer_subtitle">
            {message.key} - {formatTime(message.ts)} - {formatBytes(message.sizeBytes)}
          </div>
        </div>
        <button className="button button--ghost" onClick={onClose}>
          <span className="button_icon" aria-hidden="true">
            <IconClose />
          </span>{' '}Close
        </button>
      </div>

      <div className="drawer_tabs">
        {protoResult ? (
          <button
            className={`tab ${tab === 'protobuf' ? 'tab--active' : ''}`}
            disabled={!protoResult.data && !protoResult.error}
            onClick={() => setTab('protobuf')}
          >
            Protobuf
          </button>
        ) : null}
        <button
          className={`tab ${tab === 'json' ? 'tab--active' : ''}`}
          disabled={!message.json}
          onClick={() => setTab('json')}
        >
          JSON
        </button>
        <button
          className={`tab ${tab === 'text' ? 'tab--active' : ''}`}
          disabled={!message.text}
          onClick={() => setTab('text')}
        >
          Text
        </button>
        <button
          className={`tab ${tab === 'base64' ? 'tab--active' : ''}`}
          onClick={() => setTab('base64')}
        >
          Base64
        </button>
      </div>

      <div className="drawer_body">
        {tab === 'protobuf' && protoResult ? (
          protoResult.data ? (
            <pre>{JSON.stringify(protoResult.data, null, 2)}</pre>
          ) : (
            <div className="notice notice--error">
              {protoResult.error ?? 'Unable to decode protobuf payload.'}
            </div>
          )
        ) : null}
        {tab === 'json' ? <pre>{JSON.stringify(message.json, null, 2)}</pre> : null}
        {tab === 'text' ? <pre>{message.text}</pre> : null}
        {tab === 'base64' ? <pre>{message.base64 ?? ''}</pre> : null}
      </div>
    </aside>
  );
};

export default MessageDrawer;

