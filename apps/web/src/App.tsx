import { notificationManager } from './components/ui/notifications';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CartoMessage, ConnectionStatus } from '@shared/types';
import AppHeader from './components/AppHeader';
import AppRail from './components/AppRail';
import AboutView from './components/AboutView';
import ConnectionView from './components/ConnectionView';
import MonitorView from './components/MonitorView';
import PublishView from './components/PublishView';
import SettingsView from './components/SettingsView';
import UpdateBanner from './components/UpdateBanner';
import {
  DEFAULT_PUBLISH_JSON,
  DEFAULT_PUBLISH_KEYEXPR,
  type PublishDraft
} from './components/PublishPanel';
import { useCarto } from './store/useCarto';
import { useDiscovery } from './store/useDiscovery';
import { useAppNavigation } from './hooks/useAppNavigation';
import { useSidebarState } from './hooks/useSidebarState';
import type { LogEntry, LogInput, ToastInput } from './utils/notifications';
import {
  decodeProtoPayloadCandidate,
  encodeProtoPayload,
  prepareProtoPayload,
  generateProtoSamplePayload,
  parseDecoderConfig,
  parseProtoSchema,
  mergeProtoSchemas,
  prepareProtoSchemas,
  type ProtoSource,
  resolveDecoderTypeIds,
  type DecoderConfig,
  type ProtoDecodeCandidate,
  type ProtoSchema,
  type ProtoTypeHandle,
  type ProtoTypeOption
} from './utils/proto';
import { base64ToBytes, bytesToBase64 } from './utils/base64';
import { useReleaseCheck } from './hooks/useReleaseCheck';
import pkg from '../../../package.json';

const MAX_LOGS = 200;
const DEFAULT_TOAST_MS = 3500;
const ERROR_TOAST_MS = 6000;
const PROTO_STORAGE_KEY = 'carto.proto.schemas';
const RING_BUFFER_STORAGE_KEY = 'carto.ringBuffer.size';
const SUBSCRIBE_HISTORY_KEY = 'carto.keyexpr.history';
const SUBSCRIBE_DETAILS_KEY = 'carto.keyexpr.subscribe.details';
const PUBLISH_HISTORY_KEY = 'carto.keyexpr.publish.history';
const PUBLISH_DETAILS_KEY = 'carto.keyexpr.publish.details';
const PROFILE_STORAGE_KEY = 'carto.connectionProfiles';
const HISTORY_EVENT = 'carto.history.updated';
const SETTINGS_EVENT = 'carto.settings.imported';
const DEFAULT_RING_BUFFER = 200;
const MIN_RING_BUFFER = 10;
const MAX_RING_BUFFER = 5000;
const MAX_PROTO_TABLE_PREVIEW_CHARS = 220;
const DISMISSED_RELEASE_KEY = 'carto.dismissedRelease';

const appInfo = pkg as {
  name?: string;
  version?: string;
  description?: string;
  author?: string;
  license?: string;
  build?: { productName?: string };
};

