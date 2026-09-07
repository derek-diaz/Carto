export const DEFAULT_PAYLOAD_CACHE_BYTES = 256 * 1024 * 1024;
export const MAX_PAYLOAD_BYTES_PER_SUBSCRIPTION = 192 * 1024 * 1024;
export const MAX_PAYLOADS_PER_SUBSCRIPTION = 256;

type Entry = { subscriptionId: string; messageId: string; payload: Uint8Array };
type Scope = { entries: Map<string, Entry>; bytes: number };
type Options = {
  maxBytes?: number;
  maxBytesPerSubscription?: number;
  maxMessagesPerSubscription?: number;
};
const positiveInteger = (value: number | undefined, fallback: number) =>
  value !== undefined && Number.isFinite(value) && value >= 1 ? Math.floor(value) : fallback;

// Arrival-order eviction across all subscriptions. Reading a message does not extend retention.
export const createPayloadCache = (options: Options = {}) => {
  const maxBytes = positiveInteger(options.maxBytes, DEFAULT_PAYLOAD_CACHE_BYTES);
  const perSubscriptionBytes = Math.min(
    maxBytes,
    positiveInteger(options.maxBytesPerSubscription, MAX_PAYLOAD_BYTES_PER_SUBSCRIPTION)
  );
  const perSubscriptionCount = positiveInteger(
    options.maxMessagesPerSubscription,
    MAX_PAYLOADS_PER_SUBSCRIPTION
  );
  const entries = new Map<Entry, true>();
  const scopes = new Map<string, Scope>();
  let bytes = 0;
  const remove = (entry: Entry) => {
    if (!entries.delete(entry)) return;
    bytes -= entry.payload.byteLength;
    const scope = scopes.get(entry.subscriptionId);
    if (!scope) return;
    scope.entries.delete(entry.messageId);
    scope.bytes -= entry.payload.byteLength;
    if (!scope.entries.size) scopes.delete(entry.subscriptionId);
  };
  const trim = (subscriptionId: string, messageLimit: number) => {
    const scope = scopes.get(subscriptionId);
    if (!scope) return;
    const limit = Math.min(
      perSubscriptionCount,
      positiveInteger(messageLimit, perSubscriptionCount)
    );
    while (scope.entries.size > limit) remove(scope.entries.values().next().value!);
  };
  const set = (
    subscriptionId: string,
    messageId: string,
    payload: Uint8Array,
    messageLimit: number
  ) => {
    // Oversized samples must not evict useful history or leave an old value under the same ID.
    const previous = scopes.get(subscriptionId)?.entries.get(messageId);
    if (previous) remove(previous);
    if (payload.byteLength > perSubscriptionBytes) return false;
    const scope = scopes.get(subscriptionId) ?? { entries: new Map<string, Entry>(), bytes: 0 };
    const limit = Math.min(
      perSubscriptionCount,
      positiveInteger(messageLimit, perSubscriptionCount)
    );
    while (scope.entries.size >= limit || scope.bytes + payload.byteLength > perSubscriptionBytes)
      remove(scope.entries.values().next().value!);
    while (bytes + payload.byteLength > maxBytes) remove(entries.keys().next().value!);
    // Evict before copying, so the cache never temporarily holds budget + incoming payload.
    const entry: Entry = { subscriptionId, messageId, payload: Uint8Array.from(payload) };
    scope.entries.set(messageId, entry);
    scope.bytes += entry.payload.byteLength;
    scopes.set(subscriptionId, scope);
    entries.set(entry, true);
    bytes += entry.payload.byteLength;
    return true;
  };
  const clearSubscription = (subscriptionId: string) => {
    const scope = scopes.get(subscriptionId);
    if (scope) for (const entry of scope.entries.values()) remove(entry);
  };
  const clear = () => {
    entries.clear();
    scopes.clear();
    bytes = 0;
  };
  return {
    set,
    trim,
    clearSubscription,
    clear,
    get: (subscriptionId: string, messageId: string) =>
      scopes.get(subscriptionId)?.entries.get(messageId)?.payload,
    stats: () => ({ bytes, count: entries.size, subscriptions: scopes.size, maxBytes })
  };
};
