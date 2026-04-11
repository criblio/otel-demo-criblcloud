# Trace Explorer — Roadmap

This document is the canonical priority list for the `oteldemo/` Cribl
Search App. It captures the competitive gap analysis we ran against
Datadog, Honeycomb, Dash0, Kloudfuse, Grafana Tempo/Loki, New Relic,
and Sentry, plus the architectural insight that we're built on top of
Cribl Search and should lean on its primitives (saved searches,
alerts, query language, federation) rather than reinvent them.

> **Refer to this doc as `ROADMAP.md`** (or `/ROADMAP.md` from the repo
> root). Companion docs: `FAILURE-SCENARIOS.md` for the flagd flag
> catalog and test plan; `CLAUDE.md` for repo-wide coding rules;
> `oteldemo/AGENTS.md` for the Cribl App Platform developer guide.

## Guiding principle: lean on Cribl Search

The Trace Explorer runs *inside* Cribl Search. Cribl Search already
provides:

- **Saved searches** — named, shareable KQL queries with persistence
- **Scheduled searches** — run a query on a cron and act on the result
- **Alerts / notifications** — monitor a saved search and trigger
  webhooks, Slack, email, PagerDuty
- **KQL** — rich query language for slicing spans, logs, and metrics
- **Federation** — queries can fan out across multiple datasets and
  worker groups
- **Pack-scoped KV store** — for app-level settings and state

So we do **not** need to reinvent alerting, dashboards, saved searches,
or a query language from scratch. What we need is a **domain-specific
UI on top of those primitives** that speaks traces / logs / metrics
rather than raw KQL. Users of our app should never have to know they
can drop into a KQL editor — the app should translate their
intentions into saved searches and alerts behind the scenes.

Concretely, that shapes every roadmap item:

- "Alerting" → a **"Create alert"** button on Home catalog rows,
  ServiceDetail, and arch graph that builds a saved-search + alert
  definition under the hood, then calls the Cribl API to persist it
- "Saved views" → Cribl saved searches owned by the app, tagged with
  a `traceexplorer:view` tag so we can list and render them
- "Dashboards" → a set of saved searches composed into a page; still
  backed by Cribl, rendered by us
- "Query language" → we keep the guided forms as the primary surface
  but expose an optional "Edit as KQL" escape hatch for power users

The rest of this document groups features by the Cribl Search
capability they'd ride on.

---

## Priorities (in rough order)

### 1. Metrics support — **NEXT**

Currently the app covers spans and logs only. OTel metrics land in the
same pipeline and almost certainly in the `otel` dataset alongside the
span / log records we already read, but we have zero coverage. Metrics
is the most fundamental missing pane of glass and blocks things like:

- RED charts backed by metric histograms instead of raw span
  aggregations (cheaper at scale)
- Resource / infra context (CPU, memory, GC, JVM pool sizes)
- Kafka consumer lag metrics, queue depths
- Business metrics piped in alongside telemetry

**First step:** investigate the metric record schema in the `otel`
dataset — how are OTLP metrics materialized, what fields identify
name/unit/type, how are histogram buckets stored, how is metric
attribute vs. resource attribute handled. Once the schema is clear,
build query templates (counter rate, gauge latest, histogram
percentile), then a Metrics explorer tab with service / metric name /
attribute filters and time-series plotting.

This work may also benefit from a new query builder pattern the other
features can reuse.

### 2. Durable baselines, alerts, and SLOs (via scheduled Cribl Saved Searches)

One shared infrastructure problem unblocks three features at once:
durable baselines for anomaly detection, user-facing alerts, and SLO
budget tracking. All three need the app to **provision scheduled
Cribl Saved Searches** at install time (or on first run), keep them
up-to-date across upgrades, and consume their persisted output.

**Why this is now priority 2**: The current `listOperationAnomalies`
baseline is a ~24h span-range query fired at page load. That's
expensive (scans every span in 24h on every Home refresh), fragile
(a multi-day incident poisons the baseline), and impossible to
extend to week-over-week comparisons or seasonality. The only
sustainable answer is a scheduled search that computes per-(svc, op)
p50/p95/p99 on a rolling basis, persists the results somewhere
queryable, and lets the UI read them cheaply.

Same pattern, same plumbing works for alerts: "create alert" on a
catalog row → app persists a new scheduled saved search + threshold
evaluation, stores metadata so the Alerts page can render it. And
for SLOs: a scheduled search that tracks error budget over a rolling
28-day window.

#### 2a. Research tasks (do these first — they determine the shape)

Detailed findings from the first research pass live in
[`docs/research/cribl-saved-searches.md`](docs/research/cribl-saved-searches.md).
Status of each question below is **RESOLVED** / **PARTIAL** /
**OPEN**.

