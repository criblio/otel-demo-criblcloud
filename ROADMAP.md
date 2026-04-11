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

### 2. Alerting + SLOs (via Cribl Saved Searches + alerts, no KQL exposed)

The single biggest reactive-to-proactive upgrade. For each of the
primary objects the app shows (service, operation, edge, log stream),
provide a "Create alert" affordance that:

- Captures the current filter context (service, operation, severity,
  range)
- Asks for a threshold in plain terms ("error rate > 5%", "p95 > 2s",
  "request rate drops by 50%")
- Generates a KQL saved search behind the scenes
- Creates a Cribl alert against that saved search
- Stores app-level metadata (alert name, owning view, UI context) in
  the pack-scoped KV so we can render a coherent "Alerts" page

SLOs sit on top of the same plumbing — an SLO is an alert + budget
tracking over a longer window, both expressible as saved searches.

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
  sortable columns
- Search: fixed-shape form with service / operation / tags / duration
  / limit / lookback; results table; stream-noise trace filter
  respected (via Settings toggle)
- Logs: standalone log search tab with service / severity / body / limit
  / range filters; sticky facet sidebar; fills vertical viewport
- Compare: two-trace structural diff
- System Architecture: force-directed + isometric graphs, pan+zoom,
  edge-level health, messaging edges, node hover tooltip with
  lazy-loaded operations breakdown, edge hover tooltip with rich card
- Service Detail: RED charts (rate, error, p50/p95/p99), top
  operations, recent errors, dependencies, p99 delta chip
- Trace detail: waterfall, span detail with attributes / events /
  logs / process tags / exception stack traces, trace logs tab
- Settings: dataset selection + stream-filter toggle, persisted in
  pack-scoped KV
- Infrastructure: CLAUDE.md, FAILURE-SCENARIOS.md reference,
  scripts/flagd-set.sh helper for flipping demo flags

## Next up

**Metrics support** — see priority #1 above. First concrete step is
to inspect the metric record schema in the `otel` dataset so we know
what we're working with. Then build the query layer, then a Metrics
tab in the navbar.