const createId = () => {
  const cryptoObj = globalThis.crypto as { randomUUID?: () => string } | undefined;
  if (cryptoObj?.randomUUID) return cryptoObj.randomUUID();
  return `id-${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

const formatProtoPreviewAtom = (value: unknown): string => {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (typeof value === 'string') return `"${value}"`;
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value);
  }
  if (Array.isArray(value)) return `[${value.length}]`;
  if (typeof value === 'object') return '{...}';
  return String(value);
};

const toProtoTablePreview = (value: unknown): string => {
  let formatted: string;
  if (value === null) {
    formatted = 'null';
  } else if (value === undefined) {
    formatted = 'undefined';
  } else if (
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    typeof value === 'bigint' ||
    typeof value === 'string'
  ) {
    formatted = String(value);
  } else if (Array.isArray(value)) {
    try {
      formatted = JSON.stringify(value);
    } catch {
      const head = value
        .slice(0, 4)
        .map((entry) => formatProtoPreviewAtom(entry))
        .join(', ');
      formatted = `[${head}${value.length > 4 ? ', ...' : ''}]`;
    }
  } else if (typeof value === 'object') {
    try {
      formatted = JSON.stringify(value);
    } catch {
      const entries = Object.entries(value as Record<string, unknown>);
      const head = entries
        .slice(0, 8)
        .map(([key, entry]) => `${key}:${formatProtoPreviewAtom(entry)}`)
        .join(', ');
      formatted = `{${head}${entries.length > 8 ? ', ...' : ''}}`;
    }
  } else {
    formatted = String(value);
  }

  if (formatted.length > MAX_PROTO_TABLE_PREVIEW_CHARS) {
    return `${formatted.slice(0, MAX_PROTO_TABLE_PREVIEW_CHARS)}...`;
  }
  return formatted;
};

const getProtoKeyAffinity = (handle: ProtoTypeHandle, key: string): number => {
  const typeName = normalizeProtoHint(handle.name.split('.').pop() ?? handle.name);
  if (!typeName) return 0;
  const segments = key
    .split('/')
    .map((segment) => normalizeProtoHint(segment))
    .filter(Boolean);
  if (segments.some((segment) => segment === typeName)) return 4;
  if (segments.some((segment) => typeName.includes(segment) || segment.includes(typeName)))
    return 2;
  return 0;
};

const normalizeProtoHint = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]/g, '');

const isBetterProtoCandidate = (
  candidate: ProtoDecodeCandidate & { affinity: number },
  best: (ProtoDecodeCandidate & { affinity: number }) | null
): boolean => {
  if (!best) return true;
  if (candidate.exact !== best.exact) return candidate.exact;
  if (candidate.score !== best.score) return candidate.score > best.score;
  return candidate.affinity > best.affinity;
};

type StoredProtoSchema = {
  id: string;
  name: string;
  source: string;
};

type SettingsExport = {
  version: number;
  exportedAt: string;
  app?: {
    name?: string;
    version?: string;
  };
  data: {
    theme?: 'light' | 'dark';
    ringBufferSize?: number;
    protoSchemas?: StoredProtoSchema[];
    histories?: {
      subscribe?: string[];
      subscribeDetails?: Record<string, DecoderConfig>;
      publish?: string[];
      publishDetails?: Record<string, PublishDraft>;
    };
    connectionProfiles?: unknown;
  };
};

const rewriteDecoderTypeIds = (
  decoder: DecoderConfig,
  typeIdRewrites: Map<string, string>
): DecoderConfig => {
  if (typeIdRewrites.size === 0 || decoder.kind === 'raw') return decoder;
  if (decoder.kind === 'protobuf') {
    return { kind: 'protobuf', typeId: typeIdRewrites.get(decoder.typeId) ?? decoder.typeId };
  }
  return {
    kind: 'protobuf_multi',
    typeIds: decoder.typeIds.map((typeId) => typeIdRewrites.get(typeId) ?? typeId)
  };
};

const App = () => {
  const sidebar = useSidebarState();
  const currentVersion = appInfo.version ?? '0.0.0';
  const { state: releaseState, checkNow: checkForUpdates } = useReleaseCheck(currentVersion);
  const [dismissedRelease, setDismissedRelease] = useState(() => {
    if (typeof globalThis === 'undefined' || !('localStorage' in globalThis)) return '';
    return globalThis.localStorage.getItem(DISMISSED_RELEASE_KEY) ?? '';
  });
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    if (typeof globalThis === 'undefined' || !('localStorage' in globalThis)) return 'light';
    const stored = globalThis.localStorage.getItem('carto.theme');
    if (stored === 'light' || stored === 'dark') return stored;
    return globalThis.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  });
  const [ringBufferSize, setRingBufferSize] = useState(() => {
    if (typeof globalThis === 'undefined' || !('localStorage' in globalThis)) {
      return DEFAULT_RING_BUFFER;
    }
    const stored = globalThis.localStorage.getItem(RING_BUFFER_STORAGE_KEY);
    const parsed = stored ? Number(stored) : NaN;
    if (!Number.isFinite(parsed)) return DEFAULT_RING_BUFFER;
    return Math.min(MAX_RING_BUFFER, Math.max(MIN_RING_BUFFER, Math.round(parsed)));
  });
  const {
    status,
    lastEndpoint,
    subscriptions,
    selectedSubId,
    setSelectedSubId,
    recentKeys,
    selectedRecentKeys,
    queryables,
    recentKeysFilter,
    setRecentKeysFilter,
    selectedMessages,
    captureById,
    connect,
    testConnection,
    disconnect,
    subscribe,
    updateSubscription,
    unsubscribe,
    setPaused,
    clearBuffer,
    getMessage,
    publish,
    declareQueryable,
    undeclareQueryable
  } = useCarto();
  const discovery = useDiscovery(status.connected);
  const [discoveryOpen, setDiscoveryOpen] = useState(true);

  const [logs, setLogs] = useState<LogEntry[]>([]);
  const prevStatusRef = useRef<ConnectionStatus | null>(null);
  const prevConnectedRef = useRef(status.connected);
  const [protoSchemas, setProtoSchemas] = useState<ProtoSchema[]>([]);
  const [subscriptionDecoders, setSubscriptionDecoders] = useState<
    Record<string, DecoderConfig | undefined>
  >({});

  const [selectedMessage, setSelectedMessage] = useState<CartoMessage | null>(null);
  const [pinnedMessages, setPinnedMessages] = useState<CartoMessage[]>([]);
  const selectedMessageRequestRef = useRef(0);
  const [copied, setCopied] = useState(false);
  const publishModeDraftsRef = useRef<Partial<Record<PublishDraft['encoding'], PublishDraft>>>({});
  const [publishDraft, setPublishDraft] = useState<PublishDraft>({
    keyexpr: DEFAULT_PUBLISH_KEYEXPR,
    encoding: 'json',
    payload: DEFAULT_PUBLISH_JSON,
    protoTypeId: undefined
  });
  const [lastPublish, setLastPublish] = useState<PublishDraft | null>(null);
  const [actionNotice, setActionNotice] = useState<{
    type: 'ok' | 'error';
    message: string;
  } | null>(null);
  const [showSubscribe, setShowSubscribe] = useState(false);

  useEffect(() => {
    if (typeof performance === 'undefined') return;
    if (
      typeof performance.clearMeasures !== 'function' ||
      typeof performance.clearMarks !== 'function'
    ) {
      return;
    }
    const timer = globalThis.setInterval(() => {
      performance.clearMeasures();
      performance.clearMarks();
    }, 5000);
    return () => {
      globalThis.clearInterval(timer);
    };
  }, []);

  const addToast = useCallback((toast: ToastInput) => {
    notificationManager.add({
      title: toast.message,
      description: toast.detail,
      type: toast.type,
      timeout: toast.durationMs ?? (toast.type === 'error' ? ERROR_TOAST_MS : DEFAULT_TOAST_MS),
      priority: toast.type === 'error' ? 'high' : 'low'
    });
  }, []);

  const addLog = useCallback((entry: LogInput) => {
    setLogs((prev) => {
      const next = [{ ...entry, id: createId(), ts: Date.now() }, ...prev];
      return next.slice(0, MAX_LOGS);
    });
  }, []);

  const clearLogs = useCallback(() => {
    setLogs([]);
  }, []);

  const protoTypeOptions = useMemo<ProtoTypeOption[]>(() => {
    return protoSchemas.flatMap((schema) =>
      schema.types.map((type) => ({
        ...type,
        label: `${schema.name} · ${type.name}`,
        schemaName: schema.name
      }))
    );
  }, [protoSchemas]);

  const mergedProtoRoot = useMemo(() => {
    if (protoSchemas.length === 0) return null;
    try {
      return mergeProtoSchemas(protoSchemas);
    } catch {
      return null;
    }
  }, [protoSchemas]);

  const protoTypeById = useMemo(() => {
    const map = new Map<string, ProtoTypeHandle>();
    const lookupRoot = mergedProtoRoot;
    protoSchemas.forEach((schema) => {
      schema.types.forEach((type) => {
        map.set(type.id, {
          ...type,
          root: lookupRoot ?? schema.root,
          schemaName: schema.name
        });
      });
    });
    return map;
  }, [mergedProtoRoot, protoSchemas]);

  const protoTypeLabels = useMemo(() => {
    const labels: Record<string, string> = {};
    protoTypeOptions.forEach((type) => {
      labels[type.id] = type.label;
    });
    return labels;
  }, [protoTypeOptions]);

  const getProtoSamplePayload = useCallback(
    (typeId: string): string | null => {
      const handle = protoTypeById.get(typeId);
      if (!handle) return null;
      return generateProtoSamplePayload(handle);
    },
    [protoTypeById]
  );

  const persistProtoSchemas = useCallback((schemas: ProtoSchema[]) => {
    if (!('localStorage' in globalThis)) return;
    const payload: StoredProtoSchema[] = schemas.map((schema) => ({
      id: schema.id,
      name: schema.name,
      source: schema.source
    }));
    globalThis.localStorage.setItem(PROTO_STORAGE_KEY, JSON.stringify(payload));
  }, []);

  const addProtoSchema = useCallback(
    (files: ProtoSource[]): { ok: boolean; error?: string } => {
      try {
        const next = prepareProtoSchemas(protoSchemas, files, createId);
        persistProtoSchemas(next);
        setProtoSchemas(next);
        const names = files.map((file) => file.name).join(', ');
        addToast({
          type: 'ok',
          message: files.length === 1 ? 'Schema added' : `${files.length} schemas added`,
          detail: names
        });
        addLog({ level: 'info', source: 'protobuf', message: `Schemas added: ${names}.` });
        return { ok: true };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        addToast({ type: 'error', message: 'Failed to parse schema', detail: message });
        addLog({ level: 'error', source: 'protobuf', message });
        return { ok: false, error: message };
      }
    },
    [addLog, addToast, persistProtoSchemas, protoSchemas]
  );

  const removeProtoSchema = useCallback(
    (schemaId: string) => {
      const next = protoSchemas.filter((schema) => schema.id !== schemaId);
      try {
        mergeProtoSchemas(next);
        persistProtoSchemas(next);
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        addToast({ type: 'error', message: 'Cannot remove a required schema', detail });
        return;
      }
      setProtoSchemas(next);
      setSubscriptionDecoders((prev) => {
        const next = { ...prev };
        Object.entries(next).forEach(([key, decoder]) => {
          if (decoder?.kind === 'protobuf' && decoder.typeId.startsWith(`${schemaId}:`)) {
            next[key] = { kind: 'raw' };
            return;
          }
          if (decoder?.kind === 'protobuf_multi') {
            const typeIds = decoder.typeIds.filter((typeId) => !typeId.startsWith(`${schemaId}:`));
            if (typeIds.length === 0) {
              next[key] = { kind: 'raw' };
              return;
            }
            next[key] = { kind: 'protobuf_multi', typeIds };
            return;
          }
        });
        return next;
      });
      addToast({ type: 'info', message: 'Schema removed' });
      addLog({ level: 'info', source: 'protobuf', message: 'Schema removed.' });
    },
    [addLog, addToast, persistProtoSchemas, protoSchemas]
  );

  const decodeProtobuf = useCallback(
    (
      decoder: DecoderConfig | undefined,
      message: Pick<CartoMessage, 'key' | 'base64' | 'payloadTruncated'> | null | undefined
    ) => {
      if (!decoder || !message || message.base64 === undefined) return null;
      if (message.payloadTruncated) {
        return {
          error: 'Payload preview is truncated; protobuf decode needs the full message.'
        };
      }
      const typeIds = resolveDecoderTypeIds(decoder);
      if (typeIds.length === 0) return null;

      const bytes = base64ToBytes(message.base64);
      let firstError: string | null = null;
      let best:
        | (ProtoDecodeCandidate & {
            affinity: number;
            handle: ProtoTypeHandle;
          })
        | null = null;

      for (const typeId of typeIds) {
        const handle = protoTypeById.get(typeId);
        if (!handle) continue;
        try {
          const candidate = {
            ...decodeProtoPayloadCandidate(handle, bytes),
            affinity: getProtoKeyAffinity(handle, message.key),
            handle
          };
          if (isBetterProtoCandidate(candidate, best)) {
            best = candidate;
          }
        } catch (error) {
          if (!firstError) {
            firstError = error instanceof Error ? error.message : String(error);
          }
        }
      }

      if (best) {
        return {
          data: best.data,
          label: best.handle.name,
          schemaName: best.handle.schemaName,
          typeId: best.handle.id,
          exact: best.exact
        };
      }

      return {
        error: firstError ?? 'Unable to decode with selected protobuf types.'
      };
    },
    [protoTypeById]
  );

  useEffect(() => {
    setSelectedMessage(null);
    selectedMessageRequestRef.current += 1;
  }, [selectedSubId]);

  useEffect(() => {
    if (!('localStorage' in globalThis)) return;
    const stored = globalThis.localStorage.getItem(PROTO_STORAGE_KEY);
    if (!stored) return;
    try {
      const parsed = JSON.parse(stored) as StoredProtoSchema[];
      if (!Array.isArray(parsed)) return;
      const next: ProtoSchema[] = [];
      parsed.forEach((entry) => {
        if (!entry || typeof entry !== 'object') return;
        if (typeof entry.id !== 'string' || typeof entry.name !== 'string') return;
        if (typeof entry.source !== 'string') return;
        try {
          next.push(parseProtoSchema(entry.id, entry.name, entry.source));
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          addToast({ type: 'warn', message: 'Skipped proto schema', detail: entry.name });
          addLog({ level: 'warn', source: 'protobuf', message });
        }
      });
      setProtoSchemas(next);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      addToast({ type: 'warn', message: 'Failed to load proto schemas', detail: message });
      addLog({ level: 'warn', source: 'protobuf', message });
    }
  }, [addLog, addToast]);

  useEffect(() => {
    const prev = prevStatusRef.current;
    if (prev && status.connected !== prev.connected) {
      addLog({
        level: status.connected ? 'info' : 'warn',
        source: 'connection',
        message: status.connected ? 'Connected.' : 'Disconnected.'
      });
    }
    if (status.health?.state && status.health.state !== prev?.health?.state) {
      if (status.health.state === 'reconnecting' || status.health.state === 'connecting') {
        addLog({
          level: status.health.state === 'reconnecting' ? 'warn' : 'info',
          source: 'connection',
          message: `Connection state: ${status.health.state}.`,
          detail: status.health.lastError
        });
      }
    }
    if (status.error && status.error !== prev?.error) {
      addToast({ type: 'error', message: 'Connection error', detail: status.error });
      addLog({ level: 'error', source: 'connection', message: status.error });
    }
    prevStatusRef.current = status;
  }, [addLog, addToast, status]);

  const selectedSub = subscriptions.find((sub) => sub.id === selectedSubId);
  const [pinnedContext, setPinnedContext] = useState<
    Record<
      string,
      {
        protoResult: ReturnType<typeof decodeProtobuf>;
        subscriptionLabel?: string;
      }
    >
  >({});
  const selectedDecoder = selectedSubId ? subscriptionDecoders[selectedSubId] : undefined;
  const protoResult = useMemo(
    () =>
      selectedMessage && pinnedContext[selectedMessage.id]
        ? pinnedContext[selectedMessage.id].protoResult
        : decodeProtobuf(selectedDecoder, selectedMessage),
    [decodeProtobuf, selectedDecoder, selectedMessage, pinnedContext]
  );
  const resolveProtobufPreview = useCallback(
    async (message: CartoMessage): Promise<string | null> => {
      if (!selectedSubId || !selectedDecoder || selectedDecoder.kind === 'raw') {
        return null;
      }
      try {
        const fullMessage = await getMessage(selectedSubId, message.id);
        if (!fullMessage) return null;
        const decoded = decodeProtobuf(selectedDecoder, fullMessage);
        if (!decoded?.data) return null;
        return toProtoTablePreview(decoded.data);
      } catch {
        return null;
      }
    },
    [decodeProtobuf, getMessage, selectedDecoder, selectedSubId]
  );
  const activeKeys = recentKeys;
  const [view, setView] = useAppNavigation();
  const [monitorTab, setMonitorTab] = useState<'stream' | 'keys'>('stream');

  useEffect(() => {
    const wasConnected = prevConnectedRef.current;
    prevConnectedRef.current = status.connected;
    if (
      !status.connected &&
      subscriptions.length === 0 &&
      pinnedMessages.length === 0 &&
      !discovery.snapshot?.startedAt &&
      status.health?.state === 'disconnected' &&
      view !== 'publish' &&
      view !== 'settings' &&
      view !== 'about'
    ) {
      setView('connection');
      return;
    }
    if (!wasConnected && status.connected && view === 'connection') {
      setView('monitor');
    }
  }, [
    status.connected,
    status.health?.state,
    view,
    setView,
    subscriptions.length,
    pinnedMessages.length,
    discovery.snapshot?.startedAt
  ]);

  useEffect(() => {
    if (subscriptions.length === 0) {
      setShowSubscribe(false);
    }
  }, [subscriptions.length]);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    document.documentElement.classList.toggle('theme-dark', theme === 'dark');
    if ('localStorage' in globalThis) {
      globalThis.localStorage.setItem('carto.theme', theme);
    }
  }, [theme]);

  useEffect(() => {
    if (!('localStorage' in globalThis)) return;
    globalThis.localStorage.setItem(RING_BUFFER_STORAGE_KEY, String(ringBufferSize));
  }, [ringBufferSize]);

  const readStringArray = useCallback((raw: string | null): string[] => {
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed.filter((entry) => typeof entry === 'string');
    } catch {
      return [];
    }
  }, []);

  const mergeStringArrays = useCallback((primary: string[], secondary: string[]) => {
    const combined = [...primary, ...secondary];
    const seen = new Set<string>();
    const next: string[] = [];
    combined.forEach((entry) => {
      if (!seen.has(entry)) {
        seen.add(entry);
        next.push(entry);
      }
    });
    return next;
  }, []);

  const readDecoderDetails = useCallback((raw: string | null): Record<string, DecoderConfig> => {
    if (!raw) return {};
    try {
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return {};
      const next: Record<string, DecoderConfig> = {};
      Object.entries(parsed as Record<string, unknown>).forEach(([key, value]) => {
        const decoder = parseDecoderConfig(
          value && typeof value === 'object' && 'decoder' in value
            ? (value as { decoder?: unknown }).decoder
            : value
        );
        if (decoder) next[key] = decoder;
      });
      return next;
    } catch {
      return {};
    }
  }, []);

  const exportSettings = useCallback((): SettingsExport => {
    const subscribeHistory = readStringArray(
      'localStorage' in globalThis ? globalThis.localStorage.getItem(SUBSCRIBE_HISTORY_KEY) : null
    );
    const subscribeDetails = readDecoderDetails(
      'localStorage' in globalThis ? globalThis.localStorage.getItem(SUBSCRIBE_DETAILS_KEY) : null
    );
    const publishHistory = readStringArray(
      'localStorage' in globalThis ? globalThis.localStorage.getItem(PUBLISH_HISTORY_KEY) : null
    );
    const publishDetails = (() => {
      if (!('localStorage' in globalThis)) return {};
      const stored = globalThis.localStorage.getItem(PUBLISH_DETAILS_KEY);
      if (!stored) return {};
      try {
        const parsed = JSON.parse(stored);
        if (!parsed || typeof parsed !== 'object') return {};
        const next: Record<string, PublishDraft> = {};
        Object.entries(parsed as Record<string, unknown>).forEach(([key, value]) => {
          if (!value || typeof value !== 'object') return;
          const entry = value as PublishDraft;
          if (typeof entry.encoding !== 'string' || typeof entry.payload !== 'string') return;
          next[key] = {
            keyexpr: key,
            encoding: entry.encoding,
            payload: entry.payload,
            protoTypeId: entry.protoTypeId,
            wireEncoding: typeof entry.wireEncoding === 'string' ? entry.wireEncoding : undefined
          };
        });
        return next;
      } catch {
        return {};
      }
    })();

    const connectionProfiles = (() => {
      if (!('localStorage' in globalThis)) return [];
      const stored = globalThis.localStorage.getItem(PROFILE_STORAGE_KEY);
      if (!stored) return [];
      try {
        const parsed = JSON.parse(stored);
        return parsed;
      } catch {
        return [];
      }
    })();

    return {
      version: 1,
      exportedAt: new Date().toISOString(),
      app: {
        name: appInfo.build?.productName ?? appInfo.name,
        version: appInfo.version
      },
      data: {
        theme,
        ringBufferSize,
        protoSchemas: protoSchemas.map((schema) => ({
          id: schema.id,
          name: schema.name,
          source: schema.source
        })),
        histories: {
          subscribe: subscribeHistory,
          subscribeDetails,
          publish: publishHistory,
          publishDetails
        },
        connectionProfiles
      }
    };
  }, [protoSchemas, readDecoderDetails, readStringArray, ringBufferSize, theme]);

  const importSettings = useCallback(
    (
      payload: unknown,
      options?: { mode?: 'merge' | 'replace' }
    ): { ok: boolean; error?: string; warnings?: string[] } => {
      const mode = options?.mode === 'merge' ? 'merge' : 'replace';
      if (!payload || typeof payload !== 'object') {
        return { ok: false, error: 'Invalid settings file.' };
      }
      const warnings: string[] = [];
      const root = payload as { data?: unknown };
      const data =
        root.data && typeof root.data === 'object'
          ? (root.data as Record<string, unknown>)
          : (root as Record<string, unknown>);
      const typeIdRewrites = new Map<string, string>();

      if (typeof data.theme === 'string' && mode === 'replace') {
        if (data.theme === 'light' || data.theme === 'dark') {
          setTheme(data.theme);
        } else {
          warnings.push('Skipped unknown theme value.');
        }
      }

      if (data.ringBufferSize !== undefined && mode === 'replace') {
        const parsed = Number(data.ringBufferSize);
        if (Number.isFinite(parsed)) {
          const clamped = Math.min(MAX_RING_BUFFER, Math.max(MIN_RING_BUFFER, Math.round(parsed)));
          setRingBufferSize(clamped);
        } else {
          warnings.push('Skipped invalid ring buffer size.');
        }
      }

      if (Array.isArray(data.protoSchemas)) {
        const nextSchemas: ProtoSchema[] = [];
        data.protoSchemas.forEach((entry) => {
          if (!entry || typeof entry !== 'object') return;
          const record = entry as StoredProtoSchema;
          if (
            typeof record.id !== 'string' ||
            typeof record.name !== 'string' ||
            typeof record.source !== 'string'
          ) {
            return;
          }
          try {
            nextSchemas.push(parseProtoSchema(record.id, record.name, record.source));
          } catch {
            warnings.push(`Skipped invalid protobuf schema: ${record.name}`);
          }
        });
        if (mode === 'merge') {
          const existing = protoSchemas;
          const existingByKey = new Map(
            existing.map((schema) => [`${schema.name}::${schema.source}`, schema])
          );
          const existingKeys = new Set(existingByKey.keys());
          const merged = [...existing];
          nextSchemas.forEach((schema) => {
            const key = `${schema.name}::${schema.source}`;
            const existingSchema = existingByKey.get(key);
            if (existingSchema) {
              schema.types.forEach((type) => {
                const existingType = existingSchema.types.find(
                  (candidate) => candidate.fullName === type.fullName
                );
                if (existingType) {
                  typeIdRewrites.set(type.id, existingType.id);
                }
              });
              return;
            }
            if (!existingKeys.has(key)) {
              existingKeys.add(key);
              merged.push(schema);
            }
          });
          setProtoSchemas(merged);
          persistProtoSchemas(merged);
        } else {
          setProtoSchemas(nextSchemas);
          persistProtoSchemas(nextSchemas);
        }
      }

      const histories = data.histories;
      if (histories && typeof histories === 'object') {
        const record = histories as Record<string, unknown>;
        if (Array.isArray(record.subscribe)) {
          const nextEntries = record.subscribe.filter(
            (entry) => typeof entry === 'string'
          ) as string[];
          if ('localStorage' in globalThis) {
            const current =
              mode === 'merge'
                ? readStringArray(globalThis.localStorage.getItem(SUBSCRIBE_HISTORY_KEY))
                : [];
            const merged = mode === 'merge' ? mergeStringArrays(nextEntries, current) : nextEntries;
            globalThis.localStorage.setItem(SUBSCRIBE_HISTORY_KEY, JSON.stringify(merged));
          }
          if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent(HISTORY_EVENT, { detail: { type: 'subscribe' } }));
          }
        }
        if (record.subscribeDetails && typeof record.subscribeDetails === 'object') {
          const next: Record<string, DecoderConfig> = {};
          Object.entries(record.subscribeDetails as Record<string, unknown>).forEach(
            ([key, value]) => {
              const decoder = parseDecoderConfig(
                value && typeof value === 'object' && 'decoder' in value
                  ? (value as { decoder?: unknown }).decoder
                  : value
              );
              if (decoder) next[key] = rewriteDecoderTypeIds(decoder, typeIdRewrites);
            }
          );
          if ('localStorage' in globalThis) {
            if (mode === 'merge') {
              const current = readDecoderDetails(
                globalThis.localStorage.getItem(SUBSCRIBE_DETAILS_KEY)
              );
              const merged = { ...next, ...current };
              globalThis.localStorage.setItem(SUBSCRIBE_DETAILS_KEY, JSON.stringify(merged));
            } else {
              globalThis.localStorage.setItem(SUBSCRIBE_DETAILS_KEY, JSON.stringify(next));
            }
          }
          if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent(HISTORY_EVENT, { detail: { type: 'subscribe' } }));
          }
        }
        if (Array.isArray(record.publish)) {
          const nextEntries = record.publish.filter(
            (entry) => typeof entry === 'string'
          ) as string[];
          if ('localStorage' in globalThis) {
            const current =
              mode === 'merge'
                ? readStringArray(globalThis.localStorage.getItem(PUBLISH_HISTORY_KEY))
                : [];
            const merged = mode === 'merge' ? mergeStringArrays(nextEntries, current) : nextEntries;
            globalThis.localStorage.setItem(PUBLISH_HISTORY_KEY, JSON.stringify(merged));
          }
          if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent(HISTORY_EVENT, { detail: { type: 'publish' } }));
          }
        }
        if (record.publishDetails && typeof record.publishDetails === 'object') {
          const next: Record<string, PublishDraft> = {};
          Object.entries(record.publishDetails as Record<string, unknown>).forEach(
            ([key, value]) => {
              if (!value || typeof value !== 'object') return;
              const entry = value as PublishDraft;
              if (typeof entry.encoding !== 'string' || typeof entry.payload !== 'string') return;
              next[key] = {
                keyexpr: key,
                encoding: entry.encoding,
                payload: entry.payload,
                protoTypeId: entry.protoTypeId
                  ? (typeIdRewrites.get(entry.protoTypeId) ?? entry.protoTypeId)
                  : undefined,
                wireEncoding:
                  typeof entry.wireEncoding === 'string' ? entry.wireEncoding : undefined
              };
            }
          );
          if ('localStorage' in globalThis) {
            if (mode === 'merge') {
              const currentRaw = globalThis.localStorage.getItem(PUBLISH_DETAILS_KEY);
              let current: Record<string, PublishDraft> = {};
              if (currentRaw) {
                try {
                  const parsed = JSON.parse(currentRaw);
                  if (parsed && typeof parsed === 'object') {
                    current = parsed as Record<string, PublishDraft>;
                  }
                } catch {
                  current = {};
                }
              }
              const merged = { ...next, ...current };
              globalThis.localStorage.setItem(PUBLISH_DETAILS_KEY, JSON.stringify(merged));
            } else {
              globalThis.localStorage.setItem(PUBLISH_DETAILS_KEY, JSON.stringify(next));
            }
          }
          if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent(HISTORY_EVENT, { detail: { type: 'publish' } }));
          }
        }
      }

      if (Array.isArray(data.connectionProfiles)) {
        if ('localStorage' in globalThis) {
          if (mode === 'merge') {
            const currentRaw = globalThis.localStorage.getItem(PROFILE_STORAGE_KEY);
            let current: { id?: string }[] = [];
            if (currentRaw) {
              try {
                const parsed = JSON.parse(currentRaw);
                if (Array.isArray(parsed)) {
                  current = parsed as { id?: string }[];
                }
              } catch {
                current = [];
              }
            }
            const byId = new Map<string, unknown>();
            current.forEach((entry) => {
              if (entry && typeof entry === 'object' && typeof entry.id === 'string') {
                byId.set(entry.id, entry);
              }
            });
            (data.connectionProfiles as unknown[]).forEach((entry) => {
              if (
                entry &&
                typeof entry === 'object' &&
                typeof (entry as { id?: string }).id === 'string'
              ) {
                const id = (entry as { id: string }).id;
                if (!byId.has(id)) {
                  byId.set(id, entry);
                }
              }
            });
            globalThis.localStorage.setItem(
              PROFILE_STORAGE_KEY,
              JSON.stringify([...byId.values()])
            );
          } else {
            globalThis.localStorage.setItem(
              PROFILE_STORAGE_KEY,
              JSON.stringify(data.connectionProfiles)
            );
          }
        }
        if (typeof window !== 'undefined') {
          window.dispatchEvent(
            new CustomEvent(SETTINGS_EVENT, { detail: { type: 'connectionProfiles' } })
          );
        }
      }

      return { ok: true, warnings: warnings.length > 0 ? warnings : undefined };
    },
    [
      mergeStringArrays,
      persistProtoSchemas,
      protoSchemas,
      readDecoderDetails,
      readStringArray,
      setProtoSchemas,
      setRingBufferSize,
      setTheme
    ]
  );

  useEffect(() => {
    if (!copied) return;
    const timer = globalThis.setTimeout(() => setCopied(false), 1500);
    return () => globalThis.clearTimeout(timer);
  }, [copied]);

  useEffect(() => {
    if (!actionNotice) return;
    const timer = globalThis.setTimeout(() => setActionNotice(null), 2000);
    return () => globalThis.clearTimeout(timer);
  }, [actionNotice]);

  const publishSupport = useMemo<'supported' | 'unknown' | 'unsupported'>(() => {
    const features = status.capabilities?.features;
    if (!features || features.length === 0) return 'unknown';
    return features.includes('publish') ? 'supported' : 'unsupported';
  }, [status.capabilities]);

  const queryableSupport = useMemo<'supported' | 'unknown' | 'unsupported'>(() => {
    const features = status.capabilities?.features;
    if (!features || features.length === 0) return 'unknown';
    return features.includes('queryable') ? 'supported' : 'unsupported';
  }, [status.capabilities]);

  const viewTitle = useMemo(() => {
    switch (view) {
      case 'monitor':
        return 'Monitor';
      case 'publish':
        return 'Publish';
      case 'settings':
        return 'Settings';
      case 'about':
        return 'About';
      default:
        return 'Connection';
    }
  }, [view]);

  const viewDescription = useMemo(() => {
    if (view === 'monitor') {
      return '';
    }
    if (view === 'publish') {
      if (publishSupport === 'supported') {
        return 'Send payloads to a key expression.';
      }
      if (publishSupport === 'unsupported') {
        return 'Publishing disabled by this router.';
      }
      return 'Publishing capability unknown.';
    }
    if (view === 'settings') {
      return 'Manage defaults, history, backups, and schemas.';
    }
    if (view === 'about') {
      return 'Version, project information, and updates.';
    }
    return status.connected ? 'Connected to the router.' : 'Configure and connect to a router.';
  }, [publishSupport, status.connected, view]);

  const canCopyEndpoint =
    typeof navigator !== 'undefined' && typeof navigator.clipboard?.writeText === 'function';
  const endpointLabel = lastEndpoint || 'Not set';
  const endpointTitle = lastEndpoint || 'No endpoint yet';
  const handleCopyEndpoint = useCallback(async () => {
    if (!lastEndpoint || !canCopyEndpoint) return;
    try {
      await navigator.clipboard.writeText(lastEndpoint);
      setCopied(true);
    } catch {
      // ignore clipboard errors
    }
  }, [canCopyEndpoint, lastEndpoint]);

  const validateProtoDraft = useCallback(
    (typeId: string, payload: string): string | null => {
      const handle = protoTypeById.get(typeId);
      if (!handle) return 'Add the required schema and choose a message type.';
      try {
        const parsed: unknown = JSON.parse(payload);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
          return 'Protobuf payload must be a JSON object.';
        prepareProtoPayload(handle, parsed);
        return null;
      } catch (error) {
        return error instanceof Error ? error.message : String(error);
      }
    },
    [protoTypeById]
  );

  const handlePublish = useCallback(
    async (
      keyexpr: string,
      payload: string,
      encoding: PublishDraft['encoding'],
      protoTypeId?: string,
      wireEncoding?: string
    ) => {
      if (encoding === 'protobuf') {
        if (!protoTypeId) {
          throw new Error('Select a protobuf message type before publishing.');
        }
        const handle = protoTypeById.get(protoTypeId);
        if (!handle) {
          throw new Error('Selected protobuf type is not available.');
        }
        let parsed: unknown;
        try {
          parsed = JSON.parse(payload);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          throw new Error(`Invalid JSON payload. ${message}`);
        }
        const bytes = encodeProtoPayload(handle, parsed);
        const encoded = bytesToBase64(bytes);
        await publish(keyexpr, encoded, 'base64', wireEncoding?.trim() || 'application/protobuf');
        setLastPublish({ keyexpr, payload, encoding, protoTypeId, wireEncoding });
        return;
      }
      await publish(keyexpr, payload, encoding, wireEncoding);
      setLastPublish({ keyexpr, payload, encoding, wireEncoding });
    },
    [protoTypeById, publish]
  );

  const handleDeclareQueryable = useCallback(
    async (
      keyexpr: string,
      payload: string,
      encoding: PublishDraft['encoding'],
      protoTypeId?: string
    ) => {
      if (encoding === 'protobuf') {
        if (!protoTypeId) {
          throw new Error('Select a protobuf message type before declaring a queryable.');
        }
        const handle = protoTypeById.get(protoTypeId);
        if (!handle) {
          throw new Error('Selected protobuf type is not available.');
        }
        let parsed: unknown;
        try {
          parsed = JSON.parse(payload);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          throw new Error(`Invalid JSON payload. ${message}`);
        }
        const bytes = encodeProtoPayload(handle, parsed);
        const encoded = bytesToBase64(bytes);
        await declareQueryable(keyexpr, encoded, 'base64');
        return;
      }
      await declareQueryable(keyexpr, payload, encoding);
    },
    [declareQueryable, protoTypeById]
  );

  const handleSubscribe = useCallback(
    async (keyexpr: string, bufferSize?: number, decoder?: DecoderConfig) => {
      const resolvedBufferSize = bufferSize ?? ringBufferSize;
      const subscriptionId = await subscribe(keyexpr, resolvedBufferSize);
      setSubscriptionDecoders((prev) => ({
        ...prev,
        [subscriptionId]: decoder ?? { kind: 'raw' }
      }));
      setShowSubscribe(false);
      return subscriptionId;
    },
    [ringBufferSize, subscribe]
  );

  const handleUpdateSubscription = useCallback(
    async (
      subscriptionId: string,
      keyexpr: string,
      bufferSize?: number,
      decoder?: DecoderConfig
    ) => {
      const resolvedBufferSize = bufferSize ?? ringBufferSize;
      await updateSubscription(subscriptionId, keyexpr, resolvedBufferSize);
      setSubscriptionDecoders((prev) => ({
        ...prev,
        [subscriptionId]: decoder ?? { kind: 'raw' }
      }));
      if (subscriptionId === selectedSubId) {
        selectedMessageRequestRef.current += 1;
        setSelectedMessage(null);
      }
    },
    [ringBufferSize, selectedSubId, updateSubscription]
  );

  const handleUnsubscribe = useCallback(
    async (subscriptionId: string) => {
      await unsubscribe(subscriptionId);
      setSubscriptionDecoders((prev) => {
        const next = { ...prev };
        delete next[subscriptionId];
        return next;
      });
    },
    [unsubscribe]
  );

  const handleTogglePause = useCallback(async () => {
    if (!selectedSub || !status.connected || discoveryOpen) return;
    await setPaused(selectedSub.id, !selectedSub.paused);
  }, [selectedSub, setPaused, status.connected, discoveryOpen]);

  const handleClearBuffer = useCallback(async () => {
    if (!selectedSub || !status.connected || discoveryOpen) return;
    await clearBuffer(selectedSub.id);
    selectedMessageRequestRef.current += 1;
    setSelectedMessage(null);
  }, [clearBuffer, selectedSub, status.connected, discoveryOpen]);

  const handleSelectMessage = useCallback(
    async (msg: CartoMessage) => {
      const requestId = ++selectedMessageRequestRef.current;
      setSelectedMessage(msg);
      if (msg.payloadLoaded && !msg.payloadTruncated && !msg.payloadUnavailable) return;
      if (!selectedSubId) return;
      try {
        const full = await getMessage(selectedSubId, msg.id);
        if (selectedMessageRequestRef.current !== requestId) return;
        if (!full) {
          setSelectedMessage({
            ...msg,
            payloadUnavailable: 'This payload has expired from memory. Select a newer message.'
          });
          return;
        }
        setSelectedMessage(full);
      } catch {
        if (selectedMessageRequestRef.current === requestId)
          setSelectedMessage({
            ...msg,
            payloadUnavailable:
              'The full payload could not be loaded. Select this message again to retry.'
          });
      }
    },
    [getMessage, selectedSubId]
  );

  const handleDisconnect = useCallback(async () => {
    try {
      await disconnect();
    } catch {
      // ignore disconnect errors
      const message = 'Disconnect failed.';
      addToast({ type: 'error', message });
      addLog({ level: 'error', source: 'connection', message });
    }
  }, [addLog, addToast, disconnect]);

  const handleReplayLast = useCallback(async () => {
    if (!lastPublish || !status.connected) return;
    try {
      await handlePublish(
        lastPublish.keyexpr,
        lastPublish.payload,
        lastPublish.encoding,
        lastPublish.protoTypeId,
        lastPublish.wireEncoding
      );
      setActionNotice({ type: 'ok', message: 'Replayed last publish.' });
      addLog({
        level: 'info',
        source: 'publish',
        message: `Replayed ${lastPublish.keyexpr}.`
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setActionNotice({ type: 'error', message });
      addToast({ type: 'error', message: 'Replay failed', detail: message });
      addLog({ level: 'error', source: 'publish', message, detail: lastPublish.keyexpr });
    }
  }, [addLog, addToast, handlePublish, lastPublish, status.connected]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!event.metaKey && !event.ctrlKey) return;
      const target = event.target as HTMLElement | null;
      if (target) {
        const tagName = target.tagName;
        if (
          tagName === 'INPUT' ||
          tagName === 'TEXTAREA' ||
          tagName === 'SELECT' ||
          target.isContentEditable
        ) {
          return;
        }
      }

      if (event.code === 'Digit1' && status.connected) {
        event.preventDefault();
        setView('monitor');
        return;
      }
      if (event.code === 'Digit2' && status.connected) {
        event.preventDefault();
        setView('publish');
        return;
      }
      if (event.code === 'Digit3') {
        event.preventDefault();
        setView('connection');
        return;
      }
      if (event.code === 'Digit4') {
        event.preventDefault();
        setView('settings');
        return;
      }
      if (event.code === 'Digit5') {
        event.preventDefault();
        setView('about');
        return;
      }

      const key = event.key.toLowerCase();
      if (event.shiftKey && key === 'l') {
        event.preventDefault();
        setTheme((current) => (current === 'dark' ? 'light' : 'dark'));
        return;
      }
      if (event.shiftKey && key === 'd' && status.connected) {
        event.preventDefault();
        handleDisconnect();
        return;
      }
      if (event.shiftKey && key === 'p' && view === 'monitor' && selectedSub && status.connected) {
        event.preventDefault();
        handleTogglePause().catch(() => {});
        return;
      }
      if (event.shiftKey && key === 'k' && view === 'monitor' && selectedSub && status.connected) {
        event.preventDefault();
        handleClearBuffer().catch(() => {});
        return;
      }
      if (event.shiftKey && key === 'r' && view === 'publish' && lastPublish && status.connected) {
        event.preventDefault();
        handleReplayLast().catch(() => {});
      }
    };

    globalThis.addEventListener('keydown', handleKeyDown);
    return () => globalThis.removeEventListener('keydown', handleKeyDown);
  }, [
    handleReplayLast,
    handleClearBuffer,
    handleDisconnect,
    handleTogglePause,
    lastPublish,
    selectedSub,
    setTheme,
    setView,
    status.connected,
    view
  ]);

  const availableRelease =
    releaseState.comparison === 'available' ? releaseState.release : undefined;
  const showUpdateBanner =
    availableRelease !== undefined && availableRelease.tagName !== dismissedRelease;
  const dismissUpdate = useCallback(() => {
    if (!availableRelease) return;
    setDismissedRelease(availableRelease.tagName);
    if ('localStorage' in globalThis) {
      globalThis.localStorage.setItem(DISMISSED_RELEASE_KEY, availableRelease.tagName);
    }
  }, [availableRelease]);

  return (
    <div className="app">
      <div className="app_frame" data-sidebar-collapsed={sidebar.collapsed}>
        <AppRail
          collapsed={sidebar.collapsed}
          onToggleCollapsed={sidebar.toggle}
          hasRetainedMessages={
            subscriptions.length > 0 ||
            pinnedMessages.length > 0 ||
            Boolean(discovery.snapshot?.startedAt)
          }
          theme={theme}
          view={view}
          connected={status.connected}
          updateAvailable={availableRelease !== undefined}
          onSetView={setView}
          onToggleTheme={() => setTheme((current) => (current === 'dark' ? 'light' : 'dark'))}
        />

        <div className="app_shell">
          <AppHeader
            quietConnection={view === 'publish'}
            viewTitle={viewTitle}
            viewDescription={viewDescription}
            statusConnected={status.connected}
            health={status.health}
            endpointLabel={endpointLabel}
            endpointTitle={endpointTitle}
            canCopyEndpoint={canCopyEndpoint}
            copied={copied}
            lastEndpoint={lastEndpoint}
            onCopyEndpoint={handleCopyEndpoint}
            actionNotice={actionNotice}
            onDisconnect={handleDisconnect}
          />

          {showUpdateBanner ? (
            <UpdateBanner
              release={availableRelease}
              onShowAbout={() => setView('about')}
              onDismiss={dismissUpdate}
            />
          ) : null}

          <div className="app_body">
            {view === 'monitor' ? (
              <MonitorView
                discoveryOpen={discoveryOpen}
                setDiscoveryOpen={setDiscoveryOpen}
                discovery={discovery}
                capture={selectedSubId ? captureById[selectedSubId] : undefined}
                pinnedMessages={pinnedMessages}
                pinnedContext={pinnedContext}
                onPin={(message) => {
                  if (pinnedMessages.some((entry) => entry.id === message.id)) return;
                  if (pinnedMessages.length >= 8 || message.sizeBytes > 8 * 1024 * 1024) {
                    addToast({
                      type: 'error',
                      message: 'Pin limit reached',
                      detail:
                        'Keep up to 8 payloads of at most 8 MiB each. Unpin a message to make room.'
                    });
                    return;
                  }
                  setPinnedMessages((previous) => [...previous, message]);
                  setPinnedContext((previous) => ({
                    ...previous,
                    [message.id]: {
                      protoResult,
                      subscriptionLabel: selectedSub?.keyexpr
                    }
                  }));
                  addToast({
                    type: 'ok',
                    message: 'Message pinned',
                    detail: 'Full payload kept for this app session.'
                  });
                }}
                onUnpin={(id) => {
                  setPinnedMessages((previous) => previous.filter((message) => message.id !== id));
                  setPinnedContext((previous) => {
                    const next = { ...previous };
                    delete next[id];
                    return next;
                  });
                }}
                onPublishMessage={(message) => {
                  if (
                    !message.payloadLoaded ||
                    message.payloadTruncated ||
                    message.payloadUnavailable ||
                    message.base64 === undefined ||
                    message.kind === 'delete'
                  )
                    return;
                  const decoded = pinnedContext[message.id]
                    ? pinnedContext[message.id].protoResult
                    : decodeProtobuf(selectedDecoder, message);
                  if (decoded?.data !== undefined && decoded.typeId) {
                    setPublishDraft({
                      keyexpr: message.key,
                      encoding: 'protobuf',
                      payload: JSON.stringify(decoded.data, null, 2),
                      protoTypeId: decoded.typeId,
                      wireEncoding: message.wireEncoding
                    });
                  } else if (message.json !== undefined) {
                    setPublishDraft({
                      keyexpr: message.key,
                      encoding: 'json',
                      payload: JSON.stringify(message.json, null, 2),
                      wireEncoding: message.wireEncoding
                    });
                  } else if (message.text !== undefined) {
                    setPublishDraft({
                      keyexpr: message.key,
                      encoding: 'text',
                      payload: message.text,
                      wireEncoding: message.wireEncoding
                    });
                  } else
                    setPublishDraft({
                      keyexpr: message.key,
                      encoding: 'base64',
                      payload: message.base64,
                      wireEncoding: message.wireEncoding
                    });
                  setView('publish');
                  addToast({
                    type: 'ok',
                    message: 'Publish draft ready',
                    detail: 'Review and edit the payload, then publish when ready.'
                  });
                }}
                onPublishKey={(key) => {
                  setPublishDraft({
                    keyexpr: key,
                    encoding: 'json',
                    payload: DEFAULT_PUBLISH_JSON
                  });
                  setView('publish');
                }}
                getMessage={getMessage}
                connected={status.connected}
                subscriptions={subscriptions}
                selectedSubId={selectedSubId}
                setSelectedSubId={setSelectedSubId}
                selectedMessages={selectedMessages}
                selectedRecentKeys={selectedRecentKeys}
                recentKeysFilter={recentKeysFilter}
                setRecentKeysFilter={setRecentKeysFilter}
                monitorTab={monitorTab}
                setMonitorTab={setMonitorTab}
                showSubscribe={showSubscribe}
                setShowSubscribe={setShowSubscribe}
                onSubscribe={handleSubscribe}
                onUpdateSubscription={handleUpdateSubscription}
                onUnsubscribe={handleUnsubscribe}
                onPause={setPaused}
                onClear={clearBuffer}
                onSelectMessage={handleSelectMessage}
                selectedMessage={selectedMessage}
                protoResult={protoResult}
                onCloseInspector={() => {
                  selectedMessageRequestRef.current += 1;
                  setSelectedMessage(null);
                }}
                onLog={addLog}
                onToast={addToast}
                protoTypes={protoTypeOptions}
                onAddProtoSchema={addProtoSchema}
                decoderById={subscriptionDecoders}
                selectedDecoder={selectedDecoder}
                decodeProtobuf={decodeProtobuf}
                resolveProtobufPreview={resolveProtobufPreview}
                protoTypeLabels={protoTypeLabels}
              />
            ) : null}

            {view === 'publish' ? (
              <PublishView
                connected={status.connected}
                publishSupport={publishSupport}
                queryableSupport={queryableSupport}
                draft={publishDraft}
                onDraftChange={setPublishDraft}
                onEncodingChange={(candidate) => {
                  publishModeDraftsRef.current[publishDraft.encoding] = publishDraft;
                  setPublishDraft({
                    ...(publishModeDraftsRef.current[candidate.encoding] || candidate),
                    keyexpr: publishDraft.keyexpr
                  });
                }}
                validateProtoDraft={validateProtoDraft}
                onAddSchema={addProtoSchema}
                onPublish={handlePublish}
                onDeclareQueryable={handleDeclareQueryable}
                queryables={queryables}
                onUndeclareQueryable={undeclareQueryable}
                getProtoSamplePayload={getProtoSamplePayload}
                onLog={addLog}
                onToast={addToast}
                protoTypes={protoTypeOptions}
                keys={activeKeys}
                filter={recentKeysFilter}
                onFilterChange={setRecentKeysFilter}
              />
            ) : null}

            {view === 'connection' ? (
              <ConnectionView
                status={status}
                defaultEndpoint={lastEndpoint || undefined}
                onConnect={async (params) => {
                  setDiscoveryOpen(true);
                  await connect(params);
                }}
                onTestConnection={testConnection}
                events={logs}
                onClearEvents={clearLogs}
                onLog={addLog}
                onToast={addToast}
              />
            ) : null}

            {view === 'settings' ? (
              <SettingsView
                ringBufferSize={ringBufferSize}
                minRingBuffer={MIN_RING_BUFFER}
                maxRingBuffer={MAX_RING_BUFFER}
                onRingBufferChange={setRingBufferSize}
                schemas={protoSchemas}
                onAddSchema={addProtoSchema}
                onRemoveSchema={removeProtoSchema}
                onLog={addLog}
                onToast={addToast}
                onExportSettings={exportSettings}
                onImportSettings={importSettings}
              />
            ) : null}

            {view === 'about' ? (
              <AboutView
                appName={appInfo.build?.productName ?? appInfo.name ?? 'Carto'}
                version={currentVersion}
                description={appInfo.description}
                author={appInfo.author}
                license={appInfo.license}
                releaseState={releaseState}
                onCheckForUpdates={checkForUpdates}
              />
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
};

export default App;
