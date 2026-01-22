<div align="center">
  <img src="src/shared/logo_app.png" alt="Carto logo" width="300" height="300" />

  <p style="font-family: 'IBM Plex Sans', 'Segoe UI', sans-serif; margin: 0;">
    Inspect Zenoh traffic in real time.
  </p>
</div>

Carto is a desktop app for inspecting Zenoh traffic. It connects to a Zenoh router, subscribes to key expressions, and streams messages with live stats and decoding helpers.

## Development

Make sure you have Node.js 24+ installed.

```bash
npm install
npm run dev
```

Defaults assume a Zenoh router with the `zenoh-plugin-remote-api` plugin enabled at `ws://127.0.0.1:10000/` (HTTP REST is commonly on `http://127.0.0.1:8000/`).

This works best if you have a Zenoh instance running locally in Docker with the `remote-api` plugin enabled.

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



## TODO (next milestones)

- Protobuf / FlatBuffers decoding and schema registry.
- Export captures (JSON, PCAP) and replay tooling.