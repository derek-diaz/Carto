# Developing Carto

[Back to the README](../README.md)

Run commands from the repository root.

## UI architecture

Carto shares a React 19 renderer between Electron and the web server. Its component foundation is
the official **shadcn/ui Rhea** preset with **Base UI** primitives and **Tailwind CSS 4**. The registry
configuration lives in `components.json`; reusable controls live in `apps/web/src/components/ui`.
Add controls with `npx shadcn add <component>` and compose them into domain components instead of
reimplementing focus management, dialogs, select menus, or notifications.

- **TanStack Router** owns navigation with hash history, compatible with packaged Electron windows.
  The root investigation stays mounted when switching views.
- **TanStack Query** owns discovery and metadata refreshes, mutation invalidation, and cache cleanup.
  Queries run offline as well, since Electron IPC and local routers do not require Internet access.
- **TanStack Virtual** renders the bounded live stream. High-volume message ingestion stays in the
  existing event-driven buffers rather than being polled or copied into a query cache.
- **TanStack Form** validates discovery scope and controls submission.
- **TanStack Table** powers the reusable `DataTable` and sortable runtime diagnostics in Connection.

The shared theme is `apps/web/src/styles/globals.css`. Light and dark color tokens cover the Rhea
components and existing inspector layouts. Domain-specific layout styles remain in a lower CSS
layer so Tailwind utilities can override them predictably. Icons come from Lucide.

Both Electron and web mode allow runtime code generation (`unsafe-eval` in the script CSP),
which protobufjs requires for user-loaded schemas. Inline scripts remain blocked in web mode.

## Local setup

Use Node.js 24 or newer.

```bash
npm ci
npm run dev:desktop
```

Desktop launch commands install the matching Electron runtime if needed. If a launch reports
`Electron uninstall`, run `npm run setup:desktop` and try again.

For a browser build, see [Running Carto on the web](running-web.md).

## Checks

```bash
npm run typecheck
npm run lint
npm test
npm run build:desktop
npm run build:web
npm run build:server
```

## Load Testing

Carto includes a local Zenoh load publisher for reproducing large-payload issues.

Default run:

```bash
npm run load:test -- --endpoint ws://127.0.0.1:10000/
```

That sends 100 messages to `carto/load-test` in bursts of 5, with payload sizes randomized between 600 KiB and 900 KiB.

Example heavier run:

```bash
npm run load:test -- --endpoint ws://127.0.0.1:10000/ --count 200 --burst 10 --pause-ms 50 --min-kib 600 --max-kib 900
```

Useful flags:

- `--keyexpr` to isolate the test stream
- `--format json|text` to switch payload shape
- `--count` to control total messages
- `--burst` and `--pause-ms` to shape the send rate

## Scenario Pack

Carto includes a repeatable Zenoh demo covering steady JSON telemetry, structured events,
plain text, opaque binary payloads, two Protobuf message types, concurrent bursts, large JSON
snapshots, and put/delete lifecycle traffic.

1. In Carto, open **Settings → General → Import settings** and select
   [`examples/carto-zenoh-scenarios.json`](../examples/carto-zenoh-scenarios.json). Leave
   **Merge with existing settings** enabled to preserve your current configuration.
2. Connect with the imported **Local scenario router** profile.
3. Subscribe to `carto/demo/**` for the complete stream, or select one of the imported focused
   key expressions. Use `carto/demo/protobuf/**` to exercise the preconfigured multi-type
   Protobuf decoder.
4. Run the complete pack continuously, stopping it with `Ctrl+C`:

```bash
npm run scenario:run
```

The same JSON file is both the Carto settings import and the scenario runner's manifest, so its
topics, schemas, and sample publisher drafts stay aligned with what the script sends.

Useful variants:

```bash
# See every scenario and topic without connecting.
npm run scenario:list

# Run only selected scenarios.
npm run scenario:run -- --scenario telemetry-json,protobuf-telemetry

# Run one cycle and exit.
npm run scenario:once

# Repeat a burst three times with no intentional delay, then exit.
npm run scenario:run -- --scenario burst --cycles 3 --pace 0

# Use another endpoint or a compatible scenario/settings pack.
npm run scenario:run -- --endpoint ws://192.168.1.20:10000/ --pack ./my-pack.json
```

## Packaging

Package for your current operating system:

```bash
npm run dist
```

Build per platform:

```bash
npm run dist:mac
npm run dist:win
npm run dist:linux
```

Release builds use Electron and electron-builder. The GitHub Actions workflow builds on Windows, macOS, and Linux. Run platform-specific packaging on the corresponding operating system.

## Backend performance checks

See the [backend performance and memory audit](backend-performance.md) for findings, remaining limits, and an isolated generated-traffic benchmark. The benchmark uses an in-memory driver and does not contact Zenoh:

```bash
node --expose-gc --import tsx scripts/backend_benchmark.ts
```