- ✅ **RESOLVED — Saved search provisioning API.** Cribl Search
  exposes `/api/v1/m/default_search/search/saved` (list, create),
  `/search/saved/:id` (get, patch, delete),
  `/search/saved/:id/notifications` (create notification),
  `/search/saved/:id/notifications/:nid` (patch, delete). Full
  schema captured from live examples including `schedule`, `cron`,
  `keepLastN`, and nested `notifications.items[]` with
  `triggerType/triggerComparator/triggerCount` + `targets` +
  message templating. **One API covers saved searches AND
  scheduled searches AND alerts** — there is no separate alert
  system. **No TypeScript SDK for Cribl Search saved searches**
  exists yet; the official `cribl-control-plane` and
  `cribl-mgmt-plane` SDKs are Stream/Workspace-focused.
- ✅ **RESOLVED — Auth context inside the pack iframe.** The
  platform fetch proxy injects the user's Auth0 Bearer JWT
  automatically on any call to `CRIBL_API_URL`. Same mechanism
  we already use for `/search/jobs` → works unchanged for
  `/search/saved/*`. No new auth plumbing needed.
- 🟡 **PARTIAL — Scheduled-search result persistence + `$vt_*`.**
  We observed `cribl dataset="$vt_dummy"` in a live saved search,
  confirming `$vt_*` virtual tables exist. `/search/datasets`
  does NOT list them, so they're ephemeral / virtual. Hypothesis:
  a scheduled search's output auto-materializes to `$vt_<id>`,
  queryable from subsequent queries. **Needs confirmation** —
  prototype by provisioning a scheduled search via direct REST
  POST, waiting for a run, and inspecting whether
  `$vt_<savedQueryId>` becomes queryable. Alternative paths if
  `$vt_` is a dead end: Cribl lookups (`lookup` keyword is used
  in existing searches, so they exist and are joinable) or
  pack-scoped KV writes from a polling client.
- 🟡 **PARTIAL — `/search/saved/:id/results` endpoint.** The JS
  bundle's `getResults(id)` constructs
  `/search/saved/${id}/results`, but a direct GET returned 404
  for `tailscale_offline` (which has `schedule.enabled=true`).
  Either the endpoint requires a different prefix, or results
  only persist when a run produced non-empty output (and this
  alert is firing on an empty result set). **Needs a test
  provisioned scheduled search that we know will produce output.**
- 🟡 **PARTIAL — Install-time hook on the App Platform.**
  `oteldemo/AGENTS.md` does not mention one. Pending a definitive
  answer from the Cribl team, assume **no hook exists** and
  design around a first-run provisioning dialog (§2e below).
  This is a natural platform feature request to file regardless.
- **OPEN — Idempotent naming + upgrade path.** Proposal on the
  table: prefix all app-managed IDs with `traceexplorer__` so
  the pack can `GET /search/saved?prefix=traceexplorer__` (if the
  list endpoint supports filtering — unconfirmed), diff against
  the expected set, and upsert / delete stale rows. Upgrade
  schema migrations would bump a `traceexplorer_version` row in
  the pack-scoped KV store and run one-time migrations keyed
  off it. Never touch rows whose ID doesn't match our prefix.
- **OPEN — Notification targets.** The `tailscale_offline` saved
  search references `targets: ["typhoon_ntfy"]`, but calling
  `/notifications/targets` returned 0 items. The targets live at
  some path we haven't found yet — possibly
  `/search/notification-targets`, `/notifications/channels`, or
  under a product-scoped prefix. Must resolve before §2c (user
  alerts) because creating an alert requires selecting a target.

**Next concrete research steps** (for the follow-up session):

1. Capture a live POST body by driving the Save-As flow in the
   UI and watching the network tab. Automation got close but the
   Save button label varies by page; try a DOM-targeted click
   instead of text-based.
2. Write a `scripts/probe-saved-search.mjs` that reads the Auth0
   JWT from the live browser's localStorage, POSTs a test saved
   search with `schedule.enabled=true` and a short cron, waits
   for a run, and inspects `/results` + `$vt_<id>` + lookups.
3. File a Cribl platform feature request for an install-time
   hook if confirmed missing.

#### 2b. Durable baseline for latency anomaly detection

Replaces the in-memory 24h baseline in `listOperationAnomalies`:

- A scheduled search runs every N minutes, computing per-(service,
  operation) p50/p95/p99 over a rolling baseline window (7 days,
  excluding the most recent hour so fresh incidents don't pollute
  the baseline)
- Results persist to the chosen target (KV / lookup / dataset)
- The app reads the latest baseline row on page load — one cheap
  lookup instead of a 24h span aggregation — and compares against
  the current window
