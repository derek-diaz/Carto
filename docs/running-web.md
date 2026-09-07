# Run Carto in a browser

[Back to the README](../README.md)

Web mode runs the same interface as the desktop app. Carto’s server connects to Zenoh on your behalf, so the router must be reachable from the machine or container running that server.

## Docker

```bash
docker run --rm -p 127.0.0.1:8080:8080 tabierto/carto:latest
```

Open [localhost:8080](http://localhost:8080), enter your router’s Remote API WebSocket address, and connect.

If the router runs on your Docker host, try `ws://127.0.0.1:10000/`. Carto translates loopback addresses to the container’s host. You can also use a router address reachable from the container network.

To build the current checkout instead of using a released image, run these commands from the repository root:

```bash
docker build -t carto-local .
docker run --rm -p 127.0.0.1:8080:8080 carto-local
```

The Carto container does not include a Zenoh router. See the separate [local router setup](../docker/README.md).

## Run from source

Use Node.js 24 or newer. From the repository root:

```bash
npm ci
npm run build:web
npm run build:server
npm run start:web
```

Open [localhost:8080](http://localhost:8080). Rebuild the web UI after editing frontend files; rebuild the server after editing server or shared backend code.

For frontend development with automatic refresh, use `npm run dev:web`. That command starts the renderer only; use the complete web build above to connect to the local server through one origin, or `npm run dev:desktop` for the desktop development workflow.

## Network access

Carto’s web server is for one user and binds to loopback by default. Keep the Docker port bound to `127.0.0.1` as shown above for local use.

For remote access, use an authenticated reverse proxy and explicitly configure `HOST` and `CARTO_ALLOW_REMOTE=1`. The server can connect to endpoints and read configured TLS files on its host, so it should not be exposed directly to an untrusted network.

| Setting              | Default     | Purpose                                  |
| -------------------- | ----------- | ---------------------------------------- |
| `HOST`               | `127.0.0.1` | Address the server listens on            |
| `PORT`               | `8080`      | Web server port                          |
| `CARTO_ALLOW_REMOTE` | Unset       | Set to `1` to permit a non-loopback bind |
| `CARTO_WEB_DIST`     | `dist/web`  | Built frontend directory                 |

## Connection troubleshooting

- **Carto opens, but cannot connect:** check that `zenoh-plugin-remote-api` is enabled and the WebSocket endpoint is reachable from the server or container.
- **The address looks right:** make sure it is the Remote API endpoint, usually port `10000`, rather than REST or the native Zenoh TCP endpoint.
- **Connected, but no keys appear:** discovery observes traffic during a short scan. Start a publisher, check access permissions and scope, then use **Scan again**.

For manual plugin installation, see [Zenoh’s container and plugin guide](https://zenoh.io/docs/getting-started/quick-test/#adding-plugins-and-backends-to-the-container) and the [Remote API plugin downloads](https://download.eclipse.org/zenoh/zenoh-plugin-remote-api/).
