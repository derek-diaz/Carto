import { expect, it } from 'vitest';
import { isValidElement } from 'react';
import { PAYLOAD_PREVIEW_BYTES, previewPayloadText } from './payloadPreview';
import { highlightJson } from './jsonSyntax';

it('keeps small JSON and empty text intact', () => {
  const text = JSON.stringify({ ready: true, count: 3 }, null, 2);
  expect(previewPayloadText(text)).toEqual({
    text,
    shownBytes: text.length,
    totalBytes: text.length,
    truncated: false
  });
  expect(previewPayloadText('')).toEqual({
    text: '',
    shownBytes: 0,
    totalBytes: 0,
    truncated: false
  });
  expect(highlightJson(text).some(isValidElement)).toBe(true);
});

it.each([256 * 1024, 4 * 1024 * 1024])(
  'bounds a %i-byte single line without changing its source',
  (size) => {
    const text = 'x'.repeat(size);
    const preview = previewPayloadText(text);
    expect(preview).toEqual({
      text: text.slice(0, PAYLOAD_PREVIEW_BYTES),
      shownBytes: PAYLOAD_PREVIEW_BYTES,
      totalBytes: size,
      truncated: true
    });
    expect(text.length).toBe(size);
  }
);

it('counts UTF-8 bytes and never splits multibyte characters', () => {
  const text = 'Aé🤖Z';
  expect(previewPayloadText(text, 2)).toEqual({
    text: 'A',
    shownBytes: 1,
    totalBytes: 8,
    truncated: true
  });
  expect(previewPayloadText(text, 6)).toEqual({
    text: 'Aé',
    shownBytes: 3,
    totalBytes: 8,
    truncated: true
  });
  expect(previewPayloadText(text, 7).text).toBe('Aé🤖');
  expect(previewPayloadText(text, 8).truncated).toBe(false);
});

it('counts the Base64 representation independently of the binary payload', () => {
  const payload = Buffer.alloc(256 * 1024, 255);
  const preview = previewPayloadText(payload.toString('base64'));
  expect(preview.totalBytes).toBe(349528);
  expect(preview.shownBytes).toBe(65536);
  expect(preview.text).not.toContain('\n');
});

it('avoids thousands of syntax nodes for dense JSON while preserving all its text', () => {
  const text = JSON.stringify(Array.from({ length: 20000 }, () => 0));
  expect(text.length).toBeLessThan(PAYLOAD_PREVIEW_BYTES);
  expect(highlightJson(text)).toEqual([text]);
});
