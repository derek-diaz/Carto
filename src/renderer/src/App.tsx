import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CartoMessage, ConnectionStatus } from '@shared/types';
import AppHeader from './components/AppHeader';
import AppRail from './components/AppRail';
import AboutDialog from './components/AboutDialog';
import ConnectionView from './components/ConnectionView';
import LogsView from './components/LogsView';
import MonitorView from './components/MonitorView';
import MessageDrawer from './components/MessageDrawer';
import PublishView from './components/PublishView';
import SettingsView from './components/SettingsView';
import ToastStack from './components/ToastStack';
import {
  DEFAULT_PUBLISH_JSON,
  DEFAULT_PUBLISH_KEYEXPR,
  type PublishDraft
} from './components/PublishPanel';
import { useCarto } from './store/useCarto';
import type { LogEntry, LogInput, Toast, ToastInput } from './utils/notifications';
import {
  decodeProtoPayload,
  encodeProtoPayload,
  parseProtoSchema,
  type DecoderConfig,
  type ProtoSchema,
  type ProtoTypeHandle,
  type ProtoTypeOption
} from './utils/proto';
import { base64ToBytes, bytesToBase64 } from './utils/base64';
import pkg from '../../../package.json';

const MAX_LOGS = 200;
const MAX_TOASTS = 4;
const DEFAULT_TOAST_MS = 3500;
const ERROR_TOAST_MS = 6000;
const PROTO_STORAGE_KEY = 'carto.proto.schemas';
const RING_BUFFER_STORAGE_KEY = 'carto.ringBuffer.size';
const SUBSCRIBE_HISTORY_KEY = 'carto.keyexpr.history';
const PUBLISH_HISTORY_KEY = 'carto.keyexpr.publish.history';
const PUBLISH_DETAILS_KEY = 'carto.keyexpr.publish.details';
const PROFILE_STORAGE_KEY = 'carto.connectionProfiles';
const HISTORY_EVENT = 'carto.history.updated';
const SETTINGS_EVENT = 'carto.settings.imported';
const DEFAULT_RING_BUFFER = 200;
const MIN_RING_BUFFER = 10;
const MAX_RING_BUFFER = 5000;

const appInfo = pkg as {
  name?: string;
  version?: string;
  description?: string;
  author?: string;
  build?: { productName?: string };
};

const createId = () => {
  const cryptoObj = globalThis.crypto as { randomUUID?: () => string } | undefined;
  if (cryptoObj?.randomUUID) return cryptoObj.randomUUID();
  return `id-${Date.now()}-${Math.random().toString(16).slice(2)}`;
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
      publish?: string[];
      publishDetails?: Record<string, PublishDraft>;
    };
    connectionProfiles?: unknown;
  };
};

