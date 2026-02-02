import { useCallback, useEffect, useState } from 'react';
import type { LogInput, ToastInput } from '../utils/notifications';
import type { ProtoSchema } from '../utils/proto';
import { IconClose } from './Icons';
import ProtoPanel from './ProtoPanel';

const SUBSCRIBE_HISTORY_KEY = 'carto.keyexpr.history';
const PUBLISH_HISTORY_KEY = 'carto.keyexpr.publish.history';
const PUBLISH_HISTORY_DETAILS_KEY = 'carto.keyexpr.publish.details';
const HISTORY_EVENT = 'carto.history.updated';

type SettingsViewProps = {
  ringBufferSize: number;
  minRingBuffer: number;
  maxRingBuffer: number;
  onRingBufferChange: (value: number) => void;
  schemas: ProtoSchema[];
  onAddSchema: (name: string, source: string) => boolean;
  onRemoveSchema: (id: string) => void;
  onLog: (entry: LogInput) => void;
  onToast: (toast: ToastInput) => void;
  onExportSettings: () => unknown;
  onImportSettings: (
    payload: unknown,
    options?: { mode?: 'merge' | 'replace' }
  ) => { ok: boolean; error?: string; warnings?: string[] };
};

const SettingsView = ({
  ringBufferSize,
  minRingBuffer,
  maxRingBuffer,
  onRingBufferChange,
  schemas,
  onAddSchema,
  onRemoveSchema,
  onLog,
  onToast,
  onExportSettings,
  onImportSettings
}: SettingsViewProps) => {
  const [bufferDraft, setBufferDraft] = useState(String(ringBufferSize));
  const [error, setError] = useState<string | null>(null);
  const [subscribeHistory, setSubscribeHistory] = useState<string[]>([]);
  const [publishHistory, setPublishHistory] = useState<string[]>([]);
  const [mergeImport, setMergeImport] = useState(true);

  const readHistory = useCallback((key: string) => {
    if (typeof globalThis === 'undefined' || !('localStorage' in globalThis)) return [];
    const stored = globalThis.localStorage.getItem(key);
    if (!stored) return [];
    try {
      const parsed = JSON.parse(stored);
      if (!Array.isArray(parsed)) return [];
      return parsed.filter((entry) => typeof entry === 'string');
    } catch {
      return [];
    }
  }, []);

  const persistHistory = useCallback((key: string, entries: string[]) => {
    if ('localStorage' in globalThis) {
      globalThis.localStorage.setItem(key, JSON.stringify(entries));
    }
  }, []);

  const readPublishDetails = useCallback(() => {
    if (typeof globalThis === 'undefined' || !('localStorage' in globalThis)) return {};
    const stored = globalThis.localStorage.getItem(PUBLISH_HISTORY_DETAILS_KEY);
    if (!stored) return {};
    try {
      const parsed = JSON.parse(stored);
      if (!parsed || typeof parsed !== 'object') return {};
      return parsed as Record<string, unknown>;
    } catch {
      return {};
    }
  }, []);

  const persistPublishDetails = useCallback((next: Record<string, unknown>) => {
    if ('localStorage' in globalThis) {
      globalThis.localStorage.setItem(PUBLISH_HISTORY_DETAILS_KEY, JSON.stringify(next));
    }
  }, []);

  const prunePublishDetails = useCallback(
    (allowed: Set<string>) => {
      const details = readPublishDetails();
      let changed = false;
      Object.keys(details).forEach((key) => {
        if (!allowed.has(key)) {
          delete details[key];
          changed = true;
        }
      });
      if (changed) {
        persistPublishDetails(details);
      }
    },
    [persistPublishDetails, readPublishDetails]
  );

  const notifyHistoryUpdated = useCallback((type: 'subscribe' | 'publish') => {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(new CustomEvent(HISTORY_EVENT, { detail: { type } }));
  }, []);

  const loadHistories = useCallback(() => {
    setSubscribeHistory(readHistory(SUBSCRIBE_HISTORY_KEY));
    setPublishHistory(readHistory(PUBLISH_HISTORY_KEY));
  }, [readHistory]);

  useEffect(() => {
    setBufferDraft(String(ringBufferSize));
  }, [ringBufferSize]);

  useEffect(() => {
    loadHistories();
  }, [loadHistories]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handleHistoryUpdate = (event: Event) => {
      const detail = (event as CustomEvent<{ type?: string }>).detail;
      if (!detail?.type || detail.type === 'subscribe') {
        setSubscribeHistory(readHistory(SUBSCRIBE_HISTORY_KEY));
      }
      if (!detail?.type || detail.type === 'publish') {
        setPublishHistory(readHistory(PUBLISH_HISTORY_KEY));
      }
    };
    window.addEventListener(HISTORY_EVENT, handleHistoryUpdate as EventListener);
    return () => window.removeEventListener(HISTORY_EVENT, handleHistoryUpdate as EventListener);
  }, [readHistory]);

  const commitBufferSize = (value: string) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
      setBufferDraft(String(ringBufferSize));
      setError(null);
      return;
    }
    const clamped = Math.min(maxRingBuffer, Math.max(minRingBuffer, Math.round(parsed)));
    setBufferDraft(String(clamped));
    setError(null);
    if (clamped !== ringBufferSize) {
      onRingBufferChange(clamped);
    }
  };

  const handleChange = (value: string) => {
    setBufferDraft(value);
    if (!value.trim()) {
      setError('Enter a number to set the default buffer size.');
      return;
    }
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
      setError('Enter a valid number.');
      return;
    }
    if (parsed < minRingBuffer || parsed > maxRingBuffer) {
      setError(`Enter a value between ${minRingBuffer} and ${maxRingBuffer}.`);
      return;
    }
    setError(null);
  };

  const updateSubscribeHistory = useCallback(
    (next: string[]) => {
      setSubscribeHistory(next);
      persistHistory(SUBSCRIBE_HISTORY_KEY, next);
      notifyHistoryUpdated('subscribe');
    },
    [notifyHistoryUpdated, persistHistory]
  );

  const updatePublishHistory = useCallback(
    (next: string[]) => {
      setPublishHistory(next);
      persistHistory(PUBLISH_HISTORY_KEY, next);
      prunePublishDetails(new Set(next));
      notifyHistoryUpdated('publish');
    },
    [notifyHistoryUpdated, persistHistory, prunePublishDetails]
  );

  const handleRemoveSubscribe = (entry: string) => {
    updateSubscribeHistory(subscribeHistory.filter((item) => item !== entry));
  };

  const handleRemovePublish = (entry: string) => {
    updatePublishHistory(publishHistory.filter((item) => item !== entry));
  };

  const handleClearSubscribe = () => {
    updateSubscribeHistory([]);
  };

  const handleClearPublish = () => {
    updatePublishHistory([]);
  };

  const handleExport = () => {
    const payload = onExportSettings();
    try {
      const json = JSON.stringify(payload, null, 2);
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `carto-settings-${new Date().toISOString().slice(0, 10)}.json`;
      anchor.click();
      URL.revokeObjectURL(url);
      onToast({ type: 'ok', message: 'Settings exported.' });
    } catch (exportError) {
      const message = exportError instanceof Error ? exportError.message : String(exportError);
      onToast({ type: 'error', message: 'Export failed', detail: message });
    }
  };

  const handleImportFile = async (file: File | null) => {
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const result = onImportSettings(parsed, { mode: mergeImport ? 'merge' : 'replace' });
      if (!result.ok) {
        onToast({ type: 'error', message: 'Import failed', detail: result.error });
        return;
      }
      if (result.warnings && result.warnings.length > 0) {
        onToast({ type: 'warn', message: 'Imported with warnings', detail: result.warnings[0] });
      } else {
        onToast({ type: 'ok', message: 'Settings imported.' });
      }
    } catch (importError) {
      const message = importError instanceof Error ? importError.message : String(importError);
      onToast({ type: 'error', message: 'Import failed', detail: message });
    }
  };

  return (
    <div className="app_page app_page--wide">
      <div className="settings_stack">
        <section className="panel panel--settings">
          <div className="panel_header">
            <h2>Defaults</h2>
          </div>
          <label className="field">
            <span>Ring buffer size</span>
            <input
              type="number"
              min={minRingBuffer}
              max={maxRingBuffer}
              value={bufferDraft}
              onChange={(event) => handleChange(event.target.value)}
              onBlur={(event) => commitBufferSize(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  commitBufferSize(bufferDraft);
                  event.currentTarget.blur();
                }
              }}
            />
          </label>
          <span className="helper">Applies to new subscriptions only.</span>
          {error ? <div className="panel_error">{error}</div> : null}
        </section>

        <section className="panel panel--settings">
          <div className="panel_header">
            <h2>History</h2>
          </div>
          <div className="settings_history">
            <div className="settings_group">
              <div className="settings_group-header">
                <div>
                  <div className="settings_group-title">Subscribe history</div>
                  <div className="helper">Shown in the Subscribe dropdown.</div>
                </div>
                <button
                  className="button button--ghost button--compact"
                  type="button"
                  onClick={handleClearSubscribe}
                  disabled={subscribeHistory.length === 0}
                >
                  Clear
                </button>
              </div>
              {subscribeHistory.length === 0 ? (
                <div className="empty">No saved keyexprs yet.</div>
              ) : (
                <div className="history_list">
                  {subscribeHistory.map((entry) => (
                    <div key={entry} className="history_row">
                      <span className="history_label">{entry}</span>
                      <button
                        className="icon-button icon-button--compact icon-button--ghost"
                        type="button"
                        title={`Remove ${entry}`}
                        aria-label={`Remove ${entry} from subscribe history`}
                        onClick={() => handleRemoveSubscribe(entry)}
                      >
                        <span className="icon-button_icon" aria-hidden="true">
                          <IconClose />
                        </span>
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="settings_group">
              <div className="settings_group-header">
                <div>
                  <div className="settings_group-title">Publish history</div>
                  <div className="helper">Shown in the Publish dropdown.</div>
                </div>
                <button
                  className="button button--ghost button--compact"
                  type="button"
                  onClick={handleClearPublish}
                  disabled={publishHistory.length === 0}
                >
                  Clear
                </button>
              </div>
              {publishHistory.length === 0 ? (
                <div className="empty">No saved keyexprs yet.</div>
              ) : (
                <div className="history_list">
                  {publishHistory.map((entry) => (
                    <div key={entry} className="history_row">
                      <span className="history_label">{entry}</span>
                      <button
                        className="icon-button icon-button--compact icon-button--ghost"
                        type="button"
                        title={`Remove ${entry}`}
                        aria-label={`Remove ${entry} from publish history`}
                        onClick={() => handleRemovePublish(entry)}
                      >
                        <span className="icon-button_icon" aria-hidden="true">
                          <IconClose />
                        </span>
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </section>

        <section className="panel panel--settings">
          <div className="panel_header">
            <h2>Import / Export</h2>
          </div>
          <div className="settings_io">
            <label className="field field--inline settings_toggle">
              <input
                type="checkbox"
                checked={mergeImport}
                onChange={(event) => setMergeImport(event.target.checked)}
              />
              <span>Merge with existing settings</span>
            </label>
            <div className="settings_row">
              <div>
                <div className="settings_group-title">Export settings</div>
                <div className="helper">Share protobufs, histories, and profiles.</div>
              </div>
              <button className="button button--ghost button--compact" type="button" onClick={handleExport}>
                Export
              </button>
            </div>
            <div className="settings_row">
              <div>
                <div className="settings_group-title">Import settings</div>
                <div className="helper">
                  {mergeImport
                    ? 'Adds entries and keeps your local values.'
                    : 'Replaces local settings with the imported file.'}
                </div>
              </div>
              <label className="button button--ghost button--compact">
                Import
                <input
                  type="file"
                  accept="application/json,.json"
                  onChange={(event) => {
                    const file = event.target.files?.[0] ?? null;
                    handleImportFile(file).catch(() => {});
                    event.currentTarget.value = '';
                  }}
                />
              </label>
            </div>
          </div>
        </section>
      </div>

      <ProtoPanel
        schemas={schemas}
        onAddSchema={onAddSchema}
        onRemoveSchema={onRemoveSchema}
        onLog={onLog}
        onToast={onToast}
      />
    </div>
  );
};

export default SettingsView;
