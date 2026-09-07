import * as protobuf from 'protobufjs';
import type { CartoMessage, DiscoveredKey } from '@shared/types';

export type ProtobufDecoder = (
  decoder: DecoderConfig | undefined,
  message: Pick<CartoMessage, 'key' | 'base64' | 'payloadTruncated'> | null | undefined
) => {
  data?: unknown;
  error?: string;
  label?: string;
  schemaName?: string;
  exact?: boolean;
} | null;

export const decodeDiscoveryPreview = (
  entry: DiscoveredKey,
  decoder: DecoderConfig,
  decode: ProtobufDecoder
) => {
  if (entry.kind === 'delete') return { error: 'Delete events have no payload to decode.' };
  if (entry.previewTruncated)
    return {
      error:
        'This sample exceeds the 512-byte discovery preview. Watch this key to decode full messages.'
    };
  if (entry.previewBase64 === undefined)
    return { error: 'Sample bytes are unavailable. Scan again to try a decoder.' };
  return decode(decoder, { key: entry.key, base64: entry.previewBase64, payloadTruncated: false });
};

export type ProtoTypeRef = {
  id: string;
  schemaId: string;
  name: string;
  fullName: string;
};

export type ProtoSchema = {
  id: string;
  name: string;
  source: string;
  root: protobuf.Root;
  types: ProtoTypeRef[];
};

export type ProtoSource = { name: string; source: string };
export type AddProtoSchemas = (files: ProtoSource[]) => { ok: boolean; error?: string };

