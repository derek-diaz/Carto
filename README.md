# Carto

Carto is a desktop app for inspecting Zenoh traffic. It connects to a Zenoh router, subscribes to key expressions, and streams messages with live stats and decoding helpers.

## Dev

```bash
npm install
npm run dev
```

Defaults assume a Zenoh router with the `zenoh-plugin-remote-api` plugin enabled at `ws://127.0.0.1:10000/` (HTTP REST is commonly on `http://127.0.0.1:8000/`).

Optional environment flags:
- `CARTO_WS_PATH=expr`: Override the WebSocket request path (useful when the server expects a key expression path).

## Packaging (macOS/Windows/Linux)

Local builds:

```bash
npm run dist
```

Platform-specific:

```bash
npm run dist:mac
npm run dist:win
npm run dist:linux
```

## Security notes

- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true` are enforced.
- Renderer gets a minimal API via the preload script (`ipcRenderer.invoke` + event listeners).
- All navigation is blocked except external links handled via `shell.openExternal`.

## Architecture

```
+-----------------------+      IPC invoke/on      +-------------------------+
|  Renderer (React UI)  | <---------------------> |  Main (Electron)        |
|  - Connect / Subscribe|                         |  - Zenoh driver         |
|  - Stream + Keys      |                         |  - Ring buffers         |
+-----------------------+                         |  - Recent keys index    |
                                                  +-----------+-------------+
                                                              |
                                                              | WebSocket
                                                              v
                                                  +-------------------------+
                                                  | Zenoh router + remote   |
                                                  | api plugin              |
                                                  +-------------------------+
```

## TODO (next milestones)

- Auto-updates.
- Protobuf / FlatBuffers decoding and schema registry.
- Export captures (JSON, PCAP) and replay tooling.
- Multi-session support and saved connection profiles.
- Filtering and alerts (regex, rate thresholds).

## Notes on Zenoh compatibility

Carto uses a `ZenohDriver` abstraction with a WebSocket remote-api driver. It attempts a lightweight info call on connect and surfaces any detected versions or capabilities in the UI. See `SUPPORTED_VERSIONS.md` for the current matrix.
