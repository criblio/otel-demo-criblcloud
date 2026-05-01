# Fork: `criblio/opentelemetry-demo`

The `opentelemetry-demo/` submodule points at our fork at
[`criblio/opentelemetry-demo`](https://github.com/criblio/opentelemetry-demo),
not the upstream repo directly. The fork was created on 2026-05-01 so we
can carry Cribl-only patches (load-generator changes, baggage span
processors, etc.) on long-lived branches while still tracking upstream.

## Remotes

Inside `opentelemetry-demo/`:

- `origin` → `https://github.com/criblio/opentelemetry-demo` (fork)
- `upstream` → `https://github.com/open-telemetry/opentelemetry-demo` (read-only sync source)

## Long-lived branches per concern

Each Cribl-only patchset lives on its own long-lived branch off `main`,
named `cribl/<concern>`:

- `cribl/baggage-span-processor` — SDK-side `BaggageSpanProcessor` wired
  into the load generator and frontend BFF (and later, more services).
- `cribl/load-generator-traffic` — load-shape and persona changes (#3 from
  `docs/load-generator-traffic-plan.md`).
- `cribl/load-generator-diversity` — request-attribute diversification
  (#4 from the same plan).

**Why one branch per concern, not one big `cribl/main`:** keeps each
patchset rebaseable against upstream independently. If upstream changes
the locustfile structure, only the load-gen branches need attention.

## Rebasing on upstream

```bash
cd opentelemetry-demo
git fetch upstream
git checkout cribl/<concern>
git rebase upstream/main
# resolve conflicts, force-push to fork
git push --force-with-lease origin cribl/<concern>
```

When the parent repo's submodule pin needs to advance, point it at the
merged result of the relevant `cribl/<concern>` branches (typically
through a `cribl/integration` branch that merges them — TBD when we have
more than one branch in flight).

## Image hosting

Custom-built images (load-generator at minimum) are published to
`ghcr.io/criblio/opentelemetry-demo:<upstream-tag>-<concern>-<short-sha>`
or similar — final naming TBD when the first image is published. The k8s
manifest in this repo (or a Cribl overlay) is what points at those
custom images; upstream's manifest still refers to upstream's prebuilt
images.

## What stays in this (parent) repo vs. the fork

- **Fork** (`opentelemetry-demo/`): any change to the demo's own source
  code, Helm chart, or upstream k8s manifest.
- **Parent repo** (`otel-demo-criblcloud`): Cribl-side overlay
  (`k8s/helm-values-cribl.yaml`), our deploy scripts, the Cribl Search
  App in `oteldemo/`, and docs like this one.
