import { useCallback, useEffect, useRef, useState } from 'react';
import type { Subscription } from '../store/useCarto';
import type { LogInput, ToastInput } from '../utils/notifications';
import {
  parseDecoderConfig,
  resolveDecoderTypeIds,
  type DecoderConfig,
  type ProtoTypeOption
} from '../utils/proto';
import {
  IconCheck,
  IconChevronDown,
  IconClose,
  IconPause,
  IconPlay,
  IconPlus,
  IconStop,
  IconTrash
} from './Icons';
import { getKeyexprError } from '@shared/keyexpr';

const DEFAULT_KEYEXPR = 'demo/**';
const KEYEXPR_HISTORY_KEY = 'carto.keyexpr.history';
const KEYEXPR_HISTORY_DETAILS_KEY = 'carto.keyexpr.subscribe.details';
const MAX_KEYEXPR_HISTORY = 8;
const HISTORY_EVENT = 'carto.history.updated';

type SubscribePanelProps = {
  connected: boolean;
  subscriptions: Subscription[];
  selectedSubId: string | null;
  onSubscribe: (keyexpr: string, bufferSize?: number, decoder?: DecoderConfig) => Promise<string>;
  onUpdateSubscription: (
    subscriptionId: string,
    keyexpr: string,
    bufferSize?: number,
    decoder?: DecoderConfig
  ) => Promise<void>;
  onUnsubscribe: (subscriptionId: string) => Promise<void>;
  onPause: (subscriptionId: string, paused: boolean) => Promise<void>;
  onClear: (subscriptionId: string) => Promise<void>;
  onSelect: (subscriptionId: string) => void;
  onLog: (entry: LogInput) => void;
  onToast: (toast: ToastInput) => void;
  protoTypes: ProtoTypeOption[];
  decoderById: Record<string, DecoderConfig | undefined>;
  protoTypeLabels: Record<string, string>;
  editingSubscription?: Subscription | null;
  onClose?: () => void;
};

const mergeHistory = (base: string[], add: string[]) => {
  const combined = [...add, ...base];
  const seen = new Set<string>();
  const next: string[] = [];
  for (const entry of combined) {
    if (!seen.has(entry)) {
      seen.add(entry);
      next.push(entry);
    }
  }
  return next.slice(0, MAX_KEYEXPR_HISTORY);
};

const persistHistory = (entries: string[]) => {
  if ('localStorage' in globalThis) {
    globalThis.localStorage.setItem(KEYEXPR_HISTORY_KEY, JSON.stringify(entries));
  }
};

const decoderSignature = (decoder: DecoderConfig | undefined): string => {
  if (!decoder || decoder.kind === 'raw') return 'raw';
  return `${decoder.kind}:${resolveDecoderTypeIds(decoder).join('\u0000')}`;
};

const decodersEqual = (
  left: DecoderConfig | undefined,
  right: DecoderConfig | undefined
): boolean => decoderSignature(left) === decoderSignature(right);

const decoderLabel = (
  decoder: DecoderConfig | undefined,
  protoTypeLabels: Record<string, string>
): string => {
  if (!decoder || decoder.kind === 'raw') return 'Raw';
  if (decoder.kind === 'protobuf') {
    return `Protobuf: ${protoTypeLabels[decoder.typeId] ?? 'Unknown'}`;
  }
  const labels = decoder.typeIds
    .map((typeId) => protoTypeLabels[typeId] ?? 'Unknown')
    .filter((label) => label.length > 0);
  if (labels.length === 0) return 'Protobuf (multi)';
  if (labels.length === 1) return `Protobuf: ${labels[0]}`;
  return `Protobuf: ${labels[0]} +${labels.length - 1}`;
};

