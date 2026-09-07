import { DisclosureSection } from './DisclosureSection';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter
} from './ui/dialog';
import { Cable, BookmarkPlus, ArrowRight, CheckCircle2 } from 'lucide-react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from './ui/tabs';
import { Switch } from './ui/switch';
import { Textarea } from './ui/textarea';
import { NativeSelect } from './ui/native-select';
import { Button } from './ui/button';
import { Button as BaseButton } from '@base-ui/react/button';
import { Input } from './ui/input';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  AuthConfig,
  ConnectionStatus,
  ConnectionTestParams,
  ConnectionTestResult,
  ConnectParams,
  ConnectionHealth,
  ReconnectConfig,
  TlsConfig
} from '@shared/types';
import type { LogInput, ToastInput } from '../utils/notifications';
import { IconChevronDown, IconClose, IconTrash } from './Icons';

const DEFAULT_ENDPOINT = (() => {
  return 'ws://127.0.0.1:10000/';
})();
const PROFILE_STORAGE_KEY = 'carto.connectionProfiles';
const ENDPOINT_HISTORY_KEY = 'carto.endpoint.history';
const MAX_ENDPOINT_HISTORY = 8;
const SETTINGS_EVENT = 'carto.settings.imported';
const DEFAULT_HEALTH_INTERVAL_MS = '5000';
const DEFAULT_RECONNECT_BASE_DELAY_MS = '1000';
const DEFAULT_RECONNECT_MAX_DELAY_MS = '15000';
const DEFAULT_TEST_TIMEOUT_MS = '6000';

type ConnectPanelProps = {
  status: ConnectionStatus;
  defaultEndpoint?: string;
  onConnect: (params: ConnectParams) => Promise<void>;
  onTestConnection: (params: ConnectionTestParams) => Promise<ConnectionTestResult>;
  onLog: (entry: LogInput) => void;
  onToast: (toast: ToastInput) => void;
};

type ConnectionProfile = {
  id: string;
  name: string;
  endpoint: string;
  configJson?: string;
  auth?: Pick<AuthConfig, 'type' | 'username' | 'headerName'>;
  tls?: TlsConfig;
  reconnect?: ReconnectConfig;
  healthCheckIntervalMs?: number;
  updatedAt: number;
};

type ConnectionOptionsTab = 'security' | 'reliability' | 'advanced';

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
};

const optionalString = (value: unknown): string | undefined => {
  return typeof value === 'string' ? value : undefined;
};

const optionalNumber = (value: unknown): number | undefined => {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
};

const parseStoredAuth = (
  value: unknown
): Pick<AuthConfig, 'type' | 'username' | 'headerName'> | undefined => {
  if (!isRecord(value)) return undefined;
  const type = value.type;
  if (type !== 'none' && type !== 'basic' && type !== 'bearer' && type !== 'header') {
    return undefined;
  }
  return {
    type,
    username: optionalString(value.username),
    headerName: optionalString(value.headerName)
  };
};

const parseStoredTls = (value: unknown): TlsConfig | undefined => {
  if (!isRecord(value)) return undefined;
  return {
    caPath: optionalString(value.caPath),
    certPath: optionalString(value.certPath),
    keyPath: optionalString(value.keyPath),
    rejectUnauthorized:
      typeof value.rejectUnauthorized === 'boolean' ? value.rejectUnauthorized : undefined
  };
};

const parseStoredReconnect = (value: unknown): ReconnectConfig | undefined => {
  if (!isRecord(value) || typeof value.enabled !== 'boolean') return undefined;
  return {
    enabled: value.enabled,
    baseDelayMs: optionalNumber(value.baseDelayMs),
    maxDelayMs: optionalNumber(value.maxDelayMs),
    maxAttempts: optionalNumber(value.maxAttempts),
    jitter: typeof value.jitter === 'boolean' ? value.jitter : undefined
  };
};

