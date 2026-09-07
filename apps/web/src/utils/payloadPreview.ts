export const PAYLOAD_PREVIEW_BYTES = 64 * 1024;

/** Counts displayed UTF-8 text bytes, which may differ from the wire payload size. */
export function previewPayloadText(text: string, limit = PAYLOAD_PREVIEW_BYTES) {
  const bytes = new TextEncoder().encode(text);
  let end = Math.min(Math.max(0, limit), bytes.length);
  // Do not cut a multi-byte character in half.
  if (end < bytes.length) while (end > 0 && (bytes[end] & 0xc0) === 0x80) end--;
  return {
    text: end === bytes.length ? text : new TextDecoder().decode(bytes.subarray(0, end)),
    shownBytes: end,
    totalBytes: bytes.length,
    truncated: end < bytes.length
  };
}