const App = () => {
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
    recentKeysFilter,
    setRecentKeysFilter,
    selectedMessages,
    connect,
    testConnection,
    disconnect,
    subscribe,
    unsubscribe,
    setPaused,
    clearBuffer,
    publish
  } = useCarto();

  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const prevStatusRef = useRef<ConnectionStatus | null>(null);
  const prevConnectedRef = useRef(status.connected);
  const [protoSchemas, setProtoSchemas] = useState<ProtoSchema[]>([]);
  const [subscriptionDecoders, setSubscriptionDecoders] = useState<
    Record<string, DecoderConfig | undefined>
  >({});

  const [selectedMessage, setSelectedMessage] = useState<CartoMessage | null>(null);
  const [copied, setCopied] = useState(false);
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
  const [showAbout, setShowAbout] = useState(false);

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((toast) => toast.id !== id));
    const timer = toastTimers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      toastTimers.current.delete(id);
    }
  }, []);

  const addToast = useCallback(
    (toast: ToastInput) => {
      const id = createId();
      const entry: Toast = { ...toast, id, ts: Date.now() };
      setToasts((prev) => {
        const next = [entry, ...prev];
        const trimmed = next.slice(0, MAX_TOASTS);
        const trimmedIds = new Set(trimmed.map((item) => item.id));
        for (const item of prev) {
          if (!trimmedIds.has(item.id)) {
            const timer = toastTimers.current.get(item.id);
            if (timer) clearTimeout(timer);
            toastTimers.current.delete(item.id);
          }
        }
        return trimmed;
      });

      const durationMs =
        toast.durationMs ?? (toast.type === 'error' ? ERROR_TOAST_MS : DEFAULT_TOAST_MS);
      if (durationMs > 0) {
        const timer = setTimeout(() => dismissToast(id), durationMs);
        toastTimers.current.set(id, timer);
      }
    },
    [dismissToast]
  );

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
        label: `${schema.name} • ${type.name}`,
        schemaName: schema.name
      }))
    );
  }, [protoSchemas]);

  const protoTypeById = useMemo(() => {
    const map = new Map<string, ProtoTypeHandle>();
    protoSchemas.forEach((schema) => {
      schema.types.forEach((type) => {
        map.set(type.id, { ...type, root: schema.root, schemaName: schema.name });
      });
    });
    return map;
  }, [protoSchemas]);

  const protoTypeLabels = useMemo(() => {
    const labels: Record<string, string> = {};
    protoTypeOptions.forEach((type) => {
      labels[type.id] = type.label;
    });
    return labels;
  }, [protoTypeOptions]);

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
    (name: string, source: string): boolean => {
      try {
        const schemaId = createId();
        const schema = parseProtoSchema(schemaId, name, source);
        setProtoSchemas((prev) => {
          const next = [schema, ...prev];
          persistProtoSchemas(next);
          return next;
        });
        addToast({ type: 'ok', message: 'Schema added', detail: name });
        addLog({ level: 'info', source: 'protobuf', message: `Schema added: ${name}.` });
        return true;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        addToast({ type: 'error', message: 'Failed to parse schema', detail: message });
        addLog({ level: 'error', source: 'protobuf', message });
        return false;
      }
    },
    [addLog, addToast, persistProtoSchemas]
  );

  const removeProtoSchema = useCallback(
    (schemaId: string) => {
      setProtoSchemas((prev) => {
        const next = prev.filter((schema) => schema.id !== schemaId);
        persistProtoSchemas(next);
        return next;
      });
      setSubscriptionDecoders((prev) => {
        const next = { ...prev };
        Object.entries(next).forEach(([key, decoder]) => {
          if (decoder?.kind === 'protobuf' && decoder.typeId.startsWith(`${schemaId}:`)) {
            next[key] = { kind: 'raw' };
          }
        });
        return next;
      });
      addToast({ type: 'info', message: 'Schema removed' });
      addLog({ level: 'info', source: 'protobuf', message: 'Schema removed.' });
    },
    [addLog, addToast, persistProtoSchemas]
  );

  const decodeProtobuf = useCallback(
    (decoder: DecoderConfig | undefined, base64: string | undefined) => {
      if (!decoder || decoder.kind !== 'protobuf' || !base64) return null;
      const handle = protoTypeById.get(decoder.typeId);
      if (!handle) {
        return { error: 'Protobuf type is no longer available.' };
      }
      try {
        const bytes = base64ToBytes(base64);
        const decoded = decodeProtoPayload(handle, bytes);
        return { data: decoded, label: handle.name, schemaName: handle.schemaName };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { error: message };
      }
    },
    [protoTypeById]
  );

  useEffect(() => {
    setSelectedMessage(null);
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
  const selectedDecoder = selectedSubId ? subscriptionDecoders[selectedSubId] : undefined;
  const protoResult = useMemo(
    () => decodeProtobuf(selectedDecoder, selectedMessage?.base64),
    [decodeProtobuf, selectedDecoder, selectedMessage?.base64]
  );
  const streamTitle = selectedSub ? `Stream - ${selectedSub.keyexpr}` : 'Stream';
  const activeKeys = recentKeys;
  const [view, setView] = useState<'monitor' | 'publish' | 'connection' | 'logs' | 'settings'>(
    status.connected ? 'monitor' : 'connection'
  );
  const [monitorTab, setMonitorTab] = useState<'stream' | 'keys'>('stream');

  useEffect(() => {
    const wasConnected = prevConnectedRef.current;
    prevConnectedRef.current = status.connected;
    if (
      !status.connected &&
      status.health?.state === 'disconnected' &&
      view !== 'logs' &&
      view !== 'settings'
    ) {
      setView('connection');
      return;
    }
    if (!wasConnected && status.connected && view === 'connection') {
      setView('monitor');
    }
  }, [status.connected, status.health?.state, view]);

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

  const exportSettings = useCallback((): SettingsExport => {
    const subscribeHistory = readStringArray(
      'localStorage' in globalThis ? globalThis.localStorage.getItem(SUBSCRIBE_HISTORY_KEY) : null
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
            protoTypeId: entry.protoTypeId
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
          publish: publishHistory,
          publishDetails
        },
        connectionProfiles
      }
    };
  }, [protoSchemas, readStringArray, ringBufferSize, theme]);

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
          const existingKeys = new Set(existing.map((schema) => `${schema.name}::${schema.source}`));
          const merged = [...existing];
          nextSchemas.forEach((schema) => {
            const key = `${schema.name}::${schema.source}`;
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
          const nextEntries = record.subscribe.filter((entry) => typeof entry === 'string') as string[];
          if ('localStorage' in globalThis) {
            const current = mode === 'merge' ? readStringArray(globalThis.localStorage.getItem(SUBSCRIBE_HISTORY_KEY)) : [];
            const merged = mode === 'merge' ? mergeStringArrays(nextEntries, current) : nextEntries;
            globalThis.localStorage.setItem(SUBSCRIBE_HISTORY_KEY, JSON.stringify(merged));
          }
          if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent(HISTORY_EVENT, { detail: { type: 'subscribe' } }));
          }
        }
        if (Array.isArray(record.publish)) {
          const nextEntries = record.publish.filter((entry) => typeof entry === 'string') as string[];
          if ('localStorage' in globalThis) {
            const current = mode === 'merge' ? readStringArray(globalThis.localStorage.getItem(PUBLISH_HISTORY_KEY)) : [];
            const merged = mode === 'merge' ? mergeStringArrays(nextEntries, current) : nextEntries;
            globalThis.localStorage.setItem(PUBLISH_HISTORY_KEY, JSON.stringify(merged));
          }
          if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent(HISTORY_EVENT, { detail: { type: 'publish' } }));
          }
        }
        if (record.publishDetails && typeof record.publishDetails === 'object') {
          const next: Record<string, PublishDraft> = {};
          Object.entries(record.publishDetails as Record<string, unknown>).forEach(([key, value]) => {
            if (!value || typeof value !== 'object') return;
            const entry = value as PublishDraft;
            if (typeof entry.encoding !== 'string' || typeof entry.payload !== 'string') return;
            next[key] = {
              keyexpr: key,
              encoding: entry.encoding,
              payload: entry.payload,
              protoTypeId: entry.protoTypeId
            };
          });
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
              if (entry && typeof entry === 'object' && typeof (entry as { id?: string }).id === 'string') {
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
      parseProtoSchema,
      persistProtoSchemas,
      protoSchemas,
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

  useEffect(() => {
    const timers = toastTimers.current;
    return () => {
      timers.forEach((timer) => clearTimeout(timer));
      timers.clear();
    };
  }, []);

  const publishSupport = useMemo<'supported' | 'unknown' | 'unsupported'>(() => {
    const features = status.capabilities?.features;
    if (!features || features.length === 0) return 'unknown';
    return features.includes('publish') ? 'supported' : 'unsupported';
  }, [status.capabilities]);

  const viewTitle = useMemo(() => {
    switch (view) {
      case 'monitor':
        return 'Monitor';
      case 'publish':
        return 'Publish';
      case 'logs':
        return 'Logs';
      case 'settings':
        return 'Settings';
      default:
        return 'Connection';
    }
  }, [view]);

  const viewDescription = useMemo(() => {
    if (view === 'monitor') {
      return selectedSub
        ? `Streaming ${selectedSub.keyexpr}`
        : 'Pick a subscription to start streaming.';
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
    if (view === 'logs') {
      return 'Connection events and errors.';
    }
    if (view === 'settings') {
      return 'Defaults for new subscriptions.';
    }
    return status.connected ? 'Connected to the router.' : 'Configure and connect to a router.';
  }, [publishSupport, selectedSub, status.connected, view]);

  const canCopyEndpoint =
    typeof navigator !== 'undefined' && typeof navigator.clipboard?.writeText === 'function';
  const endpointLabel = lastEndpoint || 'Not set';
  const endpointTitle = lastEndpoint || 'No endpoint yet';
  const recentKeyexpr = recentKeys[0]?.key;
  const selectedKeyexpr = selectedSub?.keyexpr;
  const useKeyexprLabel = selectedKeyexpr ? 'Use stream key' : 'Use recent key';
  const canUseKeyexpr = Boolean(selectedKeyexpr ?? recentKeyexpr);
  const useKeyexprTitle = canUseKeyexpr
    ? `${useKeyexprLabel}: ${selectedKeyexpr ?? recentKeyexpr ?? ''}`
    : 'No keys available yet';
  const handleCopyEndpoint = useCallback(async () => {
    if (!lastEndpoint || !canCopyEndpoint) return;
    try {
      await navigator.clipboard.writeText(lastEndpoint);
      setCopied(true);
    } catch {
      // ignore clipboard errors
    }
  }, [canCopyEndpoint, lastEndpoint]);

  const handlePublish = useCallback(
    async (
      keyexpr: string,
      payload: string,
      encoding: PublishDraft['encoding'],
      protoTypeId?: string
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
        await publish(keyexpr, encoded, 'base64');
        setLastPublish({ keyexpr, payload, encoding, protoTypeId });
        return;
      }
      await publish(keyexpr, payload, encoding);
      setLastPublish({ keyexpr, payload, encoding });
    },
    [protoTypeById, publish]
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
    if (!selectedSub || !status.connected) return;
    await setPaused(selectedSub.id, !selectedSub.paused);
  }, [selectedSub, setPaused, status.connected]);

  const handleClearBuffer = useCallback(async () => {
    if (!selectedSub || !status.connected) return;
    await clearBuffer(selectedSub.id);
  }, [clearBuffer, selectedSub, status.connected]);

  const handleDisconnect = useCallback(async () => {
    try {
      await disconnect();
      setSubscriptionDecoders({});
    } catch {
      // ignore disconnect errors
      const message = 'Disconnect failed.';
      addToast({ type: 'error', message });
      addLog({ level: 'error', source: 'connection', message });
    }
  }, [addLog, addToast, disconnect]);

  const handleUseKeyexpr = useCallback(() => {
    const nextKeyexpr = selectedKeyexpr ?? recentKeyexpr;
    if (!nextKeyexpr) return;
    setPublishDraft((current) => ({ ...current, keyexpr: nextKeyexpr }));
  }, [recentKeyexpr, selectedKeyexpr]);

  const handleLoadLastPublish = useCallback(() => {
    if (!lastPublish) return;
    setPublishDraft({ ...lastPublish });
  }, [lastPublish]);

  const handleReplayLast = useCallback(async () => {
    if (!lastPublish || !status.connected) return;
    try {
      await handlePublish(
        lastPublish.keyexpr,
        lastPublish.payload,
        lastPublish.encoding,
        lastPublish.protoTypeId
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
        setView('logs');
        return;
      }
      if (event.code === 'Digit5') {
        event.preventDefault();
        setView('settings');
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

  return (
    <div className="app">
      <div className="app_frame">
        <AppRail
          theme={theme}
          view={view}
          connected={status.connected}
          onSetView={setView}
          onToggleTheme={() => setTheme((current) => (current === 'dark' ? 'light' : 'dark'))}
          onShowAbout={() => setShowAbout(true)}
        />

        <div className="app_shell">
          <AppHeader
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
            view={view}
            selectedSub={selectedSub}
            onTogglePause={handleTogglePause}
            onClearBuffer={handleClearBuffer}
            onUseKeyexpr={handleUseKeyexpr}
            useKeyexprLabel={useKeyexprLabel}
            useKeyexprTitle={useKeyexprTitle}
            canUseKeyexpr={canUseKeyexpr}
            onLoadLastPublish={handleLoadLastPublish}
            lastPublish={lastPublish}
            onReplayLast={handleReplayLast}
            actionNotice={actionNotice}
            onDisconnect={handleDisconnect}
          />

          <div className="app_body">
            {view === 'monitor' ? (
              <MonitorView
                connected={status.connected}
                subscriptions={subscriptions}
                selectedSubId={selectedSubId}
                setSelectedSubId={setSelectedSubId}
                selectedMessages={selectedMessages}
                selectedRecentKeys={selectedRecentKeys}
                recentKeysFilter={recentKeysFilter}
                setRecentKeysFilter={setRecentKeysFilter}
                streamTitle={streamTitle}
                monitorTab={monitorTab}
                setMonitorTab={setMonitorTab}
                showSubscribe={showSubscribe}
                setShowSubscribe={setShowSubscribe}
                onSubscribe={handleSubscribe}
                onUnsubscribe={handleUnsubscribe}
                onPause={setPaused}
                onClear={clearBuffer}
                onSelectMessage={setSelectedMessage}
                onLog={addLog}
                onToast={addToast}
                protoTypes={protoTypeOptions}
                decoderById={subscriptionDecoders}
                selectedDecoder={selectedDecoder}
                decodeProtobuf={decodeProtobuf}
                protoTypeLabels={protoTypeLabels}
              />
            ) : null}

            {view === 'publish' ? (
              <PublishView
                connected={status.connected}
                publishSupport={publishSupport}
                draft={publishDraft}
                onDraftChange={setPublishDraft}
                onPublish={handlePublish}
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
                onConnect={connect}
                onTestConnection={testConnection}
                onDisconnect={handleDisconnect}
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

            {view === 'logs' ? <LogsView logs={logs} onClearLogs={clearLogs} /> : null}
          </div>
        </div>
      </div>

      <MessageDrawer
        message={selectedMessage}
        protoResult={protoResult}
        onClose={() => setSelectedMessage(null)}
      />
      <AboutDialog
        open={showAbout}
        appName={appInfo.build?.productName ?? appInfo.name ?? 'Carto'}
        version={appInfo.version ?? '0.0.0'}
        description={appInfo.description}
        author={appInfo.author}
        onClose={() => setShowAbout(false)}
      />
      {toasts.length > 0 ? <ToastStack toasts={toasts} onDismiss={dismissToast} /> : null}
    </div>
  );
};

export default App;