- Gracefully degrades: if the baseline hasn't been populated yet
  (first run, upgrade), fall back to the current in-memory 24h
  approximation

#### 2c. User-facing alerts

- "Create alert" button on Home catalog rows, Service Detail, edges,
  and logs — captures the current filter context and surfaces a
  plain-language threshold form ("error rate > 5%", "p95 > 2s",
  "request rate drops by 50%", "op p95 > N× baseline")
- Under the hood the app generates a KQL saved search, creates a
  Cribl alert against it via the same provisioning pipeline, and
  stores app-level metadata (alert name, owning view, UI context)
- Rendered on an "Alerts" page that lists all app-managed alerts,
  their current state, recent firings, and a link back to the view
  where they were created

#### 2d. SLO budgets

Thin layer on top of 2c. An SLO is a saved search that tracks
(success count / total count) over a 28-day rolling window, plus a
budget burn rate. Same provisioning plumbing, different threshold
semantics and UI (error budget remaining, burn alerts at 1h / 6h /
24h windows).

#### 2e. First-run workflow + upgrade handling

Assuming no install hook exists:

- On first load, the app checks KV for a `provisioned-version` key
- If absent or stale, show a one-time dialog: "Trace Explorer needs
  to create N scheduled searches to power baselines and alerts.
  [Create them]"
- App calls the saved-search API with idempotent names; if a search
  already exists, update it in place
- Write `provisioned-version` to KV on success
- On app upgrade, the same check runs: if stored version differs from
  current, run the diff and update / add / remove scheduled searches
  as needed. Never delete user-created searches.

### 3. Error tracking / Errors Inbox

We already have an "Error classes" panel that groups by
`(service, operation, first-line-of-message)`. Upgrade it into a
first-class feature surface:

- Better grouping key: `(service, operation, exception.type,
  normalized stack frame hash)` — Sentry-style fingerprinting
- First-seen / last-seen / count sparkline per fingerprint
- State: new / investigating / resolved / ignored, stored in the
  pack-scoped KV
- Regression detection: alert when a resolved fingerprint reappears
- Sample traces + sample logs attached to each fingerprint
- Assignment (freeform user string for now)

### 4. Saved views and dashboards (via Cribl Saved Searches)

Users need to bookmark a filter configuration and return to it. Today
we have zero persistence; every Search or Logs session starts empty.

- "Save this view" button on Home / Search / Logs / ServiceDetail /
  SystemArch — writes the current filter state to a Cribl saved
  search with a pack tag
- A "Saved views" menu in the navbar that lists them, groups by tag
- Composable dashboards: a page that renders multiple saved views as
  widgets

### 5. Ad-hoc span/log query with faceted exploration

Today the Search form is fixed-shape: service, operation, tags as
free text, min/max duration, limit. Every commercial APM lets users
query on arbitrary attributes with autocomplete.

- Typed filter builder: pick an attribute name from an autocomplete
  list of known attributes, pick an operator, pick a value
- Multi-condition AND/OR with grouping
- Attribute value facets — show the top values of a dimension with
  counts, click to filter
