import { describe, expect, it, vi } from 'vitest';
import type { DiscoveredKey } from '@shared/types';
import { decodeDiscoveryPreview, decodeProtoPayload, parseProtoSchema } from './proto';

const source =
  'syntax = "proto3"; message Alert { string text = 1; int32 severity = 2; } message Counter { int32 value = 1; }';
const schema = parseProtoSchema('test', 'alerts.proto', source);
const alertType = schema.root.lookupType('Alert');
const bytes = alertType.encode(alertType.create({ text: 'Overheat', severity: 3 })).finish();
const entry: DiscoveredKey = {
  key: 'alerts',
  count: 1,
  bytes: bytes.length,
  lastSeen: 1,
  lastSize: bytes.length,
  preview: 'display only',
  previewBase64: Buffer.from(bytes).toString('base64'),
  previewTruncated: false,
  kind: 'put'
};
const decode = (
  config: Parameters<Parameters<typeof decodeDiscoveryPreview>[2]>[0],
  message: Parameters<Parameters<typeof decodeDiscoveryPreview>[2]>[1]
) => {
  if (config?.kind !== 'protobuf' || !message) return null;
  const ref = schema.types.find((type) => type.id === config.typeId)!;
  try {
    return {
      data: decodeProtoPayload(
        { ...ref, root: schema.root, schemaName: schema.name },
        Buffer.from(message.base64!, 'base64')
      )
    };
  } catch (error) {
    return { error: String(error) };
  }
};
describe('discovery protobuf preview', () => {
  it('decodes exact retained bytes with the selected type instead of display text', () => {
    expect(
      decodeDiscoveryPreview(entry, { kind: 'protobuf', typeId: 'test:Alert' }, decode)
    ).toEqual({ data: { text: 'Overheat', severity: 3 } });
  });
  it('evaluates a different type independently', () => {
    const different = decodeDiscoveryPreview(
      entry,
      { kind: 'protobuf', typeId: 'test:Counter' },
      decode
    );
    expect(different).not.toEqual({ data: { text: 'Overheat', severity: 3 } });
    expect(
      decodeDiscoveryPreview(entry, { kind: 'protobuf', typeId: 'test:Alert' }, decode)
    ).toEqual({ data: { text: 'Overheat', severity: 3 } });
  });
  it.each([
    [{ ...entry, previewTruncated: true }, '512-byte'],
    [{ ...entry, previewBase64: undefined }, 'unavailable'],
    [{ ...entry, kind: 'delete' as const }, 'Delete events']
  ])('does not decode missing or partial evidence', (sample, error) => {
    const decoder = vi.fn();
    expect(
      decodeDiscoveryPreview(sample, { kind: 'protobuf', typeId: 'test:Alert' }, decoder)?.error
    ).toContain(error);
    expect(decoder).not.toHaveBeenCalled();
  });
  it('allows a complete empty protobuf message', () => {
    expect(
      decodeDiscoveryPreview(
        { ...entry, previewBase64: '', lastSize: 0 },
        { kind: 'protobuf', typeId: 'test:Alert' },
        decode
      )
    ).toEqual({ data: { text: '', severity: 0 } });
  });
});
