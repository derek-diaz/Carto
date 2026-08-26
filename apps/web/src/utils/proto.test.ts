import { describe, expect, it } from 'vitest';
import { encodeProtoPayload, generateProtoSamplePayload, parseProtoSchema } from './proto';

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