- Cardinality-aware autocomplete (don't load 50k distinct values)
- "Edit as KQL" escape hatch that shows the underlying Cribl query
  for power users

The facet UX mirrors BubbleUp / Datadog facets / Honeycomb queries.
Since Cribl KQL already has the query language, this is purely a UI
layer.

### 6. Flame graph + critical path on Trace detail

The current trace detail is a Gantt waterfall. Add:

- **Flame graph / icicle chart** — stacked rectangles showing
  self-time per call path; better for spotting hot subtrees in a
  50+-span trace
- **Critical-path highlighting** — marks the spans whose latency
  drove the trace's end-to-end duration (ignores parallel siblings)
- **Latency histogram** on the span detail panel for the operation's
  distribution in the current range (reveals bimodality that
  percentile lines hide)

### 7. Live tail

Streaming logs and recent spans as they arrive, like `kubectl logs -f`
or Datadog Live Tail. Cribl Search supports streaming query results;
wire it into the Logs page as a "Tail" button that switches from
paginated results to an auto-scrolling live view.

### 8. Continuous profiling (whole new category)

CPU / memory / lock profiling via eBPF or pprof, rendered as flame
graphs, linked to trace spans via profiling IDs. Pyroscope-compatible
if Cribl can ingest that format. Lower priority — entire new data
shape.

### 9. Real User Monitoring (whole new category)

Browser / mobile SDKs, page load timings, JS errors, session replay,
web vitals, user journeys. Would let us detect things like
`imageSlowLoad` that are invisible to backend APMs. Significant scope.

### 10. Synthetics / uptime (whole new category)

Scheduled HTTP + browser checks from multiple regions with alerting.
Could potentially be a scheduled saved search that uses Cribl's HTTP
collector as the probe target. Lower priority but also not huge.

### 11. Natural language / AI query

Dash0, Datadog Bits AI, Honeycomb Query Assistant, New Relic Grok —
every competitor is shipping something here. Could be a simple pass:
the app forwards the user's prompt + a schema hint to an LLM, gets
back a KQL query, runs it via Cribl. Ride on Cribl's query
infrastructure rather than building our own.

### 12. Service catalog / ownership / team metadata

Tag services with owning team, oncall, runbook URL, repository link,
on-call schedule. Route alerts by ownership. Store in pack-scoped KV.
Backstage-style but lightweight.

### 13. Database query performance

Top slow queries, query fingerprints with execution plans, linked to
traces via `db.statement` / `db.system`. Requires schema support in
the query layer but otherwise rides on existing span data.

---

## Smaller gaps (cheap wins, not a roadmap priority)

- Span attribute autocomplete on the Search tags field
- Trace export (JSON / OTLP)
- Copy-as-URL shareable view links
- Latency histogram column on Top Operations
- Annotations / notes on traces

## Things we have that ARE competitive

Being honest about the wins too:

- **Baseline delta chips** — surfacing regressions against previous
  window directly on catalog rows; most cheaper competitors don't do
  this
- **Messaging edges on the arch graph** — reconstructed from OTel
  `messaging.*` attributes. Most backends only show RPC edges.
- **Noise filter** on trace aggregates — hides streaming /
  idle-wait spans from percentiles. Novel.
- **Edge-level health** on the graph, not just node-level
- **Lazy-loaded hover details** on arch nodes (top operations, erroring
  operations) with a module-level cache

---

## Status snapshot (what's already shipped)

As of the last commit on `jaeger-clone`:

- Home: service catalog with rate / error / p50/p95/p99 columns, delta
  chips vs. previous window, error classes, slowest trace classes,
  **latency anomalies widget** (ops ≥5× baseline p95), sortable columns
- **Health buckets**: error-rate (watch/warn/critical) + `traffic_drop`
  (rate fell ≥50% vs prior window) + `latency_anomaly` (op p95 ≥5×
  baseline). Precedence: critical > warn > latency_anomaly >
  traffic_drop > watch > healthy > idle. Row tints on Home catalog,
  halo rings on System Architecture nodes.
- Search: fixed-shape form with service / operation / tags / duration
  / limit / lookback; results table; stream-noise trace filter
  respected (via Settings toggle)
- Logs: standalone log search tab with service / severity / body / limit
  / range filters; sticky facet sidebar; fills vertical viewport
- Metrics: Datadog-style explorer tab with metric picker, group-by
  dimensions, rate-of-counter derivation, histogram percentile from
  means
- Compare: two-trace structural diff
- System Architecture: force-directed + isometric graphs, pan+zoom,
  edge-level health, messaging edges, node hover tooltip with
  lazy-loaded operations breakdown + traffic-drop delta, edge hover
  tooltip with rich card
- Service Detail: RED charts (rate, error, p50/p95/p99), top
  operations, recent errors, dependencies, p99 delta chip, **Dependency
  latencies / Runtime health / Infrastructure metric cards** (batched
  single query)
- Trace detail: waterfall, span detail with attributes / events /
  logs / process tags / exception stack traces, trace logs tab
- Settings: dataset selection + stream-filter toggle, persisted in
  pack-scoped KV
- Infrastructure: CLAUDE.md, FAILURE-SCENARIOS.md reference, Cribl MCP
  server wired via `.mcp.json`, scripts/flagd-set.sh helper,
  scripts/cribl-mcp.sh container manager, browser automation helpers

## Next up

**Durable baselines + alerts (priority #2)** — the in-memory 24h
baseline now powering the latency-anomaly widget is a stopgap. The
real answer is scheduled Cribl Saved Searches that persist rolling
baselines the app can read cheaply. Start with the research tasks in
2a (provisioning API, scheduled-search execution model, persistence
target, install-time hook, idempotency) — those answers shape
everything else. Once the shape is clear, build the first-run
workflow in 2e, then migrate the anomaly detector in 2b off the
in-memory baseline.

Follow-up enhancements to the anomaly widget itself (after 2b lands):

- **Reason pills on each row**: today every row shows one number
  (ratio vs baseline). Add multi-heuristic tagging — ratio, absolute
  p95, volume jump, error-rate delta, child-attribution anomaly —
  so users can see *why* an op was flagged and disagree when needed.
- **Per-op anomaly signal on Service Detail**: highlight the
  individual row in the Top Operations table the same way the Home
  catalog tints the service row, with a tooltip explaining the
  baseline comparison.
