# Load Generator: more interesting traffic + `session.id` everywhere

## Problem

Two related issues with the upstream OpenTelemetry demo's load generator
(`opentelemetry-demo/src/load-generator/locustfile.py`):

1. **`session.id` is almost never present in emitted telemetry**, even though
   the load generator does create one per Locust user.
2. **Traffic is uniformly distributed** — fixed task weights, uniform
   inter-arrival times, fixed product/category/currency, no personas, no
   bursts, no errors. The data lacks the patterns an APM is meant to surface.

## Why `session.id` is missing

- `locustfile.py:209-216` (`on_start`) generates a `session_id` and stores it
  via `baggage.set_baggage("session.id", session_id)`. Baggage is propagated
  to downstream services as the `baggage:` HTTP header but **does not
  auto-promote to span attributes** anywhere in the pipeline.
- Only the **Ad service** materializes it:
  `src/ad/src/main/java/oteldemo/AdService.java:160-164` reads
  `baggage.getEntryValue("session.id")` and calls
  `span.setAttribute("session.id", ...)`. Every other backend (cart,
  checkout, payment, currency, recommendation, shipping, …) lets the
  baggage pass through untouched.
- The frontend's browser-side `SessionIdProcessor`
  (`src/frontend/utils/telemetry/SessionIdProcessor.ts:18`) stamps
  `session.id` on every browser span — but Locust's `HttpUser` calls the BFF
  directly and never executes browser code. `PlaywrightUser` does, and
  `LOCUST_BROWSER_TRAFFIC_ENABLED=true` is set
  (`kubernetes/opentelemetry-demo.yaml:12290`), but its tasks are limited to
  two short flows (currency change, add-to-cart).
- The collector's `transform` processor
  (`kubernetes/opentelemetry-demo.yaml:321-327`) only normalizes span names
  — no baggage→attribute promotion.

Net effect: `session.id` shows up on Ad spans and on the handful of browser
spans produced by `PlaywrightUser`, and essentially nowhere else.

## Why traffic looks "evenly distributed"

- `wait_time = between(1, 10)` → uniform inter-arrival times, no peaks/valleys.
- 10 hard-coded product IDs, fixed currency, no `User-Agent` /
  `Accept-Language` / geo variation.
- Static task weights — every Locust user behaves identically; no personas.
- No error-prone paths, no abandonment, no return-visitor sessions.
- The one knob for variety, `loadGeneratorFloodHomepage` via flagd, is off
  by default.

## Plan

Roughly ordered cheapest → most invasive. Each step is independent.

### 1. Promote `baggage[session.id]` to span attribute via SDK-side `BaggageSpanProcessor`

**Original plan was wrong.** The collector cannot do this: OTLP does not
carry baggage, so by the time spans reach the collector the baggage header
is gone. Verified against `pkg/ottl/contexts/ottlspan/README.md` and
`pkg/ottl/contexts/ottlspan/span.go` in the contrib repo — the OTTL `span`
context exposes no `baggage[...]` accessor, and there is no
`baggageprocessor` in collector-contrib.

The correct mechanism is the **`BaggageSpanProcessor`** that ships in
each language's contrib repo. It reads baggage from the active context on
span start and copies entries into span attributes — locally, in-process,
in every service that wants the attribute on its spans.

This means **#1 is no longer collector-local**. It requires touching every
service whose spans we want tagged with `session.id`, which means we need
the upstream fork as a prerequisite for #1 too — same as #3/#4.

Per-language packages:

- Python: `opentelemetry-processor-baggage` (load generator)
- Java/Kotlin: `io.opentelemetry.contrib:opentelemetry-baggage-processor`
  (ad — already does this manually; fraud-detection)
- JS/TS: `@opentelemetry/baggage-span-processor` (frontend, payment,
  react-native-app)
- Ruby: `opentelemetry-processor-baggage` (email)
- Go: no off-the-shelf contrib package — we'd hand-roll a span processor
  that mirrors the BaggageSpanProcessor pattern (accounting, checkout,
  product-catalog, etc.)
- Other languages (.NET cart, C++ currency, PHP quote, Rust shipping):
  verify availability when we get to them

The Ad service (`src/ad/src/main/java/oteldemo/AdService.java:160-164`)
already does this manually — replacing the manual code with the contrib
processor would be a small cleanup.

#### Pragmatic scoping

Doing this across all ~10 service languages is real work. Suggested
phasing:

1. **Phase 1a — load gen (Python).** Tag spans at the request entry
   point so every outgoing HTTP request carries `session.id` baggage.
2. **Phase 1b — high-value backend services + frontend BFF**: cart
   (.NET), checkout (Go), payment (Node.js), recommendation (Python),
   frontend BFF (Node.js). Promote the inbound baggage to span
   attributes so APM-side queries can group by `session.id`.
3. **Phase 1c — everyone else**, only if needed.

