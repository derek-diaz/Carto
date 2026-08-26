import { describe, expect, it } from 'vitest';
import { shouldHighlightJsonPreview } from './StreamView';

describe('stream payload previews', () => {
  it('syntax-highlights raw JSON snippets without requiring a protobuf decoder', () => {
    expect(shouldHighlightJsonPreview('{"status":"ready","count":3}', '', true)).toBe(true);
    expect(shouldHighlightJsonPreview('[true,null,3]', '', true)).toBe(true);
  });

  it('keeps text previews plain and gives active search matches priority', () => {
    expect(shouldHighlightJsonPreview('service ready', '', true)).toBe(false);
    expect(shouldHighlightJsonPreview('{"status":"ready"}', 'ready', true)).toBe(false);
  });
});
