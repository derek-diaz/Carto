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
import { IconChevronDown, IconClose, IconPlug, IconSave, IconTrash } from './Icons';

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

type ConnectionOptionsTab =
  | 'profiles'
  | 'security'
  | 'reliability'
  | 'advanced'
  | 'diagnostics';

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

  const [testTimeout, setTestTimeout] = useState(DEFAULT_TEST_TIMEOUT_MS);
  const [testRunning, setTestRunning] = useState(false);
  const [testResult, setTestResult] = useState<ConnectionTestResult | null>(null);
  const [activeOptionsTab, setActiveOptionsTab] =
    useState<ConnectionOptionsTab>('profiles');

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
    const nextProfiles = [profile, ...withoutCurrent].sort(
      (a, b) => b.updatedAt - a.updatedAt
    );
    saveProfiles(nextProfiles);
    setSelectedProfileId(id);
    setProfileError(null);
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
    setActiveOptionsTab('diagnostics');
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
        timeoutMs: parseOptionalNumber(testTimeout)
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

  const authSummary = useMemo(() => {
    if (authType === 'none') return 'None';
    if (authType === 'basic') return authUsername ? `Basic (${authUsername})` : 'Basic';
    if (authType === 'bearer') return 'Bearer token';
    return authHeaderName ? `Header (${authHeaderName})` : 'Custom header';
  }, [authHeaderName, authType, authUsername]);

  const tlsSummary = useMemo(() => {
    if (tlsCaPath || tlsCertPath || tlsKeyPath) return 'Custom certs';
    if (!tlsVerify) return 'Verification off';
    return 'Default';
  }, [tlsCaPath, tlsCertPath, tlsKeyPath, tlsVerify]);

  const reconnectSummary = useMemo(() => {
    if (!reconnectEnabled) return 'Off';
    const base = parseOptionalNumber(reconnectBaseDelay);
    const max = parseOptionalNumber(reconnectMaxDelay);
    if (base && max) return `${base}ms -> ${max}ms`;
    return 'On';
  }, [reconnectBaseDelay, reconnectEnabled, reconnectMaxDelay]);

  const configSummary = useMemo(() => {
    if (!configJson.trim()) return 'None';
    return `${configJson.trim().length} chars`;
  }, [configJson]);

  const optionsLocked = busy || status.connected;

  return (
    <section className="panel panel--accent connect_panel">
      <div className="connect_intro">
        <div>
          <span className="connect_kicker">Router connection</span>
          <h2>{status.connected ? 'Connected and ready' : 'Connect to a Zenoh router'}</h2>
          <p>
            {status.connected
              ? 'Carto is ready to publish and monitor messages on this router.'
              : 'Enter the Remote API WebSocket address. The defaults work for a local router.'}
          </p>
        </div>
        <div className={`connect_live-state connect_live-state--${healthInfo.state}`}>
          <span aria-hidden="true" />
          <div>
            <small>Current status</small>
            <strong>{healthInfo.label}</strong>
          </div>
        </div>
      </div>

      <div className="connect_quick connect_quick--hero">
        <label className="field field--combo">
          <span>Remote API endpoint</span>
          <div className="combo" ref={comboRef}>
            <input
              ref={endpointInputRef}
              className="combo_input"
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
              placeholder={DEFAULT_ENDPOINT}
              disabled={busy || status.connected}
            />
            <button
              className="combo_toggle"
              type="button"
              onClick={() => setShowHistory((prev) => !prev)}
              aria-label="Toggle endpoint history"
              disabled={busy || status.connected}
            >
              <span className="combo_icon" aria-hidden="true">
                <IconChevronDown />
              </span>
            </button>
            {showHistory ? (
              <div className="combo_menu" role="listbox">
                {endpointHistory.length === 0 ? (
                  <div className="combo_empty">No recent endpoints yet.</div>
                ) : (
                  endpointHistory.map((entry) => (
                    <div key={entry} className="combo_option">
                      <button
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
                      </button>
                      <button
                        className="icon-button icon-button--compact icon-button--ghost combo_option_remove"
                        type="button"
                        title={`Remove ${entry}`}
                        aria-label={`Remove ${entry} from history`}
                        onClick={() => handleRemoveHistory(entry)}
                      >
                        <span className="icon-button_icon" aria-hidden="true">
                          <IconClose />
                        </span>
                      </button>
                    </div>
                  ))
                )}
              </div>
            ) : null}
          </div>
          <span className="helper">
            {status.connected
              ? 'Disconnect before changing this endpoint or its connection options.'
              : 'Default: ws://127.0.0.1:10000/'}
          </span>
        </label>

        <div className="connect_actions">
          <button
            className="button button--ghost"
            onClick={() => handleTestConnection()}
            disabled={busy || testRunning}
            type="button"
          >
            {testRunning ? 'Checking…' : 'Check endpoint'}
          </button>
          {!status.connected ? (
            <button
              className="button connect_primary"
              onClick={handleConnect}
              disabled={busy || !endpoint.trim()}
            >
              <span className="button_icon" aria-hidden="true">
                <IconPlug />
              </span>{' '}
              Connect to router
            </button>
          ) : null}
        </div>
      </div>

      {healthInfo.detail ? (
        <div className="notice notice--info notice--info-progress">{healthInfo.detail}</div>
      ) : null}
      {localError ? <div className="notice notice--error">{localError}</div> : null}
      {status.error ? <div className="panel_error">{status.error}</div> : null}

      <section className="connect_options" aria-labelledby="connection-options-title">
        <div className="connect_options-head">
          <div>
            <h3 id="connection-options-title">Connection options</h3>
            <p>Optional settings for secured, remote, or unreliable networks.</p>
          </div>
          {status.connected ? <span className="connect_options-lock">Locked while connected</span> : null}
        </div>

        <div className="connect_options-tabs" role="tablist" aria-label="Connection options">
          <button
            id="connection-tab-profiles"
            className={`connect_options-tab ${activeOptionsTab === 'profiles' ? 'connect_options-tab--active' : ''}`}
            type="button"
            role="tab"
            aria-selected={activeOptionsTab === 'profiles'}
            aria-controls="connection-panel-profiles"
            onClick={() => setActiveOptionsTab('profiles')}
          >
            <span>Profiles</span>
            <small>{profiles.length} saved</small>
          </button>
          <button
            id="connection-tab-security"
            className={`connect_options-tab ${activeOptionsTab === 'security' ? 'connect_options-tab--active' : ''}`}
            type="button"
            role="tab"
            aria-selected={activeOptionsTab === 'security'}
            aria-controls="connection-panel-security"
            onClick={() => setActiveOptionsTab('security')}
          >
            <span>Security</span>
            <small>{authSummary} · TLS {tlsSummary}</small>
          </button>
          <button
            id="connection-tab-reliability"
            className={`connect_options-tab ${activeOptionsTab === 'reliability' ? 'connect_options-tab--active' : ''}`}
            type="button"
            role="tab"
            aria-selected={activeOptionsTab === 'reliability'}
            aria-controls="connection-panel-reliability"
            onClick={() => setActiveOptionsTab('reliability')}
          >
            <span>Reliability</span>
            <small>{reconnectSummary}</small>
          </button>
          <button
            id="connection-tab-advanced"
            className={`connect_options-tab ${activeOptionsTab === 'advanced' ? 'connect_options-tab--active' : ''}`}
            type="button"
            role="tab"
            aria-selected={activeOptionsTab === 'advanced'}
            aria-controls="connection-panel-advanced"
            onClick={() => setActiveOptionsTab('advanced')}
          >
            <span>Advanced</span>
            <small>Config {configSummary}</small>
          </button>
          <button
            id="connection-tab-diagnostics"
            className={`connect_options-tab ${activeOptionsTab === 'diagnostics' ? 'connect_options-tab--active' : ''}`}
            type="button"
            role="tab"
            aria-selected={activeOptionsTab === 'diagnostics'}
            aria-controls="connection-panel-diagnostics"
            onClick={() => setActiveOptionsTab('diagnostics')}
          >
            <span>Diagnostics</span>
            <small>{testSummary ?? 'Not run'}</small>
          </button>
        </div>

        <div className="connect_options-body">
          {activeOptionsTab === 'profiles' ? (
            <div
              id="connection-panel-profiles"
              className="connect_options-panel"
              role="tabpanel"
              aria-labelledby="connection-tab-profiles"
            >
              <fieldset className="connect_options-fieldset" disabled={optionsLocked}>
                <div className="connect_grid">
                  <label className="field">
                    <span>Saved profiles</span>
                    <select
                      value={selectedProfileId}
                      onChange={(event) => setSelectedProfileId(event.target.value)}
                    >
                      <option value="">Select a profile</option>
                      {profiles.map((profile) => (
                        <option key={profile.id} value={profile.id}>
                          {profile.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="field">
                    <span>Profile name</span>
                    <input
                      type="text"
                      value={profileName}
                      onChange={(event) => {
                        setProfileName(event.target.value);
                        setProfileError(null);
                      }}
                      placeholder="My router"
                    />
                  </label>
                </div>
                <div className="connect_row">
                  <button className="button button--ghost" onClick={handleSaveProfile} type="button">
                    <span className="button_icon" aria-hidden="true">
                      <IconSave />
                    </span>{' '}
                    Save profile
                  </button>
                  <button
                    className="button button--ghost"
                    onClick={handleDeleteProfile}
                    disabled={!selectedProfileId}
                    type="button"
                  >
                    <span className="button_icon" aria-hidden="true">
                      <IconTrash />
                    </span>{' '}
                    Delete
                  </button>
                </div>
              </fieldset>
              <p className="helper">
                Profiles save this endpoint and its non-secret options. Passwords, tokens, and
                custom header values are never stored.
              </p>
              {profileError ? <div className="notice notice--error">{profileError}</div> : null}
            </div>
          ) : null}

          {activeOptionsTab === 'security' ? (
            <div
              id="connection-panel-security"
              className="connect_options-panel connect_options-panel--split"
              role="tabpanel"
              aria-labelledby="connection-tab-security"
            >
              <fieldset className="connect_options-fieldset" disabled={optionsLocked}>
                <div className="connect_option-section">
                  <div className="connect_option-heading">
                    <h4>Authentication</h4>
                    <p>Credentials sent when the Remote API session opens.</p>
                  </div>
                  <label className="field">
                    <span>Authentication method</span>
                    <select
                      value={authType}
                      onChange={(event) => setAuthType(event.target.value as AuthConfig['type'])}
                    >
                      <option value="none">None</option>
                      <option value="basic">Basic (username + password)</option>
                      <option value="bearer">Bearer token</option>
                      <option value="header">Custom header</option>
                    </select>
                  </label>
                  {authType === 'basic' ? (
                    <div className="connect_grid">
                      <label className="field">
                        <span>Username</span>
                        <input
                          type="text"
                          value={authUsername}
                          onChange={(event) => setAuthUsername(event.target.value)}
                        />
                      </label>
                      <label className="field">
                        <span>Password</span>
                        <input
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
                      <input
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
                        <input
                          type="text"
                          value={authHeaderName}
                          onChange={(event) => setAuthHeaderName(event.target.value)}
                        />
                      </label>
                      <label className="field">
                        <span>Header value</span>
                        <input
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
                      <input
                        type="text"
                        value={tlsCaPath}
                        onChange={(event) => setTlsCaPath(event.target.value)}
                        placeholder="C:\\certs\\ca.pem"
                      />
                    </label>
                    <label className="field">
                      <span>Client certificate path</span>
                      <input
                        type="text"
                        value={tlsCertPath}
                        onChange={(event) => setTlsCertPath(event.target.value)}
                        placeholder="C:\\certs\\client.crt"
                      />
                    </label>
                    <label className="field">
                      <span>Client key path</span>
                      <input
                        type="text"
                        value={tlsKeyPath}
                        onChange={(event) => setTlsKeyPath(event.target.value)}
                        placeholder="C:\\certs\\client.key"
                      />
                    </label>
                  </div>
                  <label className="field field--inline">
                    <input
                      type="checkbox"
                      checked={tlsVerify}
                      onChange={(event) => setTlsVerify(event.target.checked)}
                    />
                    <span>Verify server certificate (recommended)</span>
                  </label>
                </div>
              </fieldset>
            </div>
          ) : null}

          {activeOptionsTab === 'reliability' ? (
            <div
              id="connection-panel-reliability"
              className="connect_options-panel"
              role="tabpanel"
              aria-labelledby="connection-tab-reliability"
            >
              <fieldset className="connect_options-fieldset" disabled={optionsLocked}>
                <div className="connect_option-heading">
                  <h4>Automatic reconnect</h4>
                  <p>Keep Carto attached when a router or network briefly disappears.</p>
                </div>
                <label className="field field--inline">
                  <input
                    type="checkbox"
                    checked={reconnectEnabled}
                    onChange={(event) => setReconnectEnabled(event.target.checked)}
                  />
                  <span>Reconnect automatically with exponential backoff</span>
                </label>
                <div className="connect_grid">
                  <label className="field">
                    <span>Initial delay (ms)</span>
                    <input
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
                    <input
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
                    <input
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
                  <input
                    type="checkbox"
                    checked={reconnectJitter}
                    onChange={(event) => setReconnectJitter(event.target.checked)}
                    disabled={!reconnectEnabled}
                  />
                  <span>Randomize retry timing to avoid reconnect spikes</span>
                </label>
              </fieldset>
            </div>
          ) : null}

          {activeOptionsTab === 'advanced' ? (
            <div
              id="connection-panel-advanced"
              className="connect_options-panel"
              role="tabpanel"
              aria-labelledby="connection-tab-advanced"
            >
              <fieldset className="connect_options-fieldset" disabled={optionsLocked}>
                <div className="connect_option-heading">
                  <h4>Session configuration</h4>
                  <p>Low-level health monitoring and Remote API driver options.</p>
                </div>
                <label className="field connect_health-field">
                  <span>Health check interval (ms)</span>
                  <input
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
                  <textarea
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
            </div>
          ) : null}

          {activeOptionsTab === 'diagnostics' ? (
            <div
              id="connection-panel-diagnostics"
              className="connect_options-panel"
              role="tabpanel"
              aria-labelledby="connection-tab-diagnostics"
            >
              <div className="connect_option-heading">
                <h4>Endpoint check</h4>
                <p>Open a temporary session and report the server capabilities.</p>
              </div>
              <div className="connect_diagnostics-controls">
                <label className="field">
                  <span>Timeout (ms)</span>
                  <input
                    type="number"
                    min={1000}
                    step={500}
                    value={testTimeout}
                    onChange={(event) => setTestTimeout(event.target.value)}
                    disabled={busy || testRunning}
                  />
                </label>
                <button
                  className="button button--ghost"
                  type="button"
                  onClick={() => handleTestConnection()}
                  disabled={busy || testRunning}
                >
                  {testRunning ? 'Checking…' : 'Run check'}
                </button>
              </div>
              {testResult?.ok && testResult.capabilities ? (
                <div className="diagnostics_block">
                  <div className="diagnostics_row">
                    <span className="diagnostics_label">Result</span>
                    <span>{testSummary}</span>
                  </div>
                  <div className="diagnostics_row">
                    <span className="diagnostics_label">Driver</span>
                    <span>{testResult.capabilities.driver}</span>
                  </div>
                  {testResult.capabilities.zenoh ? (
                    <div className="diagnostics_row">
                      <span className="diagnostics_label">Zenoh</span>
                      <span>{testResult.capabilities.zenoh}</span>
                    </div>
                  ) : null}
                  {testResult.capabilities.remoteApi ? (
                    <div className="diagnostics_row">
                      <span className="diagnostics_label">Remote API</span>
                      <span>{testResult.capabilities.remoteApi}</span>
                    </div>
                  ) : null}
                </div>
              ) : null}
              {!testResult?.ok && testResult?.error ? (
                <div className="notice notice--error">{testResult.error}</div>
              ) : null}
              {testResult?.hint ? (
                <div className="notice notice--info notice--info-warning">{testResult.hint}</div>
              ) : null}
              {!testResult ? <p className="connect_diagnostics-empty">No check has been run yet.</p> : null}
            </div>
          ) : null}
        </div>
      </section>
    </section>
  );
};

export default ConnectPanel;