Each phase ships independently. Stop early if the APM app's session
grouping is already useful after 1a/1b.

#### Phase 1a — what actually shipped

Phase 1a turned out to be **two patches**, not one:

1. **`BaggageSpanProcessor` wired in.** Adds
   `opentelemetry-processor-baggage` to the load gen's `TracerProvider`
   with a `session.id`-only allowlist. Stamps `session.id` on every
   span where it's present in the active baggage context.
2. **Locustfile baggage-context fix.** Upstream's locustfile attaches
   baggage in `on_start()` then opens every task span with
   `context=Context()` — an empty parent context — which **replaces the
   active context** for the duration of the `with` block, nuking the
   baggage before HTTP requests fire. Our overlay stashes the baggage'd
   context as `self.session_context` and threads it through every
   `start_as_current_span` call. Preserves "each task is a separate
   trace root" semantics while letting baggage flow.

Both patches live on `cribl/baggage-span-processor` in the fork.
Verified end-to-end on 2026-05-01: `session.id` appears on
load-generator spans (366/3min) and propagates via the `baggage:` HTTP
header to the Ad service (which has manual baggage→attribute code
upstream — proving the propagation works for any service that wants to
read it).

#### Phase 1b — what actually shipped

Wired the contrib `BaggageSpanProcessor` (or hand-rolled equivalent) into
five services. Verified 2026-05-01 against a steady-state ~10-user
locust load over a 2-min window, all on `cribl/baggage-span-processor`:

| Service        | session.id coverage |
|----------------|---------------------|
| load-generator | 63/63   (100%)      |
| cart           | 147/147 (100%)      |
| checkout       | 416/416 (100%)      |
| payment        | 60/60   (100%)      |
| recommendation | 90/90   (100%)      |
| frontend       | 187/187 (100%)      |

Most services were a one-liner: drop in the language-native contrib
`BaggageSpanProcessor` with a `session.id`-only allowlist.

**Cart (.NET) was three layered fixes**, each of which would not have
been obvious without empirical iteration:

1. **`OnEnd` instead of `OnStart`.** OpenTelemetry .NET's
   `AspNetCoreInstrumentation` creates the inbound server `Activity`
   *before* its `HttpInListener` observes the diagnostic event and
   extracts baggage from headers into `Baggage.Current`. So the
   processor's `OnStart` sees an empty bag for the server span. By
   `OnEnd`, extraction has run.
2. **`EnrichWithHttpRequest` callback that captures into a
   process-static `SessionScope` table keyed by `ActivityTraceId`.**
   `StackExchange.Redis` dispatches Redis commands via a
   `ConnectionMultiplexer` whose worker threads sit outside the
   request's `AsyncLocal` flow, so `Baggage.Current` is empty in those
   threads even at `OnEnd`. The Enrich callback runs on the request's
   async context (after baggage extraction), so it can stash the
   value where any descendant span can find it by trace ID.
3. **TTL-based eviction (1 minute), not release-on-root-end.**
   `OpenTelemetry.Instrumentation.StackExchangeRedis` batches its
   profiler-entry-to-`Activity` conversion via a Timer (default
   `FlushInterval = 10s`), so Redis spans are created seconds *after*
   the originating request has already completed. Releasing the
   `SessionScope` entry on root-span `OnEnd` deleted it just before
   the deferred Redis spans came looking. A sliding TTL longer than
   the flush window keeps the entry alive until the spans land.

The cart fix lives in `src/cart/src/Telemetry/BaggageSpanProcessor.cs`
(processor + `SessionScope`) and `src/cart/src/Program.cs` (the
`AddAspNetCoreInstrumentation` Enrich callback). Other services use
the off-the-shelf processor without a fallback because their language
runtimes don't have either of these gotchas.

### 2. (Subsumed into #1.)

The original #2 — stamping `session.id` on the Locust-emitted spans —
falls out for free once we add `BaggageSpanProcessor` to the load
generator's `TracerProvider` in Phase 1a. No separate step needed.

### 3. Make traffic shape less uniform

Replace the flat `between(1, 10)` with dynamic patterns:

- **`LoadTestShape`** (Locust built-in) for daily/hourly cycles or burst
  patterns. e.g., a sine wave with one or two flash-sale spikes.
- **Multiple `HttpUser` classes with different `weight`s** to model personas:
  - Browser: lots of `index` + `browse_product`, low cart conversion.
  - Buyer: short browse → checkout.
  - Abandoner: adds to cart, never checks out.
  - Mobile (smaller catalog interactions, different UA).

### 4. Diversify request attributes

- Rotate `Accept-Language` / `User-Agent` headers per user.
- Expand product/category lists (currently 10 IDs).
- Vary `currencyCode` across users (drives the currency service).
- Occasionally hit invalid product IDs / malformed payloads to drive 4xx
  paths and exercise error-discovery features in the APM app.

