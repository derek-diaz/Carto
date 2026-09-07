import { describe, expect, it } from 'vitest';
import {
  decodeProtoPayload,
  encodeProtoPayload,
  generateProtoSamplePayload,
  parseProtoSchema
} from './proto';

describe('protobuf sample payloads', () => {
  it('generates encodable values for 64-bit integer fields', () => {
    const schema = parseProtoSchema(
      'test-schema',
      'test',
      'syntax = "proto3"; package test; enum Status { READY = 0; BUSY = 1; } message Reading { uint64 sequence = 1; int64 sent_at_ms = 2; Status status = 3; }'
    );
    const type = schema.types.find((entry) => entry.fullName === 'test.Reading');
    expect(type).toBeDefined();

    const handle = {
      ...type!,
      root: schema.root,
      schemaName: schema.name
    };
    const sample = JSON.parse(generateProtoSamplePayload(handle)) as Record<string, unknown>;

    expect(sample).toEqual({ sequence: 1, sentAtMs: 1, status: 0 });
    expect(encodeProtoPayload(handle, sample).byteLength).toBeGreaterThan(0);
  });
});

describe('inspector protobuf republishing', () => {
  const schema = parseProtoSchema(
    'roundtrip',
    'roundtrip',
    'syntax = "proto3"; enum State { READY = 0; BUSY = 1; } message Reading { uint64 sequence = 1; State state = 2; int32 count = 3; }'
  );
  const handle = { ...schema.types[0], root: schema.root, schemaName: schema.name };
  it('round-trips enum names and 64-bit strings without precision loss', () => {
    const json = { sequence: '18446744073709551615', state: 'BUSY', count: 4 };
    expect(decodeProtoPayload(handle, encodeProtoPayload(handle, json))).toMatchObject(json);
  });
  it('rejects invalid scalar values and out-of-range integers instead of coercing them', () => {
    expect(() => encodeProtoPayload(handle, { state: 'UNKNOWN' })).toThrow();
    expect(() => encodeProtoPayload(handle, { count: 'oops' })).toThrow();
    expect(() => encodeProtoPayload(handle, { sequence: '-1' })).toThrow();
    expect(() => encodeProtoPayload(handle, [])).toThrow();
  });
});
