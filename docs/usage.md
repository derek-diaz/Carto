# Using Carto

[Back to the README](../README.md)

## Connection diagnostics

**Connection → Recent events** shows the five newest connection and runtime events. Expand
**View diagnostics** to search all retained events, filter by severity, sort columns, and read
original error details. Carto keeps up to 200 events for the current app session.

**Copy** includes all retained events when collapsed, or matching events when filters are open.
**Clear** clears this transient event history; it does not disconnect or change subscriptions.
Old `#/logs` links redirect to Connection. Keyboard shortcuts use Ctrl/Cmd + 1–5 for Monitor,
Publish, Connection, Settings, and About respectively.

## Discover and inspect

Connecting starts a 15-second discovery scan automatically, including when using saved connections.
The default `**` scope observes ordinary keys visible to this session. The traffic explorer opens
the first observed key automatically. Use **Scan again** to repeat a scan, or **Scan options** to
target an expression such as `robots/**` and choose a 15, 30, or 60-second duration.
Discovery receives matching payloads over the network, but retains only up to
1,000 keys and a 512-byte preview per key, separate from your monitoring buffers. Additional-key
samples omitted from the index are counted explicitly. **Stop scan** ends the scan early;
results remain available until the next scan or new connection. A disconnect stops discovery;
automatic reconnect does not restart it.

Select an observed key to see its latest preview, average sample rate over the scan, and last
activity. **Quiet** means no sample was observed in the last five seconds during the scan, not
that its publisher is offline. **Watch key** starts a normal subscription for future samples.
Suggested wildcard expressions are inferred from observed names and may also match unseen keys.
Discovery does not enumerate all publishers, queryables, or quiet resources.

## Decode Protobuf

For Protobuf payloads, choose a loaded message type in the payload message-type picker to try it against the
captured sample. **Add schema files…**, inside the picker, loads multiple `.proto` files together without leaving the explorer.
Select or drop your shared definitions and payload schemas, or paste each definition into the file
list. Carto resolves their referenced types together and reuses identical shared files already loaded.
Choose the top-level payload message type; its nested common messages and enums resolve automatically.
The set is saved only after validation. Missing types and duplicate definitions are reported, and
required shared definitions cannot be removed while other schemas depend on them.
The **Raw** tab shows the original preview. **Watch with decoder** carries that type into
the subscription. A successful decode is not proof that a schema matches. Samples larger than
the 512-byte discovery preview must be watched to decode full incoming messages.

## Explore observed keys

Each subscription opens as a horizontal tab. Use **+** to add one, the tab's **×** to close it,
or the arrow menu to find a tab when many are open. Arrow keys switch between focused tabs.
**Edit**, **Pause / Resume**, and **… → Clear buffer** apply to the active subscription.

Use **Stream**, **Explore keys**, and **Discover traffic** to switch workspace modes.
Stream search and follow choices are kept separately for each open subscription while monitoring.
Selecting a row or scrolling manually stops automatic following. **Jump to latest** scrolls once
to the newest retained message. **Follow incoming** turns automatic scrolling on; **Following**
indicates it is active and can be clicked to stop it.

The payload inspector opens below the stream, with a roughly 55/45 default split. Drag the small
grip on its divider to resize it. The split is saved with your local UI preferences and adapts to
window size. With the divider focused, use Up/Down (Shift for larger steps) or Home/End to resize.
Double-click the divider or use **Expand** to give the payload the whole working area.
**Metadata** includes the operation, full wire encoding,
timestamps, payload size, and subscription. JSON row previews summarize complete top-level fields
when possible; nested containers are abbreviated, and the inspector shows the actual payload.

Large payloads initially show up to 64 KB of display text. The notice distinguishes the original
payload size from the displayed representation (formatted JSON and Base64 can be larger).
**Show full text** opens the complete representation; **Show preview** restores the limit.
Long lines scroll horizontally. Small JSON is formatted and colored; large JSON uses plain text
to keep rendering lightweight. Formatting runs in a background worker, and comparisons are
computed only when you open **Changes**. **Copy payload** copies the full representation even
when the visible preview is shortened.

Open **Explore keys** to browse the hierarchy observed by the selected subscription. Select a key
or branch to focus its retained messages, start a focused subscription, or prepare a publish draft.
The explorer is an observation history, not a complete network inventory.

## Compare and pin messages

Select a message and use **Changes** to compare it with the previous retained message on the same
key. **Pin message** keeps a full payload and its decoded view for this app session; pinned messages
can also be selected as comparison baselines. Up to 8 messages of at most 8 MiB each can be pinned.
Pins survive disconnection and closing subscriptions, but are cleared when the app reloads.
Open **Pinned** above the stream to view or remove saved evidence in the collapsible tray.

## Edit and republish

**Edit & republish** prepares a draft with the key, payload format, and original wire encoding.
Review the draft before sending. Delete events and incomplete or expired payloads cannot be used
as publish drafts.

## Capture limits

The stream status line counts received samples and known skips in Carto's queues. Retained count,
average payload size, and encodings describe the current display buffer. These do not measure
network loss. Pausing freezes the display while a bounded queue keeps the newest incoming samples;
older samples can expire.

Full payloads share a **256 MiB raw-payload cache across all subscriptions**, with at most
**256 payloads / 192 MiB per subscription** (or fewer when its configured buffer is smaller).
When a limit is reached, the oldest cached payloads expire first. Stream rows and received/skipped
counters are unaffected, so a preview can remain after its full payload expires. Opening a message
does not extend its cache lifetime, but an inspection already decoding can finish its acquired
snapshot. Clearing a buffer, removing a subscription, or disconnecting releases its cached bytes.

Pin evidence while the full payload is available. Pinned evidence is stored separately and survives
cache eviction. The 256 MiB limit covers retained raw payloads; it is not a total process-memory
limit for decoded objects, active decoding, queryables, pinned evidence, or UI state.
