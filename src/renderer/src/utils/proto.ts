import * as protobuf from 'protobufjs';

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

export type ProtoTypeOption = ProtoTypeRef & {
  label: string;
  schemaName: string;
};

export type ProtoTypeHandle = ProtoTypeRef & {
  root: protobuf.Root;
  schemaName: string;
};

export type DecoderConfig =
  | { kind: 'raw' }
  | {
      kind: 'protobuf';
      typeId: string;
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

export const encodeProtoPayload = (handle: ProtoTypeHandle, payload: unknown): Uint8Array => {
  const type = handle.root.lookupType(handle.fullName);
  if (payload === null || typeof payload !== 'object') {
    throw new Error('Protobuf payload must be a JSON object.');
  }
  const plainPayload = payload as Record<string, unknown>;
  const error = type.verify(plainPayload);
  if (error) {
    throw new Error(error);
  }
  const message = type.create(plainPayload);
  return type.encode(message).finish();
};

export const decodeProtoPayload = (handle: ProtoTypeHandle, bytes: Uint8Array): unknown => {
  const type = handle.root.lookupType(handle.fullName);
  const message = type.decode(bytes);
  return type.toObject(message, {
    longs: String,
    enums: String,
    bytes: String,
    defaults: true
  });
};
