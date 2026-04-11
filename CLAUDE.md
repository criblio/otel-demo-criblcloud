# otel-demo-criblcloud

This repo has two concerns:

1. **`oteldemo/`** — a **Cribl Search App** (Vite + React + TypeScript) that
   runs inside Cribl Search as a sandboxed iframe. This is the primary thing
   we develop here. Ship target: Cribl Cloud. Local dev via `npm run dev`
   inside `oteldemo/`; package for upload with `npm run package`.
2. **Kubernetes/OTLP plumbing** (`k8s/`, `scripts/`, `opentelemetry-demo/`,
   root `.env`) — stands up the upstream OpenTelemetry Demo in a local kind
   cluster and ships its telemetry to a Cribl Search environment so the app
   has real data to visualize. See root `README.md`.

## Developing the Cribl Search App (`oteldemo/`)

**Read `oteldemo/AGENTS.md` before making changes to the app.** It is the
authoritative developer guide for the Cribl App Platform and covers things
that are not obvious from the code:

- Global `window.CRIBL_API_URL` / `window.CRIBL_BASE_PATH` injected by the host
- The automatic `fetch()` proxy (auth injection, pack-scoped URL rewrites,
  external domain routing, 30s timeout)
- `config/proxies.yml` — every external domain the app calls must be
  declared here with path/header allowlists and KV-backed header injection
- Scoped KV store endpoints under `CRIBL_API_URL + '/kvstore/...'`
- Config-group contextual APIs: search endpoints **must** use
  `/m/default_search/search/...`
- React Router: `basename={window.CRIBL_BASE_PATH}`
- Parent/child navigation sync via `pushState`/`popstate`

When building a feature, inspect the relevant Cribl REST APIs first (the
Cribl MCP server is wired up via `.mcp.json` — use it to list datasets,
run searches, etc.) and consult `oteldemo/AGENTS.md` for platform rules
before writing app code.