/** Resolve related definitions together, independent of the order files were selected. */
export const mergeProtoSchemas = (
  schemas: Pick<ProtoSchema, 'name' | 'source'>[]
): protobuf.Root => {
  const root = new protobuf.Root();
  for (const schema of schemas) {
    try {
      protobuf.parse(schema.source, root);
    } catch (error) {
      throw new Error(`${schema.name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  try {
    root.resolveAll();
  } catch (error) {
    throw new Error(
      `Unresolved Protobuf dependency: ${error instanceof Error ? error.message : String(error)}. Add the shared .proto files with this set.`
    );
  }
  return root;
};

export const prepareProtoSchemas = (
  existing: ProtoSchema[],
  files: ProtoSource[],
  createId: () => string
): ProtoSchema[] => {
  if (files.length === 0) throw new Error('Add at least one .proto file.');
  const added = files
    .filter(
      (file) =>
        !existing.some(
          (schema) =>
            schema.name === file.name.trim() && schema.source.trim() === file.source.trim()
        )
    )
    .map((file) => {
      if (!file.name.trim() || !file.source.trim())
        throw new Error('Each file needs a name and a Protobuf definition.');
      try {
        return parseProtoSchema(createId(), file.name.trim(), file.source);
      } catch (error) {
        throw new Error(`${file.name}: ${error instanceof Error ? error.message : String(error)}`);
      }
    });
  const next = [...added, ...existing];
  mergeProtoSchemas(next);
  return next;
};

export type ProtoTypeOption = ProtoTypeRef & {
  label: string;
  schemaName: string;
};

export type ProtoTypeHandle = ProtoTypeRef & {
  root: protobuf.Root;
  schemaName: string;
};

export type ProtoDecodeCandidate = {
  data: unknown;
  exact: boolean;
  score: number;
};

export type DecoderConfig =
  | { kind: 'raw' }
  | {
      kind: 'protobuf';
      typeId: string;
    }
  | {
      kind: 'protobuf_multi';
      typeIds: string[];
    };

export const parseDecoderConfig = (value: unknown): DecoderConfig | undefined => {
  if (!value || typeof value !== 'object') return undefined;
  const record = value as Record<string, unknown>;
  if (record.kind === 'raw') return { kind: 'raw' };
  if (record.kind === 'protobuf' && typeof record.typeId === 'string') {
    return { kind: 'protobuf', typeId: record.typeId };
  }
  if (record.kind === 'protobuf_multi' && Array.isArray(record.typeIds)) {
    const typeIds = record.typeIds.filter((typeId) => typeof typeId === 'string');
    return { kind: 'protobuf_multi', typeIds };
  }
  return undefined;
};

const collectTypes = (root: protobuf.Root, schemaId: string): ProtoTypeRef[] => {
  const types: ProtoTypeRef[] = [];
  const visit = (namespace: protobuf.NamespaceBase) => {
    const nested = namespace.nestedArray ?? [];
    for (const entry of nested) {
      if (entry instanceof protobuf.Type) {
        const fullName = entry.fullName.replace(/^\./, '');
        types.push({
          id: `${schemaId}:${fullName}`,
          schemaId,
          name: fullName,
          fullName
        });
      }
      if (entry instanceof protobuf.Namespace) {
        visit(entry);
      }
    }
  };
  visit(root);
  return types;
};

export const parseProtoSchema = (id: string, name: string, source: string): ProtoSchema => {
  const parsed = protobuf.parse(source);
  const root = parsed.root;
  const types = collectTypes(root, id);
  return {
    id,
    name,
    source,
    root,
    types
  };
};

// Accept the same enum names and decimal 64-bit strings emitted by the inspector,
// without coercing invalid scalar values into defaults.
const normalizeProtoJson = (
  type: protobuf.Type,
  payload: Record<string, unknown>
): Record<string, unknown> => {
  type.resolveAll();
  const result = { ...payload };
  for (const field of type.fieldsArray) {
    const normalize = (value: unknown): unknown => {
      if (
        field.resolvedType instanceof protobuf.Type &&
        value &&
        typeof value === 'object' &&
        !Array.isArray(value)
      )
        return normalizeProtoJson(field.resolvedType, value as Record<string, unknown>);
      if (field.resolvedType instanceof protobuf.Enum && typeof value === 'string')
        return field.resolvedType.values[value] ?? value;
      if (
        /^(u?int64|sint64|s?fixed64)$/.test(field.type) &&
        typeof value === 'string' &&
        /^-?\d+$/.test(value)
      ) {
        const number = BigInt(value);
        const unsigned = field.type === 'uint64' || field.type === 'fixed64';
        if (
          number < (unsigned ? 0n : -(1n << 63n)) ||
          number > (unsigned ? (1n << 64n) - 1n : (1n << 63n) - 1n)
        )
          throw new Error(`${field.name}: value outside ${field.type} range`);
        return {
          low: Number(BigInt.asIntN(32, number)),
          high: Number(BigInt.asIntN(32, number >> 32n)),
          unsigned
        };
      }
      return value;
    };
    const value = result[field.name];
    if (field.map && value && typeof value === 'object' && !Array.isArray(value))
      result[field.name] = Object.fromEntries(
        Object.entries(value).map(([key, entry]) => [key, normalize(entry)])
      );
    else if (field.repeated && Array.isArray(value)) result[field.name] = value.map(normalize);
    else result[field.name] = normalize(value);
  }
  return result;
};

export const prepareProtoPayload = (
  handle: ProtoTypeHandle,
  payload: unknown
): Record<string, unknown> => {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload))
    throw new Error('Protobuf payload must be a JSON object.');
  const type = handle.root.lookupType(handle.fullName);
  const normalized = normalizeProtoJson(type, payload as Record<string, unknown>);
  const error = type.verify(normalized);
  if (error) throw new Error(error);
  return normalized;
};

export const encodeProtoPayload = (handle: ProtoTypeHandle, payload: unknown): Uint8Array => {
  const type = handle.root.lookupType(handle.fullName);
  return type.encode(type.create(prepareProtoPayload(handle, payload))).finish();
};

export const generateProtoSamplePayload = (handle: ProtoTypeHandle): string => {
  const type = handle.root.lookupType(handle.fullName);
  type.resolveAll();
  return JSON.stringify(buildMessageSample(type, new Set<string>()), null, 2);
};

export const decodeProtoPayload = (handle: ProtoTypeHandle, bytes: Uint8Array): unknown => {
  return decodeProtoPayloadCandidate(handle, bytes).data;
};

export const decodeProtoPayloadCandidate = (
  handle: ProtoTypeHandle,
  bytes: Uint8Array
): ProtoDecodeCandidate => {
  const type = handle.root.lookupType(handle.fullName);
  const message = type.decode(bytes);
  const data = type.toObject(message, {
    longs: String,
    enums: String,
    bytes: String,
    defaults: true
  });
  const encoded = type.encode(message).finish();
  return {
    data,
    exact: bytesEqual(bytes, encoded),
    score: scoreDecodedValue(data)
  };
};

export const resolveDecoderTypeIds = (decoder: DecoderConfig | undefined): string[] => {
  if (!decoder || decoder.kind === 'raw') return [];
  if (decoder.kind === 'protobuf') return [decoder.typeId];
  return [...new Set(decoder.typeIds)];
};

const buildMessageSample = (type: protobuf.Type, seen: Set<string>): Record<string, unknown> => {
  const fullName = type.fullName || type.name;
  if (seen.has(fullName)) return {};
  const nextSeen = new Set(seen);
  nextSeen.add(fullName);

  const oneofFields = new Set<string>();
  type.oneofsArray.forEach((oneof) => {
    const first = oneof.fieldsArray[0];
    if (first) oneofFields.add(first.name);
  });

  const sample: Record<string, unknown> = {};
  type.fieldsArray.forEach((field) => {
    if (field.partOf && !oneofFields.has(field.name)) return;
    sample[field.name] = buildFieldSample(field, nextSeen);
  });
  return sample;
};

const buildFieldSample = (field: protobuf.Field, seen: Set<string>): unknown => {
  if (field.map) {
    const keyType = (field as protobuf.Field & { keyType?: string }).keyType ?? 'string';
    return {
      [String(buildScalarSample(keyType))]: buildSingleValueSample(field, seen)
    };
  }
  if (field.repeated) {
    return [buildSingleValueSample(field, seen)];
  }
  return buildSingleValueSample(field, seen);
};

const buildSingleValueSample = (field: protobuf.Field, seen: Set<string>): unknown => {
  if (field.resolvedType instanceof protobuf.Type) {
    return buildMessageSample(field.resolvedType, seen);
  }
  if (field.resolvedType instanceof protobuf.Enum) {
    return Object.values(field.resolvedType.values)[0] ?? 0;
  }
  return buildScalarSample(field.type);
};

const buildScalarSample = (type: string): unknown => {
  switch (type) {
    case 'string':
      return 'string';
    case 'bool':
      return true;
    case 'bytes':
      return 'AQID';
    case 'double':
    case 'float':
      return 1.5;
    case 'int64':
    case 'uint64':
    case 'sint64':
    case 'fixed64':
    case 'sfixed64':
      return 1;
    default:
      return 1;
  }
};

const bytesEqual = (left: Uint8Array, right: Uint8Array): boolean => {
  if (left.byteLength !== right.byteLength) return false;
  for (let index = 0; index < left.byteLength; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
};

const scoreDecodedValue = (value: unknown): number => {
  if (Array.isArray(value)) {
    return value.length === 0
      ? 0
      : 4 + value.reduce<number>((total, entry) => total + scoreDecodedValue(entry), 0);
  }
  if (value && typeof value === 'object') {
    return Object.values(value as Record<string, unknown>).reduce<number>(
      (total, entry) => total + scoreDecodedValue(entry),
      0
    );
  }
  if (value === null || value === undefined) return 0;
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (typeof value === 'number') return value === 0 ? 0 : 1;
  if (typeof value === 'bigint') return value === 0n ? 0 : 1;
  if (typeof value === 'string') return value.length === 0 || value === '0' ? 0 : 1;
  return 0;
};
