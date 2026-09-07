import { describe, expect, it } from 'vitest';
import {
  decodeProtoPayload,
  encodeProtoPayload,
  mergeProtoSchemas,
  parseProtoSchema,
  prepareProtoSchemas
} from './proto';

const common = {
  name: 'common.proto',
  source:
    'syntax = "proto3"; package shared; message Header { string source = 1; } enum Level { OK = 0; WARNING = 1; }'
};
const payload = {
  name: 'payload.proto',
  source:
    'syntax = "proto3"; package payload; import "common.proto"; message Alert { shared.Header header = 1; shared.Level level = 2; string text = 3; }'
};
describe('related Protobuf schemas', () => {
  it('resolves imports and shared nested types regardless of file order', () => {
    let id = 0;
    const schemas = prepareProtoSchemas([], [payload, common], () => String(id++));
    const root = mergeProtoSchemas(schemas);
    const type = schemas[0].types.find((type) => type.fullName === 'payload.Alert')!;
    const handle = { ...type, root, schemaName: schemas[0].name };
    const bytes = encodeProtoPayload(handle, {
      header: { source: 'robot-1' },
      level: 1,
      text: 'Overheat'
    });
    expect(decodeProtoPayload(handle, bytes)).toEqual({
      header: { source: 'robot-1' },
      level: 'WARNING',
      text: 'Overheat'
    });
    const restored = schemas.map((schema) =>
      parseProtoSchema(schema.id, schema.name, schema.source)
    );
    expect(decodeProtoPayload({ ...handle, root: mergeProtoSchemas(restored) }, bytes)).toEqual({
      header: { source: 'robot-1' },
      level: 'WARNING',
      text: 'Overheat'
    });
  });
  it('reuses an already loaded identical shared file and preserves its type IDs', () => {
    const existing = prepareProtoSchemas([], [common], () => 'shared-id');
    const result = prepareProtoSchemas(existing, [common, payload], () => 'payload-id');
    expect(result).toHaveLength(2);
    expect(result[1]).toBe(existing[0]);
    expect(result[1].types[0].id).toBe(existing[0].types[0].id);
    expect(() => mergeProtoSchemas(result)).not.toThrow();
  });
  it('rejects missing dependencies without changing the existing library', () => {
    const existing = prepareProtoSchemas([], [common], () => 'shared-id');
    const bad = {
      name: 'missing.proto',
      source: 'syntax = "proto3"; message Missing { absent.Header header = 1; }'
    };
    expect(() => prepareProtoSchemas(existing, [payload, bad], () => 'id')).toThrow(
      'Unresolved Protobuf dependency'
    );
    expect(existing).toHaveLength(1);
    expect(existing[0].root.lookup('payload.Alert')).toBeNull();
  });
  it('identifies conflicting definitions instead of silently dropping shared types', () => {
    const conflicting = { name: 'conflict.proto', source: common.source };
    expect(() => prepareProtoSchemas([], [common, conflicting], () => 'id')).toThrow(
      'conflict.proto'
    );
  });
  it('reports the source file for syntax errors and rejects empty sets', () => {
    expect(() =>
      prepareProtoSchemas([], [{ name: 'broken.proto', source: 'invalid' }], () => 'id')
    ).toThrow('broken.proto');
    expect(() => prepareProtoSchemas([], [], () => 'id')).toThrow('at least one');
  });
  it('detects removal of a required shared definition', () => {
    const schemas = prepareProtoSchemas([], [common, payload], () => 'id');
    expect(() =>
      mergeProtoSchemas(schemas.filter((schema) => schema.name !== common.name))
    ).toThrow('Unresolved Protobuf dependency');
  });
});