const SubscribePanel = ({
  connected,
  subscriptions,
  selectedSubId,
  onSubscribe,
  onUpdateSubscription,
  onUnsubscribe,
  onPause,
  onClear,
  onSelect,
  onLog,
  onToast,
  protoTypes,
  decoderById,
  protoTypeLabels,
  editingSubscription,
  onClose
}: SubscribePanelProps) => {
  const isModal = Boolean(onClose);
  const isEditing = Boolean(editingSubscription);
  const [keyexpr, setKeyexpr] = useState(DEFAULT_KEYEXPR);
  const [bufferSizeText, setBufferSizeText] = useState('');
  const [keyexprHistory, setKeyexprHistory] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [decoderMode, setDecoderMode] = useState<'raw' | 'protobuf'>('raw');
  const [protoTypeIds, setProtoTypeIds] = useState<string[]>([]);
  const [protoSearch, setProtoSearch] = useState('');
  const [showProtoMenu, setShowProtoMenu] = useState(false);
  const comboRef = useRef<HTMLDivElement | null>(null);
  const protoComboRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const historyRef = useRef<string[]>([]);
  const detailsRef = useRef<Record<string, DecoderConfig>>({});
  const suppressHistoryOpenRef = useRef(false);

  const trimmedKeyexpr = keyexpr.trim();
  const trimmedBufferSize = bufferSizeText.trim();
  const validationError = trimmedKeyexpr ? getKeyexprError(trimmedKeyexpr) : null;
  const displayError = validationError ?? error;
  const protoQuery = protoSearch.trim().toLowerCase();
  const filteredProtoTypes = protoQuery
    ? protoTypes.filter((type) => type.label.toLowerCase().includes(protoQuery))
    : protoTypes;
  const selectableFilteredIds = filteredProtoTypes.map((type) => type.id);
  const allFilteredSelected =
    selectableFilteredIds.length > 0 &&
    selectableFilteredIds.every((id) => protoTypeIds.includes(id));
  const editingDecoder = editingSubscription ? decoderById[editingSubscription.id] : undefined;

  const applyHistory = useCallback((entries: string[]) => {
    historyRef.current = entries;
    setKeyexprHistory(entries);
  }, []);

  const notifyHistoryUpdated = useCallback(() => {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(new CustomEvent(HISTORY_EVENT, { detail: { type: 'subscribe' } }));
  }, []);

  const commitHistory = useCallback(
    (entries: string[]) => {
      applyHistory(entries);
      persistHistory(entries);
      notifyHistoryUpdated();
    },
    [applyHistory, notifyHistoryUpdated]
  );

  const loadDetails = useCallback((): Record<string, DecoderConfig> => {
    if (typeof globalThis === 'undefined' || !('localStorage' in globalThis)) return {};
    const stored = globalThis.localStorage.getItem(KEYEXPR_HISTORY_DETAILS_KEY);
    if (!stored) return {};
    try {
      const parsed = JSON.parse(stored);
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

  const persistDetails = useCallback((next: Record<string, DecoderConfig>) => {
    if ('localStorage' in globalThis) {
      globalThis.localStorage.setItem(KEYEXPR_HISTORY_DETAILS_KEY, JSON.stringify(next));
    }
  }, []);

  const handleRemoveHistory = useCallback(
    (entry: string) => {
      const next = historyRef.current.filter((item) => item !== entry);
      commitHistory(next);
      const details = { ...detailsRef.current };
      if (details[entry]) {
        delete details[entry];
        detailsRef.current = details;
        persistDetails(details);
      }
    },
    [commitHistory, persistDetails]
  );

  const applyDecoderSelection = useCallback(
    (decoder: DecoderConfig | undefined) => {
      if (!decoder || decoder.kind === 'raw') {
        setDecoderMode('raw');
        setProtoTypeIds([]);
        setProtoSearch('');
        setShowProtoMenu(false);
        return;
      }

      const availableIds = new Set(protoTypes.map((type) => type.id));
      const typeIds = resolveDecoderTypeIds(decoder).filter((typeId) => availableIds.has(typeId));
      setDecoderMode('protobuf');
      setProtoTypeIds(typeIds);
      setProtoSearch('');
      setShowProtoMenu(false);
    },
    [protoTypes]
  );

  const applyHistorySelection = useCallback(
    (entry: string) => {
      setKeyexpr(entry);
      applyDecoderSelection(detailsRef.current[entry]);
      setShowHistory(false);
      suppressHistoryOpenRef.current = true;
      inputRef.current?.focus();
    },
    [applyDecoderSelection]
  );

  useEffect(() => {
    setError(null);
  }, [bufferSizeText, keyexpr]);

  useEffect(() => {
    if (typeof globalThis === 'undefined' || !('localStorage' in globalThis)) return;
    const stored = globalThis.localStorage.getItem(KEYEXPR_HISTORY_KEY);
    if (!stored) return;
    try {
      const parsed = JSON.parse(stored);
      if (Array.isArray(parsed)) {
        const entries = parsed.filter((entry) => typeof entry === 'string');
        applyHistory(entries);
      }
    } catch {
      // ignore history parse errors
    }
  }, [applyHistory]);

  useEffect(() => {
    detailsRef.current = loadDetails();
  }, [loadDetails]);

  useEffect(() => {
    if (subscriptions.length === 0) return;
    const next = mergeHistory(
      historyRef.current,
      subscriptions.map((sub) => sub.keyexpr)
    );
    const current = historyRef.current;
    const isSame =
      next.length === current.length && next.every((entry, index) => entry === current[index]);
    if (!isSame) {
      commitHistory(next);
    }

    const nextDetails = { ...detailsRef.current };
    let detailsChanged = false;
    subscriptions.forEach((sub) => {
      const decoder = decoderById[sub.id] ?? { kind: 'raw' };
      if (decodersEqual(nextDetails[sub.keyexpr], decoder)) return;
      nextDetails[sub.keyexpr] = decoder;
      detailsChanged = true;
    });
    if (detailsChanged) {
      detailsRef.current = nextDetails;
      persistDetails(nextDetails);
    }
  }, [commitHistory, decoderById, persistDetails, subscriptions]);

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
    const handleHistoryUpdate = (event: Event) => {
      const detail = (event as CustomEvent<{ type?: string }>).detail;
      if (detail?.type && detail.type !== 'subscribe') return;
      if (typeof globalThis === 'undefined' || !('localStorage' in globalThis)) return;
      const stored = globalThis.localStorage.getItem(KEYEXPR_HISTORY_KEY);
      if (!stored) {
        applyHistory([]);
        return;
      }
      try {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed)) {
          const entries = parsed.filter((entry) => typeof entry === 'string');
          applyHistory(entries);
        }
      } catch {
        // ignore history parse errors
      }
      detailsRef.current = loadDetails();
    };
    window.addEventListener(HISTORY_EVENT, handleHistoryUpdate as EventListener);
    return () => window.removeEventListener(HISTORY_EVENT, handleHistoryUpdate as EventListener);
  }, [applyHistory, loadDetails]);

  useEffect(() => {
    if (decoderMode !== 'protobuf') return;
    setProtoTypeIds((prev) => prev.filter((typeId) => protoTypes.some((type) => type.id === typeId)));
  }, [decoderMode, protoTypes]);

  useEffect(() => {
    if (decoderMode !== 'protobuf') {
      setShowProtoMenu(false);
      setProtoSearch('');
    }
  }, [decoderMode]);

  useEffect(() => {
    if (!showProtoMenu) return;
    const handlePointerDown = (event: MouseEvent) => {
      if (!protoComboRef.current) return;
      if (protoComboRef.current.contains(event.target as Node)) return;
      setShowProtoMenu(false);
    };
    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [showProtoMenu]);

  useEffect(() => {
    if (!editingSubscription) {
      setKeyexpr(DEFAULT_KEYEXPR);
      setBufferSizeText('');
      setDecoderMode('raw');
      setProtoTypeIds([]);
      setProtoSearch('');
      return;
    }

    setKeyexpr(editingSubscription.keyexpr);
    setBufferSizeText(String(editingSubscription.bufferSize));
    const decoder = editingDecoder;
    if (!decoder || decoder.kind === 'raw') {
      setDecoderMode('raw');
      setProtoTypeIds([]);
      setProtoSearch('');
      return;
    }
    setDecoderMode('protobuf');
    if (decoder.kind === 'protobuf') {
      setProtoTypeIds([decoder.typeId]);
    } else {
      setProtoTypeIds([...new Set(decoder.typeIds)]);
    }
    setProtoSearch('');
  }, [editingDecoder, editingSubscription]);

  const toggleProtoType = useCallback((typeId: string) => {
    setProtoTypeIds((prev) =>
      prev.includes(typeId) ? prev.filter((id) => id !== typeId) : [...prev, typeId]
    );
  }, []);

  const toggleSelectAllFiltered = useCallback(() => {
    setProtoTypeIds((prev) => {
      const everySelected =
        selectableFilteredIds.length > 0 &&
        selectableFilteredIds.every((id) => prev.includes(id));
      if (everySelected) {
        const removing = new Set(selectableFilteredIds);
        return prev.filter((id) => !removing.has(id));
      }
      const next = [...prev];
      for (const id of selectableFilteredIds) {
        if (!next.includes(id)) next.push(id);
      }
      return next;
    });
  }, [selectableFilteredIds]);

  const reportError = (source: string, message: string, detail?: string) => {
    setError(message);
    onToast({ type: 'error', message, detail });
    onLog({ level: 'error', source, message, detail });
  };

  const handleAction = async (
    action: () => Promise<void>,
    source: string,
    detail?: string
  ) => {
    try {
      await action();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      reportError(source, message, detail);
    }
  };

  const handleSubscribe = async () => {
    const nextKeyexpr = keyexpr.trim();
    const keyexprError = nextKeyexpr ? getKeyexprError(nextKeyexpr) : null;
    if (keyexprError) {
      setError(keyexprError);
      return;
    }

    if (decoderMode === 'protobuf' && protoTypeIds.length === 0) {
      setError('Select at least one protobuf type before subscribing.');
      return;
    }

    const nextBufferSize = (() => {
      if (!trimmedBufferSize) {
        return editingSubscription?.bufferSize;
      }
      const parsed = Number(trimmedBufferSize);
      if (!Number.isInteger(parsed) || parsed < 1) {
        return null;
      }
      return parsed;
    })();

    if (nextBufferSize === null) {
      setError('Buffer size must be a positive whole number.');
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const decoder: DecoderConfig | undefined = (() => {
        if (decoderMode !== 'protobuf') return { kind: 'raw' };
        return { kind: 'protobuf_multi', typeIds: protoTypeIds };
      })();
      if (editingSubscription) {
        await onUpdateSubscription(editingSubscription.id, nextKeyexpr, nextBufferSize, decoder);
      } else {
        await onSubscribe(nextKeyexpr, nextBufferSize, decoder);
      }
      const next = mergeHistory(historyRef.current, [nextKeyexpr]);
      commitHistory(next);
      const details = { ...detailsRef.current, [nextKeyexpr]: decoder };
      detailsRef.current = details;
      persistDetails(details);
      onLog({
        level: 'info',
        source: 'subscribe',
        message: editingSubscription
          ? `Updated subscription ${nextKeyexpr}.`
          : `Subscribed to ${nextKeyexpr}.`
      });
      if (editingSubscription) {
        onClose?.();
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      reportError(editingSubscription ? 'subscription-edit' : 'subscribe', message, nextKeyexpr);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className={`panel panel--subscribe ${isModal ? 'subscribe_panel--modal' : ''}`}>
      <div className="panel_header">
        <div className="subscribe_heading">
          <h2>{isEditing ? 'Edit subscription' : isModal ? 'New subscription' : 'Subscribe'}</h2>
          {!isModal ? (
            <p>Create a new subscription and choose how payloads should decode.</p>
          ) : null}
        </div>
        <div className="panel_actions">
          {!isModal ? <span className="badge badge--idle">{subscriptions.length} active</span> : null}
          {onClose ? (
            <button
              className="icon-button icon-button--compact icon-button--ghost"
              onClick={onClose}
              type="button"
              title="Close"
              aria-label="Close"
            >
              <span className="icon-button_icon" aria-hidden="true">
                <IconClose />
              </span>
            </button>
          ) : null}
        </div>
      </div>
      <div className="subscribe_form">
        <label className="field field--combo subscribe_field">
          <span>Key expression</span>
          <div className="combo" ref={comboRef}>
            <input
              ref={inputRef}
              className="combo_input"
              type="text"
              value={keyexpr}
              onChange={(event) => setKeyexpr(event.target.value)}
              onFocus={() => {
                if (suppressHistoryOpenRef.current) {
                  suppressHistoryOpenRef.current = false;
                  return;
                }
                if (keyexprHistory.length > 0) setShowHistory(true);
              }}
              placeholder="demo/**"
              disabled={!connected || busy}
            />
            <button
              className="combo_toggle"
              type="button"
              onClick={() => setShowHistory((prev) => !prev)}
              aria-label="Toggle key expression history"
              disabled={!connected || busy}
            >
              <span className="combo_icon" aria-hidden="true">
                <IconChevronDown />
              </span>
            </button>
            {showHistory ? (
              <div className="combo_menu" role="listbox">
                {keyexprHistory.length === 0 ? (
                  <div className="combo_empty">No saved keyexprs yet.</div>
                ) : (
                  keyexprHistory.map((entry) => (
                    <div key={entry} className="combo_option">
                      <button
                        className="combo_option_button"
                        type="button"
                        role="option"
                        onClick={() => applyHistorySelection(entry)}
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
        </label>
        {!isModal ? (
          <div className="helper">Pick a recent keyexpr from the dropdown or type a new one.</div>
        ) : null}

        <label className="field subscribe_field">
          <span>Buffer size</span>
          <input
            type="number"
            min={1}
            step={1}
            value={bufferSizeText}
            onChange={(event) => setBufferSizeText(event.target.value)}
            placeholder={editingSubscription ? String(editingSubscription.bufferSize) : 'Use default'}
            disabled={!connected || busy}
          />
          <span className="helper">
            {editingSubscription
              ? 'Controls how many messages this subscription keeps.'
              : 'Leave blank to use the default from Settings.'}
          </span>
        </label>

        <label className="field subscribe_field">
          <span>Decoder</span>
          <div className={`subscribe_decoder ${decoderMode === 'protobuf' ? 'subscribe_decoder--protobuf' : ''}`}>
            <button
              className={`subscribe_decoder-option ${decoderMode === 'raw' ? 'subscribe_decoder-option--active' : ''}`}
              type="button"
              onClick={() => {
                setDecoderMode('raw');
              }}
            >
              <span className="subscribe_decoder-title">Raw</span>
              <span className="subscribe_decoder-copy">Keep payloads as-is.</span>
            </button>
            <button
              className={`subscribe_decoder-option ${decoderMode === 'protobuf' ? 'subscribe_decoder-option--active' : ''}`}
              type="button"
              onClick={() => setDecoderMode('protobuf')}
              disabled={protoTypes.length === 0}
            >
              <span className="subscribe_decoder-title">Protobuf</span>
              <span className="subscribe_decoder-copy">
                Decode with one or more schema types.
              </span>
            </button>
          </div>
          {protoTypes.length === 0 ? (
            <span className="helper">Add a `.proto` schema in Settings to enable decoding.</span>
          ) : null}
        </label>

        {decoderMode === 'protobuf' ? (
          <label className="field field--combo subscribe_field">
            <span>Protobuf types</span>
            <div className="combo proto_combo" ref={protoComboRef}>
              <input
                className="combo_input"
                type="text"
                value={protoSearch}
                onChange={(event) => {
                  setProtoSearch(event.target.value);
                  setShowProtoMenu(true);
                }}
                onFocus={() => setShowProtoMenu(true)}
                placeholder={
                  protoTypeIds.length > 0
                    ? `${protoTypeIds.length} selected ? search to add more`
                    : 'Search message types'
                }
                disabled={protoTypes.length === 0}
              />
              <button
                className="combo_toggle"
                type="button"
                onClick={() => setShowProtoMenu((prev) => !prev)}
                aria-label="Toggle protobuf type list"
                disabled={protoTypes.length === 0}
              >
                <span className="combo_icon" aria-hidden="true">
                  <IconChevronDown />
                </span>
              </button>
              {showProtoMenu ? (
                <div className="combo_menu proto_menu" role="listbox" aria-multiselectable="true">
                  <div className="proto_menu_actions">
                    <button
                      type="button"
                      className="proto_menu_action"
                      onClick={toggleSelectAllFiltered}
                      disabled={selectableFilteredIds.length === 0}
                    >
                      {allFilteredSelected
                        ? `Deselect all${protoQuery ? ' shown' : ''}`
                        : `Select all${protoQuery ? ' shown' : ''}`}
                    </button>
                    <button
                      type="button"
                      className="proto_menu_action"
                      onClick={() => setProtoTypeIds([])}
                      disabled={protoTypeIds.length === 0}
                    >
                      Clear
                    </button>
                  </div>
                  {filteredProtoTypes.length === 0 ? (
                    <div className="combo_empty">No matching types.</div>
                  ) : (
                    filteredProtoTypes.map((type) => {
                      const selected = protoTypeIds.includes(type.id);
                      return (
                        <button
                          key={type.id}
                          type="button"
                          role="option"
                          aria-selected={selected}
                          className={`proto_option ${selected ? 'proto_option--selected' : ''}`}
                          onClick={() => toggleProtoType(type.id)}
                        >
                          <span className="proto_option_check" aria-hidden="true">
                            {selected ? <IconCheck /> : null}
                          </span>
                          <span className="proto_option_label">{type.label}</span>
                        </button>
                      );
                    })
                  )}
                </div>
              ) : null}
            </div>
            {protoTypeIds.length > 0 ? (
              <div className="proto_types proto_types--scroll">
                {protoTypeIds.map((typeId) => (
                  <span key={typeId} className="proto_type">
                    {protoTypeLabels[typeId] ?? 'Unknown'}
                    <button
                      className="proto_type-remove"
                      type="button"
                      aria-label={`Remove ${protoTypeLabels[typeId] ?? typeId}`}
                      onClick={() =>
                        setProtoTypeIds((prev) => prev.filter((entry) => entry !== typeId))
                      }
                    >
                      <span className="icon-button_icon" aria-hidden="true">
                        <IconClose />
                      </span>
                    </button>
                  </span>
                ))}
              </div>
            ) : null}
            <span className="helper">
              Search and click to toggle types ? pick as many as you need. Selected types appear
              below; remove any with the X.
            </span>
          </label>
        ) : null}
      </div>

      <div className="panel_actions subscribe_actions">
        <button
          className={`button ${isModal ? 'subscribe_submit' : ''}`}
          onClick={handleSubscribe}
          disabled={
            !connected ||
            busy ||
            !trimmedKeyexpr ||
            Boolean(validationError) ||
            (decoderMode === 'protobuf' && protoTypeIds.length === 0)
          }
        >
          {isEditing ? 'Save changes' : isModal ? 'Subscribe' : (
            <>
              <span className="button_icon" aria-hidden="true">
                <IconPlus />
              </span>{' '}Start
            </>
          )}
        </button>
      </div>
      {displayError ? <div className="panel_error">{displayError}</div> : null}

      {!isModal ? (
        <div className="list">
          {subscriptions.length === 0 ? (
            <div className="empty">No active subscriptions yet.</div>
          ) : (
            subscriptions.map((sub) => (
              <div
                key={sub.id}
                className={`list_row ${selectedSubId === sub.id ? 'list_row--active' : ''}`}
                onClick={() => onSelect(sub.id)}
              >
                <div className="list_meta">
                  <div className="list_title">{sub.keyexpr}</div>
                  <div className="list_subtitle">
                    <span className="list_decoder">
                      {decoderLabel(decoderById[sub.id], protoTypeLabels)}
                    </span>
                  </div>
                </div>
                <div className="list_actions">
                  <button
                    className="button button--ghost"
                    onClick={(event) => {
                      event.stopPropagation();
                      handleAction(
                        () => onPause(sub.id, !sub.paused),
                        'subscribe',
                        `Pause toggle for ${sub.keyexpr}`
                      );
                    }}
                  >
                    <span className="button_icon" aria-hidden="true">
                      {sub.paused ? <IconPlay /> : <IconPause />}
                    </span>{' '}{sub.paused ? 'Resume' : 'Pause'}
                  </button>
                  <button
                    className="button button--ghost"
                    onClick={(event) => {
                      event.stopPropagation();
                      handleAction(
                        () => onClear(sub.id),
                        'subscribe',
                        `Clear buffer for ${sub.keyexpr}`
                      );
                    }}
                  >
                    <span className="button_icon" aria-hidden="true">
                      <IconTrash />
                    </span>{' '}Clear
                  </button>
                  <button
                    className="button button--danger"
                    onClick={(event) => {
                      event.stopPropagation();
                      handleAction(
                        () => onUnsubscribe(sub.id),
                        'subscribe',
                        `Unsubscribe ${sub.keyexpr}`
                      );
                    }}
                  >
                    <span className="button_icon" aria-hidden="true">
                      <IconStop />
                    </span>{' '}Stop
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      ) : null}
    </section>
  );
};

export default SubscribePanel;
