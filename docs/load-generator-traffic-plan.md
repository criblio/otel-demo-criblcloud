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
   recommendation (Python), frontend BFF (Node.js).** Most APM-relevant
   downstream services + the frontend's server side. After this, the APM
   app should be able to group most traces by session.
4. **#4 — diversify request attributes**, including occasional invalid
   product IDs / malformed payloads to drive 4xx error traffic.
5. **#3 — non-uniform traffic shape via `LoadTestShape` + persona-based
   `HttpUser` classes.**
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
- For #3, do we want the load shape to be deterministic (same pattern
  every day, easy to validate APM features against) or randomized (more
  realistic-looking)?
- Fork hosting: do we publish the custom load-generator image to GHCR
  under `criblio/`, or to an internal Cribl registry?