const buildId = () => {
  const cryptoObj = globalThis.crypto as { randomUUID?: () => string } | undefined;
  if (cryptoObj?.randomUUID) return cryptoObj.randomUUID();
  return `profile-${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

const parseProfiles = (raw: string | null): ConnectionProfile[] => {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((entry) => {
        if (!entry || typeof entry !== 'object') return null;
        const record = entry as Record<string, unknown>;
        if (typeof record.id !== 'string' || typeof record.name !== 'string') return null;
        if (typeof record.endpoint !== 'string') return null;
        const profile: ConnectionProfile = {
          id: record.id,
          name: record.name,
          endpoint: record.endpoint,
          updatedAt: typeof record.updatedAt === 'number' ? record.updatedAt : Date.now()
        };
        if (typeof record.configJson === 'string') {
          profile.configJson = record.configJson;
        }
        profile.auth = parseStoredAuth(record.auth);
        profile.tls = parseStoredTls(record.tls);
        profile.reconnect = parseStoredReconnect(record.reconnect);
        profile.healthCheckIntervalMs = optionalNumber(record.healthCheckIntervalMs);
        return profile;
      })
      .filter((entry): entry is ConnectionProfile => entry !== null);
  } catch {
    return [];
  }
};

const parseEndpointHistory = (raw: string | null): string[] => {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry): entry is string => typeof entry === 'string');
  } catch {
    return [];
  }
};

const mergeHistory = (base: string[], add: string[]) => {
  const combined = [...add, ...base];
  const seen = new Set<string>();
  const next: string[] = [];
  for (const entry of combined) {
    if (!entry) continue;
    if (!seen.has(entry)) {
      seen.add(entry);
      next.push(entry);
    }
  }
  return next.slice(0, MAX_ENDPOINT_HISTORY);
};

const persistEndpointHistory = (entries: string[]) => {
  if ('localStorage' in globalThis) {
    globalThis.localStorage.setItem(ENDPOINT_HISTORY_KEY, JSON.stringify(entries));
  }
};

const parseOptionalNumber = (value: string): number | undefined => {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const buildAuthConfig = (
  type: AuthConfig['type'],
  username: string,
  password: string,
  token: string,
  headerName: string,
  headerValue: string
): AuthConfig | undefined => {
  if (type === 'none') return undefined;
  if (type === 'basic') {
    return {
      type,
      username: username.trim() || undefined,
      password: password || undefined
    };
  }
  if (type === 'bearer') {
    return {
      type,
      token: token.trim() || undefined
    };
  }
  return {
    type: 'header',
    headerName: headerName.trim() || undefined,
    headerValue: headerValue || undefined
  };
};

const buildTlsConfig = (
  caPath: string,
  certPath: string,
  keyPath: string,
  rejectUnauthorized: boolean
): TlsConfig | undefined => {
  const trimmedCa = caPath.trim();
  const trimmedCert = certPath.trim();
  const trimmedKey = keyPath.trim();
  const hasTlsInfo = Boolean(trimmedCa || trimmedCert || trimmedKey || !rejectUnauthorized);
  if (!hasTlsInfo) return undefined;
  return {
    caPath: trimmedCa || undefined,
    certPath: trimmedCert || undefined,
    keyPath: trimmedKey || undefined,
    rejectUnauthorized
  };
};

const buildReconnectConfig = (
  enabled: boolean,
  baseDelay: string,
  maxDelay: string,
  maxAttempts: string,
  jitter: boolean
): ReconnectConfig => {
  if (!enabled) return { enabled: false };
  return {
    enabled: true,
    baseDelayMs: parseOptionalNumber(baseDelay),
    maxDelayMs: parseOptionalNumber(maxDelay),
    maxAttempts: parseOptionalNumber(maxAttempts),
    jitter
  };
};

const formatHealthState = (health?: ConnectionHealth, connected?: boolean) => {
  const state = health?.state ?? (connected ? 'connected' : 'disconnected');
  const labelMap: Record<ConnectionHealth['state'], string> = {
    connected: 'Connected',
    connecting: 'Connecting',
    reconnecting: 'Reconnecting',
    disconnected: 'Offline'
  };
  return {
    state,
    label: labelMap[state]
  };
};

const ConnectPanel = ({
  status,
  defaultEndpoint,
  onConnect,
  onTestConnection,
  onLog,
  onToast
}: ConnectPanelProps) => {
  const [endpoint, setEndpoint] = useState(defaultEndpoint ?? DEFAULT_ENDPOINT);
  const [endpointHistory, setEndpointHistory] = useState<string[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const comboRef = useRef<HTMLDivElement | null>(null);
  const endpointInputRef = useRef<HTMLInputElement | null>(null);
  const historyRef = useRef<string[]>([]);
  const suppressHistoryOpenRef = useRef(false);
  const [configJson, setConfigJson] = useState('');
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const [profiles, setProfiles] = useState<ConnectionProfile[]>([]);
  const [selectedProfileId, setSelectedProfileId] = useState('');
  const [profileName, setProfileName] = useState('');
  const [profileError, setProfileError] = useState<string | null>(null);

  const [authType, setAuthType] = useState<AuthConfig['type']>('none');
  const [authUsername, setAuthUsername] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authToken, setAuthToken] = useState('');
  const [authHeaderName, setAuthHeaderName] = useState('');
  const [authHeaderValue, setAuthHeaderValue] = useState('');

  const [tlsCaPath, setTlsCaPath] = useState('');
  const [tlsCertPath, setTlsCertPath] = useState('');
  const [tlsKeyPath, setTlsKeyPath] = useState('');
  const [tlsVerify, setTlsVerify] = useState(true);

  const [reconnectEnabled, setReconnectEnabled] = useState(true);
  const [reconnectBaseDelay, setReconnectBaseDelay] = useState(DEFAULT_RECONNECT_BASE_DELAY_MS);
  const [reconnectMaxDelay, setReconnectMaxDelay] = useState(DEFAULT_RECONNECT_MAX_DELAY_MS);
  const [reconnectMaxAttempts, setReconnectMaxAttempts] = useState('');
  const [reconnectJitter, setReconnectJitter] = useState(true);
  const [healthInterval, setHealthInterval] = useState(DEFAULT_HEALTH_INTERVAL_MS);

  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [testRunning, setTestRunning] = useState(false);
  const [testResult, setTestResult] = useState<ConnectionTestResult | null>(null);
  const [activeOptionsTab, setActiveOptionsTab] = useState<ConnectionOptionsTab>('security');

  useEffect(() => {
    setTestResult(null);
  }, [
    endpoint,
    configJson,
    authType,
    authUsername,
    authPassword,
    authToken,
    authHeaderName,
    authHeaderValue,
    tlsCaPath,
    tlsCertPath,
    tlsKeyPath,
    tlsVerify
  ]);

  useEffect(() => {
    if (!defaultEndpoint) return;
    setEndpoint((current) =>
      current === DEFAULT_ENDPOINT || !current.trim() ? defaultEndpoint : current
    );
  }, [defaultEndpoint]);

  useEffect(() => {
    if (!('localStorage' in globalThis)) return;
    const stored = globalThis.localStorage.getItem(PROFILE_STORAGE_KEY);
    setProfiles(parseProfiles(stored));
  }, []);

  const applyHistory = useCallback((entries: string[]) => {
    historyRef.current = entries;
    setEndpointHistory(entries);
  }, []);

  const commitHistory = useCallback(
    (entries: string[]) => {
      applyHistory(entries);
      persistEndpointHistory(entries);
    },
    [applyHistory]
  );

  const handleRemoveHistory = useCallback(
    (entry: string) => {
      commitHistory(historyRef.current.filter((item) => item !== entry));
    },
    [commitHistory]
  );

  useEffect(() => {
    if (!('localStorage' in globalThis)) return;
    const stored = globalThis.localStorage.getItem(ENDPOINT_HISTORY_KEY);
    applyHistory(parseEndpointHistory(stored));
  }, [applyHistory]);

  useEffect(() => {
    if (!showHistory) return;
    const handlePointerDown = (event: MouseEvent) => {
      if (!comboRef.current) return;
      if (comboRef.current.contains(event.target as Node)) return;
      setShowHistory(false);
    };
    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [showHistory]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handleSettingsImport = (event: Event) => {
      const detail = (event as CustomEvent<{ type?: string }>).detail;
      if (detail?.type && detail.type !== 'connectionProfiles') return;
      if (!('localStorage' in globalThis)) return;
      const stored = globalThis.localStorage.getItem(PROFILE_STORAGE_KEY);
      const next = parseProfiles(stored);
      setProfiles(next);
      setSelectedProfileId((current) => {
        if (current && next.some((entry) => entry.id === current)) return current;
        setProfileName('');
        return '';
      });
    };
    window.addEventListener(SETTINGS_EVENT, handleSettingsImport as EventListener);
    return () => window.removeEventListener(SETTINGS_EVENT, handleSettingsImport as EventListener);
  }, []);

  useEffect(() => {
    if (!selectedProfileId) return;
    const profile = profiles.find((entry) => entry.id === selectedProfileId);
    if (!profile) return;
    setEndpoint(profile.endpoint);
    setConfigJson(profile.configJson ?? '');
    setProfileName(profile.name);
    setAuthType(profile.auth?.type ?? 'none');
    setAuthUsername(profile.auth?.username ?? '');
    setAuthPassword('');
    setAuthToken('');
    setAuthHeaderName(profile.auth?.headerName ?? '');
    setAuthHeaderValue('');
    setTlsCaPath(profile.tls?.caPath ?? '');
    setTlsCertPath(profile.tls?.certPath ?? '');
    setTlsKeyPath(profile.tls?.keyPath ?? '');
    setTlsVerify(profile.tls?.rejectUnauthorized ?? true);
    setReconnectEnabled(profile.reconnect?.enabled ?? true);
    setReconnectBaseDelay(
      String(profile.reconnect?.baseDelayMs ?? DEFAULT_RECONNECT_BASE_DELAY_MS)
    );
    setReconnectMaxDelay(String(profile.reconnect?.maxDelayMs ?? DEFAULT_RECONNECT_MAX_DELAY_MS));
    setReconnectMaxAttempts(
      profile.reconnect?.maxAttempts === undefined ? '' : String(profile.reconnect.maxAttempts)
    );
    setReconnectJitter(profile.reconnect?.jitter ?? true);
    setHealthInterval(String(profile.healthCheckIntervalMs ?? DEFAULT_HEALTH_INTERVAL_MS));
  }, [profiles, selectedProfileId]);

  useEffect(() => {
    if (!status.connected) return;
    setBusy(false);
    setLocalError(null);
  }, [status.connected]);

  const saveProfiles = (nextProfiles: ConnectionProfile[]) => {
    setProfiles(nextProfiles);
    if (!('localStorage' in globalThis)) return;
    globalThis.localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(nextProfiles));
  };

  const handleSaveProfile = () => {
    if (!endpoint.trim()) {
      setProfileError('Enter an endpoint first.');
      return;
    }
    const name = profileName.trim();
    if (!name) {
      setProfileError('Profile name is required.');
      return;
    }

    const id = selectedProfileId || buildId();
    const auth = buildAuthConfig(authType, authUsername, '', '', authHeaderName, '');
    const tls = buildTlsConfig(tlsCaPath, tlsCertPath, tlsKeyPath, tlsVerify);
    const reconnect = buildReconnectConfig(
      reconnectEnabled,
      reconnectBaseDelay,
      reconnectMaxDelay,
      reconnectMaxAttempts,
      reconnectJitter
    );
    const profile: ConnectionProfile = {
      id,
      name,
      endpoint: endpoint.trim(),
      configJson: configJson.trim() || undefined,
      auth,
      tls,
      reconnect,
      healthCheckIntervalMs: parseOptionalNumber(healthInterval),
      updatedAt: Date.now()
    };

    const withoutCurrent = profiles.filter((entry) => entry.id !== id);
    const nextProfiles = [profile, ...withoutCurrent].sort((a, b) => b.updatedAt - a.updatedAt);
    saveProfiles(nextProfiles);
    setSelectedProfileId(id);
    setProfileError(null);
    setSaveDialogOpen(false);
  };

  const handleDeleteProfile = () => {
    if (!selectedProfileId) return;
    const nextProfiles = profiles.filter((entry) => entry.id !== selectedProfileId);
    saveProfiles(nextProfiles);
    setSelectedProfileId('');
    setProfileName('');
  };

  const handleConnect = async () => {
    const trimmedEndpoint = endpoint.trim();
    if (!trimmedEndpoint) {
      setLocalError('Endpoint is required.');
      return;
    }

    setBusy(true);
    setLocalError(null);
    try {
      const auth = buildAuthConfig(
        authType,
        authUsername,
        authPassword,
        authToken,
        authHeaderName,
        authHeaderValue
      );
      const tls = buildTlsConfig(tlsCaPath, tlsCertPath, tlsKeyPath, tlsVerify);
      const reconnect = buildReconnectConfig(
        reconnectEnabled,
        reconnectBaseDelay,
        reconnectMaxDelay,
        reconnectMaxAttempts,
        reconnectJitter
      );
      const params: ConnectParams = {
        discovery: {
          enabled: true,
          keyexpr: '**',
          durationSeconds: 15
        },
        endpoint: trimmedEndpoint,
        configJson: configJson.trim() || undefined,
        auth,
        tls,
        reconnect,
        healthCheckIntervalMs: parseOptionalNumber(healthInterval)
      };

      await onConnect(params);
      commitHistory(mergeHistory(historyRef.current, [trimmedEndpoint]));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setLocalError(message);
    } finally {
      setBusy(false);
    }
  };

  const handleTestConnection = async () => {
    const trimmedEndpoint = endpoint.trim();
    if (!trimmedEndpoint) {
      setTestResult({
        ok: false,
        durationMs: 0,
        error: 'Endpoint is required.'
      });
      return;
    }

    const startedAt = Date.now();
    setTestRunning(true);
    setTestResult(null);
    try {
      const auth = buildAuthConfig(
        authType,
        authUsername,
        authPassword,
        authToken,
        authHeaderName,
        authHeaderValue
      );
      const tls = buildTlsConfig(tlsCaPath, tlsCertPath, tlsKeyPath, tlsVerify);
      const params: ConnectionTestParams = {
        endpoint: trimmedEndpoint,
        configJson: configJson.trim() || undefined,
        auth,
        tls,
        timeoutMs: Number(DEFAULT_TEST_TIMEOUT_MS)
      };

      const result = await onTestConnection(params);
      setTestResult(result);
      if (!result.ok) {
        const message = result.error ?? 'Test connection failed.';
        const detail = result.hint;
        onToast({
          type: 'error',
          message: 'Test connection failed',
          detail: detail ? `${message} ${detail}` : message
        });
        onLog({
          level: 'error',
          source: 'diagnostics',
          message,
          detail
        });
      } else {
        onLog({ level: 'info', source: 'diagnostics', message: 'Test connection succeeded.' });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setTestResult({
        ok: false,
        durationMs: Date.now() - startedAt,
        error: message
      });
      onToast({ type: 'error', message: 'Test connection failed', detail: message });
      onLog({ level: 'error', source: 'diagnostics', message });
    } finally {
      setTestRunning(false);
    }
  };

  const healthInfo = useMemo(() => {
    const { state, label } = formatHealthState(status.health, status.connected);
    const retryIn = status.health?.nextRetryMs;
    const attempt = status.health?.attempt;

    let detail = '';
    if (state === 'reconnecting' && retryIn) {
      detail = `Retrying in ${Math.round(retryIn / 1000)}s`;
    }
    if (state === 'reconnecting' && attempt) {
      detail = detail ? `${detail} (attempt ${attempt})` : `Attempt ${attempt}`;
    }

    return {
      state,
      label,
      detail
    };
  }, [status.connected, status.health]);

  const testSummary = useMemo(() => {
    if (!testResult) return null;
    const duration = `${Math.round(testResult.durationMs)}ms`;
    if (testResult.ok) {
      return `Success in ${duration}`;
    }
    return `Failed in ${duration}`;
  }, [testResult]);

  const optionsLocked = busy || testRunning || status.connected;

  return (
    <section className="mx-auto my-10 w-full max-w-3xl space-y-7 px-6 pb-8 text-foreground max-sm:my-6 max-sm:px-4">
      <header className="space-y-3">
        <span className="inline-flex size-10 items-center justify-center rounded-xl border bg-card text-primary">
          <Cable className="size-5" />
        </span>
        <h2 className="text-2xl font-semibold tracking-tight">
          {status.connected ? 'Your connection' : 'Connect to Zenoh'}
        </h2>
        <p className="text-sm text-muted-foreground">
          {status.connected
            ? 'Disconnect to edit this connection.'
            : 'Enter your router’s WebSocket address to start inspecting traffic.'}
        </p>
      </header>

      <div className="space-y-5 rounded-2xl border bg-card p-5 sm:p-6">
        {profiles.length > 0 && (
          <label className="flex flex-col gap-2 text-sm font-medium">
            Saved connection
            <NativeSelect
              value={selectedProfileId}
              onChange={(event) => setSelectedProfileId(event.target.value)}
              disabled={optionsLocked}
            >
              <option value="">Custom connection</option>
              {profiles.map((profile) => (
                <option key={profile.id} value={profile.id}>
                  {profile.name}
                </option>
              ))}
            </NativeSelect>
          </label>
        )}
        <div className="flex items-end gap-3 max-sm:flex-col max-sm:items-stretch">
          <label className="flex min-w-0 flex-1 flex-col gap-2 text-sm font-medium">
            <span>Remote API endpoint</span>
            <div className="combo" ref={comboRef}>
              <Input
                ref={endpointInputRef}
                className="combo_input h-11 rounded-xl font-mono"
                type="text"
                value={endpoint}
                onChange={(event) => {
                  setEndpoint(event.target.value);
                  setLocalError(null);
                }}
                onFocus={() => {
                  if (suppressHistoryOpenRef.current) {
                    suppressHistoryOpenRef.current = false;
                    return;
                  }
                  if (endpointHistory.length > 0) setShowHistory(true);
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !showHistory && !optionsLocked) {
                    event.preventDefault();
                    void handleConnect();
                  }
                }}
                placeholder={DEFAULT_ENDPOINT}
                disabled={optionsLocked}
              />
              <BaseButton
                className="combo_toggle"
                type="button"
                onClick={() => setShowHistory((prev) => !prev)}
                aria-label="Toggle endpoint history"
                disabled={optionsLocked}
              >
                <span className="combo_icon" aria-hidden="true">
                  <IconChevronDown />
                </span>
              </BaseButton>
              {showHistory ? (
                <div className="combo_menu" role="listbox">
                  {endpointHistory.length === 0 ? (
                    <div className="combo_empty">No recent endpoints yet.</div>
                  ) : (
                    endpointHistory.map((entry) => (
                      <div key={entry} className="combo_option">
                        <BaseButton
                          className="combo_option_button"
                          type="button"
                          role="option"
                          onClick={() => {
                            setEndpoint(entry);
                            setLocalError(null);
                            setShowHistory(false);
                            suppressHistoryOpenRef.current = true;
                            endpointInputRef.current?.focus();
                          }}
                        >
                          {entry}
                        </BaseButton>
                        <Button
                          variant="outline"
                          size="icon-sm"
                          className="icon-button icon-button--compact icon-button--ghost combo_option_remove"
                          type="button"
                          title={`Remove ${entry}`}
                          aria-label={`Remove ${entry} from history`}
                          onClick={() => handleRemoveHistory(entry)}
                        >
                          <span className="icon-button_icon" aria-hidden="true">
                            <IconClose />
                          </span>
                        </Button>
                      </div>
                    ))
                  )}
                </div>
              ) : null}
            </div>
          </label>
          {!status.connected && (
            <Button
              className="h-11 rounded-xl px-5"
              disabled={busy || testRunning || !endpoint.trim()}
              onClick={handleConnect}
            >
              {busy ? 'Connecting…' : 'Connect'}
              <ArrowRight className="size-4" />
            </Button>
          )}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Button
            variant="ghost"
            size="sm"
            className="-ml-2 text-muted-foreground"
            disabled={busy || testRunning || !endpoint.trim()}
            onClick={() => void handleTestConnection()}
          >
            {testRunning ? 'Testing…' : 'Test connection'}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="-mr-2 text-muted-foreground"
            disabled={optionsLocked || !endpoint.trim()}
            onClick={() => {
              setProfileError(null);
              setSaveDialogOpen(true);
            }}
          >
            <BookmarkPlus />
            {selectedProfileId ? 'Edit saved connection' : 'Save connection'}
          </Button>
        </div>
        {testResult && (
          <div
            role={testResult.ok ? 'status' : 'alert'}
            className={
              testResult.ok
                ? 'flex items-start gap-2 rounded-lg bg-primary/5 p-3 text-xs text-primary'
                : 'rounded-lg bg-destructive/10 p-3 text-xs text-destructive'
            }
          >
            {testResult.ok && <CheckCircle2 className="size-4 shrink-0" />}
            <div>
              {testResult.ok ? testSummary : (testResult.error ?? 'Connection test failed.')}
              {testResult.hint && <p className="mt-1">{testResult.hint}</p>}
            </div>
          </div>
        )}
        {!status.connected && (
          <p className="text-xs text-muted-foreground">
            Carto will discover active keys automatically after connecting.
          </p>
        )}
      </div>
      {healthInfo.detail && (
        <p role="status" className="text-sm text-muted-foreground">
          {healthInfo.detail}
        </p>
      )}
      {(localError || status.error) && (
        <p role="alert" className="rounded-xl bg-destructive/10 p-4 text-sm text-destructive">
          {localError || status.error}
        </p>
      )}

      <DisclosureSection
        title="Advanced settings"
        description={
          [
            authType !== 'none' ? 'Authentication configured' : '',
            tlsCaPath || tlsCertPath || tlsKeyPath || !tlsVerify ? 'Custom TLS' : '',
            !reconnectEnabled ? 'Auto-reconnect off' : '',
            configJson.trim() ? 'Custom configuration' : ''
          ]
            .filter(Boolean)
            .join(' · ') || 'Security, automatic reconnect, and custom configuration'
        }
      >
        {status.connected && (
          <p className="mb-4 text-xs text-muted-foreground">Disconnect to change these settings.</p>
        )}
        <Tabs
          value={activeOptionsTab}
          onValueChange={(value) => setActiveOptionsTab(value as ConnectionOptionsTab)}
          className="min-w-0 gap-6"
        >
          <TabsList
            className="grid w-full grid-cols-3 gap-1 rounded-xl p-1 group-data-horizontal/tabs:h-auto"
            aria-label="Advanced connection settings"
          >
            <TabsTrigger
              value="security"
              className="h-10 min-w-0 rounded-lg px-2 text-xs sm:text-sm"
            >
              Security
            </TabsTrigger>
            <TabsTrigger
              value="reliability"
              className="h-10 min-w-0 rounded-lg px-2 text-xs sm:text-sm"
            >
              Reconnect
            </TabsTrigger>
            <TabsTrigger
              value="advanced"
              className="h-10 min-w-0 rounded-lg px-2 text-xs sm:text-sm"
            >
              Configuration
            </TabsTrigger>
          </TabsList>
          {activeOptionsTab === 'security' ? (
            <TabsContent
              value="security"
              className="connect_options-panel connect_options-panel--split"
            >
              <fieldset className="connect_options-fieldset" disabled={optionsLocked}>
                <div className="connect_option-section">
                  <div className="connect_option-heading">
                    <h4>Authentication</h4>
                    <p>Credentials sent when the Remote API session opens.</p>
                  </div>
                  <label className="field">
                    <span>Authentication method</span>
                    <NativeSelect
                      value={authType}
                      onChange={(event) => setAuthType(event.target.value as AuthConfig['type'])}
                    >
                      <option value="none">None</option>
                      <option value="basic">Basic (username + password)</option>
                      <option value="bearer">Bearer token</option>
                      <option value="header">Custom header</option>
                    </NativeSelect>
                  </label>
                  {authType === 'basic' ? (
                    <div className="connect_grid">
                      <label className="field">
                        <span>Username</span>
                        <Input
                          type="text"
                          value={authUsername}
                          onChange={(event) => setAuthUsername(event.target.value)}
                        />
                      </label>
                      <label className="field">
                        <span>Password</span>
                        <Input
                          type="password"
                          value={authPassword}
                          onChange={(event) => setAuthPassword(event.target.value)}
                        />
                      </label>
                    </div>
                  ) : null}
                  {authType === 'bearer' ? (
                    <label className="field">
                      <span>Bearer token</span>
                      <Input
                        type="password"
                        value={authToken}
                        onChange={(event) => setAuthToken(event.target.value)}
                      />
                    </label>
                  ) : null}
                  {authType === 'header' ? (
                    <div className="connect_grid">
                      <label className="field">
                        <span>Header name</span>
                        <Input
                          type="text"
                          value={authHeaderName}
                          onChange={(event) => setAuthHeaderName(event.target.value)}
                        />
                      </label>
                      <label className="field">
                        <span>Header value</span>
                        <Input
                          type="text"
                          value={authHeaderValue}
                          onChange={(event) => setAuthHeaderValue(event.target.value)}
                        />
                      </label>
                    </div>
                  ) : null}
                </div>

                <div className="connect_option-section">
                  <div className="connect_option-heading">
                    <h4>TLS certificates</h4>
                    <p>Only needed when your router uses custom certificates.</p>
                  </div>
                  <div className="connect_grid">
                    <label className="field">
                      <span>CA certificate path</span>
                      <Input
                        type="text"
                        value={tlsCaPath}
                        onChange={(event) => setTlsCaPath(event.target.value)}
                        placeholder="C:\\certs\\ca.pem"
                      />
                    </label>
                    <label className="field">
                      <span>Client certificate path</span>
                      <Input
                        type="text"
                        value={tlsCertPath}
                        onChange={(event) => setTlsCertPath(event.target.value)}
                        placeholder="C:\\certs\\client.crt"
                      />
                    </label>
                    <label className="field">
                      <span>Client key path</span>
                      <Input
                        type="text"
                        value={tlsKeyPath}
                        onChange={(event) => setTlsKeyPath(event.target.value)}
                        placeholder="C:\\certs\\client.key"
                      />
                    </label>
                  </div>
                  <label className="field field--inline">
                    <Switch
                      checked={tlsVerify}
                      onCheckedChange={(checked) => setTlsVerify(checked)}
                    />
                    <span>Verify server certificate (recommended)</span>
                  </label>
                </div>
              </fieldset>
            </TabsContent>
          ) : null}
          {activeOptionsTab === 'reliability' ? (
            <TabsContent value="reliability" className="connect_options-panel">
              <fieldset className="connect_options-fieldset" disabled={optionsLocked}>
                <div className="connect_option-heading">
                  <h4>Automatic reconnect</h4>
                  <p>Keep Carto attached when a router or network briefly disappears.</p>
                </div>
                <label className="field field--inline">
                  <Switch
                    checked={reconnectEnabled}
                    onCheckedChange={(checked) => setReconnectEnabled(checked)}
                  />
                  <span>Reconnect automatically with exponential backoff</span>
                </label>
                <div className="connect_grid">
                  <label className="field">
                    <span>Initial delay (ms)</span>
                    <Input
                      type="number"
                      min={250}
                      step={250}
                      value={reconnectBaseDelay}
                      onChange={(event) => setReconnectBaseDelay(event.target.value)}
                      disabled={!reconnectEnabled}
                    />
                  </label>
                  <label className="field">
                    <span>Maximum delay (ms)</span>
                    <Input
                      type="number"
                      min={250}
                      step={250}
                      value={reconnectMaxDelay}
                      onChange={(event) => setReconnectMaxDelay(event.target.value)}
                      disabled={!reconnectEnabled}
                    />
                  </label>
                  <label className="field">
                    <span>Stop after</span>
                    <Input
                      type="number"
                      min={1}
                      step={1}
                      value={reconnectMaxAttempts}
                      onChange={(event) => setReconnectMaxAttempts(event.target.value)}
                      placeholder="Never"
                      disabled={!reconnectEnabled}
                    />
                    <span className="helper">Leave empty to keep retrying.</span>
                  </label>
                </div>
                <label className="field field--inline">
                  <Switch
                    checked={reconnectJitter}
                    onCheckedChange={(checked) => setReconnectJitter(checked)}
                    disabled={!reconnectEnabled}
                  />
                  <span>Randomize retry timing to avoid reconnect spikes</span>
                </label>
              </fieldset>
            </TabsContent>
          ) : null}
          {activeOptionsTab === 'advanced' ? (
            <TabsContent value="advanced" className="connect_options-panel">
              <fieldset className="connect_options-fieldset" disabled={optionsLocked}>
                <div className="connect_option-heading">
                  <h4>Session configuration</h4>
                  <p>Low-level health monitoring and Remote API driver options.</p>
                </div>
                <label className="field connect_health-field">
                  <span>Health check interval (ms)</span>
                  <Input
                    type="number"
                    min={0}
                    step={500}
                    value={healthInterval}
                    onChange={(event) => setHealthInterval(event.target.value)}
                  />
                  <span className="helper">Use 0 to disable active health checks.</span>
                </label>
                <label className="field">
                  <span>Driver config JSON</span>
                  <Textarea
                    value={configJson}
                    onChange={(event) => {
                      setConfigJson(event.target.value);
                      setLocalError(null);
                    }}
                    placeholder={`{"locator": "${DEFAULT_ENDPOINT}", "messageResponseTimeoutMs": 5000}`}
                    rows={5}
                  />
                </label>
              </fieldset>
            </TabsContent>
          ) : null}
        </Tabs>
      </DisclosureSection>

      <Dialog open={saveDialogOpen} onOpenChange={setSaveDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {selectedProfileId ? 'Edit saved connection' : 'Save connection'}
            </DialogTitle>
            <DialogDescription>
              Keep this endpoint and its settings for next time. Credentials are never saved.
            </DialogDescription>
          </DialogHeader>
          <form
            className="space-y-5"
            onSubmit={(event) => {
              event.preventDefault();
              handleSaveProfile();
            }}
          >
            <label className="flex flex-col gap-2 text-sm font-medium">
              Connection name
              <Input
                value={profileName}
                onChange={(event) => {
                  setProfileName(event.target.value);
                  setProfileError(null);
                }}
                placeholder="e.g. Local development"
                disabled={optionsLocked}
              />
            </label>
            <p className="truncate rounded-lg bg-muted p-3 font-mono text-xs text-muted-foreground">
              {endpoint}
            </p>
            {profileError && (
              <p role="alert" className="text-sm text-destructive">
                {profileError}
              </p>
            )}
            <DialogFooter>
              {selectedProfileId && (
                <Button
                  type="button"
                  variant="destructive"
                  className="sm:mr-auto"
                  disabled={optionsLocked}
                  onClick={() => {
                    handleDeleteProfile();
                    setSaveDialogOpen(false);
                  }}
                >
                  <IconTrash />
                  Delete
                </Button>
              )}
              <Button type="button" variant="outline" onClick={() => setSaveDialogOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={optionsLocked || !profileName.trim()}>
                Save connection
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </section>
  );
};

export default ConnectPanel;
