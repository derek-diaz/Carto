import { memo, useMemo, useState } from 'react';
import { highlightJson } from '../utils/jsonSyntax';
import { previewPayloadText } from '../utils/payloadPreview';
import { formatBytes } from '../utils/format';
import { Button } from './ui/button';

export const PayloadTextView = memo(function PayloadTextView({
  text,
  json,
  payloadBytes
}: {
  text: string;
  json: boolean;
  payloadBytes: number;
}) {
  const [full, setFull] = useState(false);
  const preview = useMemo(() => previewPayloadText(text), [text]);
  const rendered = useMemo(() => {
    const visible = full ? text : preview.text;
    // Full large views remain a single text node, regardless of JSON token count.
    return json && !preview.truncated ? highlightJson(visible) : visible || '[empty payload]';
  }, [full, text, preview, json]);
  return (
    <div className="payload-text-view">
      {preview.truncated && (
        <div className="payload-preview-notice" role="status">
          <span>
            <strong>{formatBytes(payloadBytes)} payload</strong> ·{' '}
            {full
              ? `Showing all ${formatBytes(preview.totalBytes)} of display text`
              : `Previewing first ${formatBytes(preview.shownBytes)} of ${formatBytes(preview.totalBytes)} of display text`}
          </span>
          <Button
            variant="ghost"
            size="sm"
            className="rounded-sm text-xs"
            onClick={() => setFull(!full)}
          >
            {full ? 'Show preview' : 'Show full text'}
          </Button>
        </div>
      )}
      <pre
        className={json ? 'payload-text json_code' : 'payload-text'}
        tabIndex={0}
        aria-label="Payload text"
      >
        {rendered}
      </pre>
    </div>
  );
});
