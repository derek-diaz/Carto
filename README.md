<div align="center">
  <img src="src/shared/logo_app.png" alt="Carto logo" width="300" height="300" />

  <p style="font-family: 'IBM Plex Sans', 'Segoe UI', sans-serif; margin: 0;">
    Inspect Zenoh traffic in real time.
  </p>
</div>

Carto is a desktop app for inspecting Zenoh traffic. It connects to a Zenoh router, subscribes to key expressions, and streams messages with live stats and decoding helpers.

## Installation

All the installation files for Windows/Mac/Linux are available on the [releases](https://github.com/derek-diaz/Carto/releases) page.

### Zenoh router requirements

To use Carto, you must have a Zenoh router with the `zenoh-plugin-remote-api` plugin enabled.

- Enable `zenoh-plugin-remote-api` on the router.
- Ensure the remote-api WS endpoint is reachable at `ws://127.0.0.1:10000/` (or update the endpoint in the app).
- REST is commonly exposed on `http://127.0.0.1:8000/`, but Carto uses the WS endpoint.

The plugin is located here: [zenoh-plugin-remote-api downloads](https://download.eclipse.org/zenoh/zenoh-plugin-remote-api/).

Here's how to set up Docker with Zenoh plugins: [Adding plugins and backends to the container](https://zenoh.io/docs/getting-started/quick-test/#adding-plugins-and-backends-to-the-container).

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
