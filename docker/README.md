# Zenoh Docker Setup for Carto

This folder runs a local Zenoh router with `zenoh-plugin-remote-api` enabled,
so Carto can connect without requiring a manual Zenoh installation.

## Why use this

- Quick local environment for Carto development and testing
- Reproducible Zenoh router setup with the Remote API plugin
- Easy starting point for integrating Zenoh into Docker workflows

## Run

From the repository root:

```bash
cd docker
docker compose up --build
```

Remote API endpoint:

```text
ws://localhost:10000
```
