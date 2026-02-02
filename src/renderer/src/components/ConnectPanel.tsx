import { useEffect, useMemo, useState } from 'react';
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
import { IconChevronDown, IconLinkOff, IconPlug, IconSave, IconTrash } from './Icons';

const DEFAULT_ENDPOINT = 'ws://127.0.0.1:10000/';
const PROFILE_STORAGE_KEY = 'carto.connectionProfiles';
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
  onDisconnect: () => Promise<void>;
  onLog: (entry: LogInput) => void;
  onToast: (toast: ToastInput) => void;
};

type ConnectionProfile = {
  id: string;
  name: string;
  endpoint: string;
  configJson?: string;
  updatedAt: number;
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
        return {
          id: record.id,
          name: record.name,
          endpoint: record.endpoint,
          configJson: typeof record.configJson === 'string' ? record.configJson : undefined,
          updatedAt: typeof record.updatedAt === 'number' ? record.updatedAt : Date.now()
        } satisfies ConnectionProfile;
      })
      .filter((entry): entry is ConnectionProfile => Boolean(entry));
  } catch {
    return [];
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
  onDisconnect,
  onLog,
  onToast
}: ConnectPanelProps) => {
  const [endpoint, setEndpoint] = useState(defaultEndpoint ?? DEFAULT_ENDPOINT);
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
    const profile: ConnectionProfile = {
      id,
      name,
      endpoint: endpoint.trim(),
      configJson: configJson.trim() || undefined,
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
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setLocalError(message);
    } finally {
      setBusy(false);
    }
  };

  const handleDisconnect = async () => {
    setBusy(true);
    try {
      await onDisconnect();
    } catch {
      // ignore disconnect errors
      onToast({ type: 'error', message: 'Disconnect failed', detail: 'See logs for details.' });
      onLog({ level: 'error', source: 'connect', message: 'Disconnect failed.' });
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
        timeoutMs: parseOptionalNumber(testTimeout)
      };

      const result = await onTestConnection(params);
      setTestResult(result);
      if (!result.ok) {
        const detail = result.hint ? `${result.error ?? ''} ${result.hint}`.trim() : result.error;
        onToast({ type: 'error', message: 'Test connection failed', detail });
        onLog({
          level: 'error',
          source: 'diagnostics',
          message: result.error ?? 'Test connection failed.',
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

  const badgeTone =
    healthInfo.state === 'connected'
      ? 'badge--ok'
      : healthInfo.state === 'connecting' || healthInfo.state === 'reconnecting'
        ? 'badge--warn'
        : 'badge--idle';

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

  return (
    <section className="panel panel--accent">
      <div className="panel_header">
        <h2>Connect</h2>
        <span className={`badge ${badgeTone}`}>{healthInfo.label}</span>
      </div>

      <div className="connect_quick">
        <label className="field">
          <span>Router endpoint</span>
          <input
            type="text"
            value={endpoint}
            onChange={(event) => {
              setEndpoint(event.target.value);
              setLocalError(null);
            }}
            placeholder="ws://127.0.0.1:10000/"
            disabled={busy || status.connected}
          />
        </label>
        <div className="connect_quick-row">
          <label className="field">
            <span>Mode</span>
            <input type="text" value="client" disabled />
          </label>
          <label className="field">
            <span>Health check (ms)</span>
            <input
              type="number"
              min={0}
              step={500}
              value={healthInterval}
              onChange={(event) => setHealthInterval(event.target.value)}
              disabled={busy}
            />
          </label>
        </div>
      </div>

      <details className="disclosure">
        <summary className="disclosure_summary">
          <span className="disclosure_title">Profiles</span>{' '}
          <span className="disclosure_meta">{profiles.length} saved</span>{' '}
          <span className="disclosure_icon" aria-hidden="true">
            <IconChevronDown />
          </span>
        </summary>
        <div className="disclosure_content">
          <div className="connect_grid">
            <label className="field">
              <span>Saved profiles</span>
              <select
                value={selectedProfileId}
                onChange={(event) => setSelectedProfileId(event.target.value)}
                disabled={busy}
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
                disabled={busy}
              />
            </label>
          </div>
          <div className="connect_row">
            <button className="button button--ghost" onClick={handleSaveProfile} disabled={busy}>
              <span className="button_icon" aria-hidden="true">
                <IconSave />
              </span>{' '}Save profile
            </button>
            <button
              className="button button--ghost"
              onClick={handleDeleteProfile}
              disabled={busy || !selectedProfileId}
            >
              <span className="button_icon" aria-hidden="true">
                <IconTrash />
              </span>{' '}Delete
            </button>
          </div>
          {profileError ? <div className="notice notice--error">{profileError}</div> : null}
        </div>
      </details>

      <details className="disclosure">
        <summary className="disclosure_summary">
          <span className="disclosure_title">Authentication</span>{' '}
          <span className="disclosure_meta">{authSummary}</span>{' '}
          <span className="disclosure_icon" aria-hidden="true">
            <IconChevronDown />
          </span>
        </summary>
        <div className="disclosure_content">
          <label className="field">
            <span>Auth type</span>
            <select
              value={authType}
              onChange={(event) => setAuthType(event.target.value as AuthConfig['type'])}
              disabled={busy}
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
                  disabled={busy}
                />
              </label>
              <label className="field">
                <span>Password</span>
                <input
                  type="password"
                  value={authPassword}
                  onChange={(event) => setAuthPassword(event.target.value)}
                  disabled={busy}
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
                disabled={busy}
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
                  disabled={busy}
                />
              </label>
              <label className="field">
                <span>Header value</span>
                <input
                  type="text"
                  value={authHeaderValue}
                  onChange={(event) => setAuthHeaderValue(event.target.value)}
                  disabled={busy}
                />
              </label>
            </div>
          ) : null}
        </div>
      </details>

      <details className="disclosure">
        <summary className="disclosure_summary">
          <span className="disclosure_title">TLS</span>{' '}
          <span className="disclosure_meta">{tlsSummary}</span>{' '}
          <span className="disclosure_icon" aria-hidden="true">
            <IconChevronDown />
          </span>
        </summary>
        <div className="disclosure_content">
          <div className="connect_grid">
            <label className="field">
              <span>CA certificate path</span>
              <input
                type="text"
                value={tlsCaPath}
                onChange={(event) => setTlsCaPath(event.target.value)}
                placeholder="C:\\certs\\ca.pem"
                disabled={busy}
              />
            </label>
            <label className="field">
              <span>Client certificate path</span>
              <input
                type="text"
                value={tlsCertPath}
                onChange={(event) => setTlsCertPath(event.target.value)}
                placeholder="C:\\certs\\client.crt"
                disabled={busy}
              />
            </label>
            <label className="field">
              <span>Client key path</span>
              <input
                type="text"
                value={tlsKeyPath}
                onChange={(event) => setTlsKeyPath(event.target.value)}
                placeholder="C:\\certs\\client.key"
                disabled={busy}
              />
            </label>
          </div>
          <label className="field field--inline">
            <input
              type="checkbox"
              checked={tlsVerify}
              onChange={(event) => setTlsVerify(event.target.checked)}
              disabled={busy}
            />
            <span>Verify server certificate (recommended)</span>
          </label>
        </div>
      </details>

      <details className="disclosure">
        <summary className="disclosure_summary">
          <span className="disclosure_title">Reconnect</span>{' '}
          <span className="disclosure_meta">{reconnectSummary}</span>{' '}
          <span className="disclosure_icon" aria-hidden="true">
            <IconChevronDown />
          </span>
        </summary>
        <div className="disclosure_content">
          <label className="field field--inline">
            <input
              type="checkbox"
              checked={reconnectEnabled}
              onChange={(event) => setReconnectEnabled(event.target.checked)}
              disabled={busy}
            />
            <span>Auto reconnect with backoff</span>
          </label>
          <div className="connect_grid">
            <label className="field">
              <span>Base delay (ms)</span>
              <input
                type="number"
                min={250}
                step={250}
                value={reconnectBaseDelay}
                onChange={(event) => setReconnectBaseDelay(event.target.value)}
                disabled={busy || !reconnectEnabled}
              />
            </label>
            <label className="field">
              <span>Max delay (ms)</span>
              <input
                type="number"
                min={250}
                step={250}
                value={reconnectMaxDelay}
                onChange={(event) => setReconnectMaxDelay(event.target.value)}
                disabled={busy || !reconnectEnabled}
              />
            </label>
            <label className="field">
              <span>Max attempts</span>
              <input
                type="number"
                min={1}
                step={1}
                value={reconnectMaxAttempts}
                onChange={(event) => setReconnectMaxAttempts(event.target.value)}
                placeholder="Unlimited"
                disabled={busy || !reconnectEnabled}
              />
            </label>
          </div>
          <label className="field field--inline">
            <input
              type="checkbox"
              checked={reconnectJitter}
              onChange={(event) => setReconnectJitter(event.target.checked)}
              disabled={busy || !reconnectEnabled}
            />
            <span>Add jitter to retries</span>
          </label>
          <p className="helper">Max attempts counts the initial connection plus retries.</p>
        </div>
      </details>

      <details className="disclosure">
        <summary className="disclosure_summary">
          <span className="disclosure_title">Advanced</span>{' '}
          <span className="disclosure_meta">Config: {configSummary}</span>{' '}
          <span className="disclosure_icon" aria-hidden="true">
            <IconChevronDown />
          </span>
        </summary>
        <div className="disclosure_content">
          <label className="field">
            <span>Config JSON (optional)</span>
            <textarea
              value={configJson}
              onChange={(event) => {
                setConfigJson(event.target.value);
                setLocalError(null);
              }}
              placeholder='{"locator": "ws://127.0.0.1:10000/", "messageResponseTimeoutMs": 5000}'
              rows={4}
              disabled={busy}
            />
          </label>
        </div>
      </details>

      <details className="disclosure">
        <summary className="disclosure_summary">
          <span className="disclosure_title">Diagnostics</span>{' '}
          <span className="disclosure_meta">{testSummary ?? 'Not run'}</span>{' '}
          <span className="disclosure_icon" aria-hidden="true">
            <IconChevronDown />
          </span>
        </summary>
        <div className="disclosure_content">
          <div className="connect_row">
            <button
              className="button button--ghost"
              onClick={() => handleTestConnection()}
              disabled={busy || testRunning}
              type="button"
            >
              {testRunning ? 'Testing...' : 'Test connection'}
            </button>
            <label className="field field--inline">
              <span>Timeout (ms)</span>{' '}
              <input
                type="number"
                min={1000}
                step={500}
                value={testTimeout}
                onChange={(event) => setTestTimeout(event.target.value)}
                disabled={busy || testRunning}
              />
            </label>
          </div>
          {testResult?.ok && testResult.capabilities ? (
            <div className="diagnostics_block">
              <div className="diagnostics_row">
                <span className="diagnostics_label">Driver</span>{' '}
                <span>{testResult.capabilities.driver}</span>
              </div>
              {testResult.capabilities.zenoh ? (
                <div className="diagnostics_row">
                  <span className="diagnostics_label">Zenoh</span>{' '}
                  <span>{testResult.capabilities.zenoh}</span>
                </div>
              ) : null}
              {testResult.capabilities.remoteApi ? (
                <div className="diagnostics_row">
                  <span className="diagnostics_label">Remote API</span>{' '}
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
        </div>
      </details>

      <div className="panel_actions">
        {status.connected ? (
          <button className="button button--ghost" onClick={handleDisconnect} disabled={busy}>
            <span className="button_icon" aria-hidden="true">
              <IconLinkOff />
            </span>{' '}Disconnect
          </button>
        ) : (
          <button
            className="button"
            onClick={handleConnect}
            disabled={busy || !endpoint.trim()}
          >
            <span className="button_icon" aria-hidden="true">
              <IconPlug />
            </span>{' '}Connect
          </button>
        )}
      </div>
      {healthInfo.detail ? (
        <div className="notice notice--info notice--info-progress">{healthInfo.detail}</div>
      ) : null}
      {localError ? <div className="notice notice--error">{localError}</div> : null}
      {status.error ? <div className="panel_error">{status.error}</div> : null}
    </section>
  );
};

export default ConnectPanel;