### 5. Expand `PlaywrightUser` flows

Most expensive but produces the most realistic browser-side telemetry — and
since the browser-side `SessionIdProcessor` already stamps `session.id`,
these flows naturally diversify session-tagged spans.

- Add: search, multi-product browse, full UI checkout, login flow,
  view-recommendations.
- Optionally: leave heavy flows behind a flagd flag for cluster-load
  control.

## Decisions (2026-05-01)

**Doing:** #1 (revised — SDK-side, phased), #3, #4. **Deferred / subsumed:** #2, #5.

### Order of execution

1. **Fork `open-telemetry/opentelemetry-demo` into `criblio/`.** Now a
   prerequisite for #1 as well, since #1 requires SDK changes in each
   service. Set up a long-lived Cribl branch and a build pipeline for at
   least the load-generator image; other service images can use upstream
   until we touch them. Settle GHCR-vs-internal-registry hosting up front.
2. **#1 Phase 1a — load generator (Python).** ✅ Shipped 2026-05-01.
   Two patches on `cribl/baggage-span-processor`:
   `BaggageSpanProcessor` wired in + locustfile baggage-context fix.
3. **#1 Phase 1b — cart (.NET), checkout (Go), payment (Node.js),
   recommendation (Python), frontend BFF (Node.js).** ✅ Shipped
   2026-05-01. All five services + load-generator at 100% session.id
   coverage in steady state. Cart took three iterations over a .NET-
   specific timing chain (OnStart vs OnEnd, AsyncLocal flow across
   StackExchange.Redis multiplexer threads, Redis instrumentation's
   batched flush timer) — see the "Phase 1b — what actually shipped"
   subsection above.
4. **#4 — diversify request attributes.** ✅ Shipped 2026-05-01. Adds
   per-user (Accept-Language, User-Agent) personas across desktop /
   mobile / a small slice of bot UAs; per-user `currencyCode` weighted
   toward USD; weighted product selection (Pareto-style head/tail);
   and a low-weight `bad_request` task that hits invalid product IDs
   (`DEADBEEF99`, `NOTAPRODUCT`, `12345`, `../../etc/passwd`, `%00`)
   producing a steady ~10% 4xx trickle. Per the "Downstream impact"
   section: NOT tagged with synthetic-marker baggage — the APM app
   must surface/group/silence these on its own merits.
5. **#3 — non-uniform traffic shape via `LoadTestShape` + persona-based
   `HttpUser` classes.** ✅ Shipped 2026-05-01. Four persona HttpUser
   classes (Browser w=6 / Buyer w=2 / Abandoner w=2 / Mobile w=3) each
   with their own task mix and `wait_time`. Mobile is restricted to
   iPhone/Android `profile_pool`. Task bodies pulled into module-level
   functions taking `(user)` so personas compose via `tasks={fn:weight}`
   without inheritance gymnastics. `StagedSpike(LoadTestShape)` adds a
   deterministic 10-min cycle: warm 5 → ramp 15 → peak 25 → cool 10 →
   idle 5 users (deterministic per the open question — easier to validate
   APM features against a known curve than against random load).
   Verified 2026-05-01: at pod-age 27s locust showed 5 users, at 6m27s
   showed 10 (matching warm-up + cool-down stages); cart ops show the
   full task mix; Mobile UA share matched its weighted spawn ratio.
6. **#1 Phase 1c — remaining services**, only if the APM app still needs
   broader coverage.

### Downstream impact on the APM app

#4 will produce a steady trickle of 4xx responses caused by
intentionally-bad inputs from the load generator. Real production
deployments see the same shape: bots, scrapers, broken bookmarks, and
typo'd URLs all generate 404s the operator can do nothing about.

**The APM app must handle this on its own merits**, not by relying on
demo-side metadata to filter the noise out. The right behavior is for
error-discovery surfaces (Log Explorer, error rate panels, edge health,
slow trace classes) to be useful in the presence of background 4xx
traffic — e.g., separating 4xx from 5xx, weighting by volume, surfacing
*new* error patterns vs. baseline. We are not going to tag synthetic
errors with special baggage to make the app's job easier; if the app
can't cope with 404s from the load gen, it can't cope with 404s in
production.

Treat #4 as a forcing function for the APM app's noise-handling.

## Open questions

- Do we want `session.id` on logs and metrics too? (Logs: yes, for log
  correlation. Metrics: probably not — high cardinality.)
- ~~For #3, do we want the load shape to be deterministic (same pattern
  every day, easy to validate APM features against) or randomized (more
  realistic-looking)?~~ Decided 2026-05-01: deterministic
  (`StagedSpike` 10-min cycle). Randomized variants can be layered
  later if the APM app needs them.
- Fork hosting: do we publish the custom load-generator image to GHCR
  under `criblio/`, or to an internal Cribl registry?
