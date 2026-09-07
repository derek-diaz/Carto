# Backend performance and memory audit

Reviewed Carto 0.9.0 on Windows with Node.js 24.15.0. Tests use generated traffic and injected drivers; they do not connect to a real Zenoh network.

## Confirmed issues fixed

- **Incomplete driver cleanup.** A subscription cleanup error could prevent queryables and the underlying session from closing. Cleanup now attempts all resources and closes the session before reporting errors. Temporary publishers also close after failed sends, and subscriber/queryable declarations that finish after disconnect close their late handles.
- **Late connection probes.** Timing out a probe did not close a session created after the timeout. Late successes now trigger cleanup again.
- **Overlapping health checks.** A slow check could accumulate another request every interval. Checks now allow one in-flight request per session, and results from an old connection cannot update or disconnect a newer one. A regression test reproduced five simultaneous checks before the fix.
- **Unbounded inspection work and main-thread fallback.** Full-payload requests could pile up in the decode worker. A timeout abandoned the promise while leaving work queued, then decoded the same payload synchronously on the backend thread. Inspection now permits at most four pending requests and 192 MiB of queued input, terminates stalled workers, and returns an explicit unavailable/retry result instead of synchronous fallback. Cancelled inspection cannot return full data from a replaced connection.
- **Buffer shifting on every incoming message.** The previous ring buffer used `Array.shift()`. Normal and paused retention now use circular storage with constant-time insertion. Resizing preserves chronological order and releases removed slots.
- **Unnecessary retention and copying.** Reducing a subscription buffer now trims its raw-payload cache immediately. Worker input transfers an owned copy without another structured-clone copy. Base64 conversion uses a view of the retained bytes. Driver conversion of typed-array views now respects their offset and length.

- **Shared retention budget.** Retained raw payloads now share a 256 MiB cache across the backend. Per-subscription 192 MiB / 256-message limits remain. Oldest-arriving cached payloads are evicted before the next copy is allocated. Clear, unsubscribe, failed subscription setup, and connection replacement release the corresponding entries. Stream summaries, counters, pinned evidence, and already-acquired inspection snapshots retain their existing behavior.

## Measurements

Run the repeatable, isolated benchmark from the repository root:

```bash
node --expose-gc --import tsx scripts/backend_benchmark.ts
```

The audit run processed 12 connect/subscribe/disconnect cycles, each receiving 10,000 generated 4 KiB payloads, with a retention limit of 200 and 1,200 rotating keys. The event sink recorded counters without keeping message batches. Memory was sampled after explicit garbage collection; the first two cycles were warm-up.

- Across cycles 3–12, disconnected JavaScript heap usage was approximately **7.77–7.87 MiB**.
- Retained ArrayBuffer memory was **2.82 MiB while connected** and returned to **2.03 MiB after disconnect**. The roughly 0.79 MiB difference matches 200 retained 4 KiB payloads.
- Process RSS settled around **248–250 MiB after disconnect**. RSS includes runtime/allocator reservations and is not equivalent to live retained payload memory.
- No runaway retained-payload growth was observed in this short test. This is not proof that every long-running network workload is leak-free.

A separate insertion-only microbenchmark used 200,000 messages, taking the median of three runs:

| Retained messages | Previous array buffer | Circular buffer |
| ----------------- | --------------------: | --------------: |
| 200               |               7.26 ms |         1.47 ms |
| 20,000            |           5,117.29 ms |         0.96 ms |

These are local microbenchmark results, not end-to-end Zenoh throughput claims. They exclude transport, decoding, serialization, and renderer work.

### Shared-budget stress check

The benchmark also inserts **200 generated 4 MiB payloads across ten subscription scopes** into
the production cache configuration: **800 MiB of incoming samples**. It checks the budget after
every insertion. The observed retained cache stopped at exactly **256 MiB / 64 payloads**.
Clearing it returned all cache counters to zero.

After explicit collection, process ArrayBuffer memory measured **6.04 MiB before**, **262.04 MiB
while retained**, and **6.04 MiB after clearing**. This includes the separate generated source
payload; the retained-cache delta was exactly 256 MiB. Backend integration tests also verify that
cross-subscription eviction preserves stream rows and counters, and that clearing a subscription
makes its budget available to the others.

This is a shared raw-cache budget, not a cap on total process memory: active decode snapshots,
expanded JSON objects, queryable payloads, and pinned/renderer data still need separate limits.

## Remaining priorities

1. **Large decoded payloads and Electron delivery.** Limiting worker input does not limit expanded JSON object size. Returned objects and Base64 still consume main-process/renderer memory, and Electron event delivery has no acknowledgement-based backpressure. The web transport already closes clients exceeding its outgoing buffer threshold. A real-router soak test with a deliberately slow renderer would help set appropriate global limits.
2. **High-cardinality indexing.** Recent-key indexes cap their entry counts, but eviction scans up to 1,000 entries when a new key arrives at capacity. Message lookup also copies/scans the retained summary array. Profile these under representative key churn before adding more complex indexes.
3. **Broader lifecycle coverage.** The tests cover simulated failures, cancellation, timeout, and repeated cleanup; they do not establish behavior during prolonged router outages, TCP half-open connections, or every third-party SDK failure mode.

## Verification

Regression coverage includes cleanup failures, failed temporary publishers, late declarations, late connection probes, overlapping/stale health checks, worker overload/timeouts, posting failures, cancelled inspection, real-worker JSON decoding, retained-byte integrity, and circular-buffer resize/clear behavior.

```bash
npm test
npm run typecheck
npm run lint
npm run build:server
npm run build:desktop
```
