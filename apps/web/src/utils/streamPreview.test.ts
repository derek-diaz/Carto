import { describe, expect, it } from 'vitest';
import { summarizeJsonPreview } from './streamPreview';

describe('structured stream previews', () => {
  it('keeps useful top-level values visible when nested objects are large', () => {
    expect(summarizeJsonPreview('{"pose":{"x":1,"y":2},"status":"ready","samples":[1,2]}')).toBe(
      '{ "pose": {2 fields}, "status": "ready", "samples": [2 items] }'
    );
  });
  it('uses only complete fields from truncated previews, including escaped strings', () => {
    expect(summarizeJsonPreview('{"name":"a, \\"b\\"", "status":"rea')).toBe(
      '{ "name": "a, \\"b\\"", … }'
    );
    expect(summarizeJsonPreview('{"pose":{"x":1,"y":')).toBeNull();
    expect(summarizeJsonPreview('{"ok":true,"pose":{"x":1,')).toBe('{ "ok": true, … }');
  });
  it('bounds fields and long values without losing nulls, false or zero', () => {
    expect(summarizeJsonPreview('{"a":null,"b":false,"c":0,"d":1,"e":2}')).toBe(
      '{ "a": null, "b": false, "c": 0, "d": 1, … }'
    );
    expect(summarizeJsonPreview(JSON.stringify({ name: 'x'.repeat(80) }))).toContain(
      `${'x'.repeat(40)}…`
    );
  });
  it('leaves arrays, text, and malformed fields to the original preview', () => {
    expect(summarizeJsonPreview('[1,2]')).toBeNull();
    expect(summarizeJsonPreview('hello')).toBeNull();
    expect(summarizeJsonPreview('{invalid,')).toBeNull();
  });
});
