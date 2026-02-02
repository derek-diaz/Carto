<div align="center">
  <img src="src/shared/logo_app.png" alt="Carto logo" width="300" height="300" />

  <p style="font-family: 'IBM Plex Sans', 'Segoe UI', sans-serif; margin: 0;">
    Inspect Zenoh traffic in real time.
  </p>
</div>

Carto is a desktop app for inspecting Zenoh traffic. It connects to a Zenoh router, subscribes to key expressions, and streams messages with live stats and decoding helpers.

## Why Carto?

We recently started using **Zenoh** at work, and I was looking for a tool similar in spirit to **RedisInsight**, something that makes it easy to inspect traffic, explore key expressions, and understand what’s happening on a running system.

I couldn’t find a solution that worked well for our needs, so I built **Carto**!

This project is intended to be useful beyond our team...soo...feel free to use it in your own projects, and if it helps (or you have ideas), I’d love feedback and contributions.

Also, the name Carto comes from Cartógrafo in Spanish, which means mapmaker.

## Installation

All the installation files for Windows/Mac/Linux are available on the [releases](https://github.com/derek-diaz/Carto/releases) page.

### Zenoh router requirements

To use Carto, you must have a Zenoh router with the `zenoh-plugin-remote-api` plugin enabled.

- Enable `zenoh-plugin-remote-api` on the router.
- Ensure the remote-api WS endpoint is reachable at `ws://127.0.0.1:10000/` (or update the endpoint in the app).
- REST is commonly exposed on `http://127.0.0.1:8000/`, but Carto uses the WS endpoint.

The plugin is located here: [zenoh-plugin-remote-api downloads](https://download.eclipse.org/zenoh/zenoh-plugin-remote-api/).

Here's how to set up Docker with Zenoh plugins: [Adding plugins and backends to the container](https://zenoh.io/docs/getting-started/quick-test/#adding-plugins-and-backends-to-the-container).


## Running Zenoh with the Plugins (Docker)

If you don’t already have a Zenoh router with Remote API enabled, this repository includes a
Docker-based local Zenoh setup you can use as a starting point.

```bash
cd docker
docker compose up --build
````

By default, this starts a local Zenoh router with the Remote API exposed at:
```bash
ws://localhost:10000
```
You can then point Carto at that endpoint.

See `docker/README.md` for details.

## Development

Make sure you have Node.js 24+ installed.

```bash
npm install
npm run dev
```

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

# Things missing from app

Data Handling

- Export captured messages (JSON/CSV) and import for offline review
- Persistent capture to disk + playback/replay timeline
- Message copy buttons (key, payload, full message)
- Hex/raw byte view in the drawer (beyond base64)

Filtering & Analysis

- Advanced filters (regex, size range, time range, keyexpr include/exclude)
- Per‑key statistics (rate, bandwidth, last seen trend)
- Grouping/aggregations (by key, by key prefix)
- Highlight rules / saved filters

Publish Workflow

- Publish templates/presets and history beyond “last publish”
- Batch/paste multi‑message publish
- Schema‑aware editing (JSON schema / protobuf / CBOR decode)

UX/Quality

- Keyboard shortcuts cheat sheet / help
- Preferences (theme, buffer defaults, polling interval)
