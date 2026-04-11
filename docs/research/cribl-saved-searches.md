# Research: Cribl Saved Searches + Scheduled Searches + Alerts

Drives ROADMAP §2 — durable baselines, alerts, SLOs. Captured by
browser sniffing, JS bundle spelunking, and MCP-server reads of the
live `main-objective-shirley-sho21r7.cribl-staging.cloud` deployment.

Last captured: 2026-04-11.

## TL;DR

- **One API covers all of §2**: saved searches ARE scheduled searches
  ARE alerts. Adding a `schedule.enabled = true` + a
  `schedule.notifications.items[]` entry to a saved search is how you
  create a scheduled search with an alert.
- **No TypeScript SDK for Cribl Search saved searches.** The official
  `cribl-control-plane` and `cribl-mgmt-plane` SDKs are
  Stream/Workspace-focused; their `SavedJob` model is wired to
  `Collectors` (Stream collectors, not Search saved searches).
  We'll hit the REST API directly.
- **Auth from inside our pack iframe is free**: the platform fetch
  proxy injects `Authorization: Bearer <auth0-jwt>` automatically
  for any call to `CRIBL_API_URL + '/m/default_search/...'` — same
  mechanism we already use for `/search/jobs`.

## REST endpoints

All prefixed with `CRIBL_API_URL + '/m/default_search'`
(= `/api/v1/m/default_search` at the network layer). Verbs
confirmed via JS bundle spelunking (`main.js` and chunks on the
Cribl Search SPA).

| Verb | Path | Purpose |
|---|---|---|
| `GET` | `/search/saved` | List saved searches. Supports `?limit=N&offset=M`. Response is `{items: [...], count: N}`. |
| `POST` | `/search/saved` | Create saved search. Body is a saved-search object (schema below). |
| `GET` | `/search/saved/:id` | Get one. Returns `{items: [<one>], count: 1}` — still wrapped. |
| `PATCH` | `/search/saved/:id` | Update (partial). |
| `DELETE` | `/search/saved/:id` | Delete. |
| `GET` | `/search/saved/:id/results` | Fetch results of past scheduled runs. **Returned 404 in our probe** — see "Open questions". |
| `POST` | `/search/saved/:id/notifications` | Create a notification on a saved search. |
| `PATCH` | `/search/saved/:id/notifications/:notificationId` | Update. |
| `DELETE` | `/search/saved/:id/notifications/:notificationId` | Delete. |

Related endpoints observed in passing:

| Verb | Path | Purpose |
|---|---|---|
| `GET` | `/search/datasets` | List available datasets. |
| `GET` | `/search/dataset-providers` | List dataset provider types (cribl_search, cribl_leader, cribl_edge, s3, minio, …). |
| `GET` | `/search/macros` | KQL macros. |
| `GET` | `/search/dashboard-categories` | Dashboard groupings (saved-search based). |
| `POST` | `/search/jobs` | Run a live search job — already in use by `api/cribl.ts`. |

## Saved search schema

Captured from live examples (`tailscale_offline`, `dummy_alert`,
`Pihole_DNS_Queries`, `OS_Lookup`, `cribl_search_finished_1h`, etc).

```ts
interface SavedSearch {
  id: string;                    // stable identifier; appears in URL paths
  name: string;                  // human-readable
  description?: string;
  query: string;                 // KQL source
  earliest: string | 0;          // e.g. "-1h", "-10m", 0 (epoch start)
  latest: string;                // e.g. "now"
  sampleRate?: number;           // 1 = all events; < 1 = sample
  isPrivate?: boolean;           // visible only to owner
  user?: string;                 // owning user ID (e.g. "google-oauth2|..." or "oidc|...")
  displayUsername?: string;      // cached display name
  lib?: string;                  // library namespace; built-in searches use "cribl"

  schedule?: {
    enabled: boolean;
    cronSchedule?: string;       // e.g. "0 * * * *" (hourly)
    tz?: string;                 // e.g. "UTC"
    keepLastN?: number;          // retain results of last N runs
    emptyNotifications?: object; // empty-result handling
    emptyAdvanced?: object;
    notifications?: {
      disabled?: boolean;
      items?: Array<{
        id: string;              // e.g. "<searchId>_Notification_1"
        disabled?: boolean;
        condition: string;       // e.g. "search"
        targets: string[];       // notification target IDs (e.g. ["typhoon_ntfy"])
        conf: {
          triggerType: string;   // e.g. "resultsCount"
          triggerComparator: string; // e.g. ">"
          triggerCount: number;  // threshold
          message: string;       // template: {{timestamp}}, {{savedQueryId}}, {{searchId}}, {{resultSet}}, {{searchResultsUrl}}, {{notificationId}}, {{tenantId}}
          savedQueryId: string;  // ref back to parent
        };
        targetConfigs?: Array<{
          id: string;
          conf: { includeResults?: boolean; attachmentType?: string };
        }>;
        group: string;           // e.g. "default_search"
      }>;
    };
  };

  // Dashboard-rendering hints (irrelevant for provisioning)
  chartConfig?: object;
  tableConfig?: object;
  timeRange?: object;
}
```

### Example — scheduled alert (live `tailscale_offline`)

```json
{
  "id": "tailscale_offline",
  "name": "tailscale_offline",
  "description": "Monitored machines offline for 1h+",
  "isPrivate": true,
  "query": "cribl dataset=\"tailscale\" | lookup monitored_hosts on hostname | where connectedToControl==false and monitored==\"true\" | extend lastSeenParsed=... | where lastSeenParsed < ago(1h) | project hostname",
  "earliest": 0,
  "latest": "now",
  "sampleRate": 1,
  "schedule": {
    "enabled": true,
    "cronSchedule": "0 * * * *",
    "tz": "UTC",
    "keepLastN": 2,
    "notifications": {
      "disabled": false,
      "items": [{
        "id": "tailscale_offline_Notification_1",
        "condition": "search",
        "targets": ["typhoon_ntfy"],
        "conf": {
          "triggerType": "resultsCount",
          "triggerComparator": ">",
          "triggerCount": 0,
          "savedQueryId": "tailscale_offline",
          "message": "Date: {{timestamp}}\n\nA notification was triggered..."
        },
        "targetConfigs": [
          { "id": "typhoon_ntfy", "conf": { "includeResults": true, "attachmentType": "inline" } }
        ],
        "group": "default_search"
      }]
    }
  }
}
```

## Auth model (from inside our pack)

- The Cribl UI loads an Auth0 SPA bundle that stores a JWT access
  token in `localStorage` under `@@auth0spajs@@::...::...`.
- Each API call is made with `Authorization: Bearer <jwt>`.
- **For our pack**, the iframe fetch proxy described in
  `oteldemo/AGENTS.md` injects this header automatically. We already
  rely on this for `/search/jobs` — same mechanism applies to
  `/search/saved`.
- Research limitation: `fetch()` from `page.evaluate()` in a driven
  browser does NOT inherit the header (the token is in JS memory,
  not cookies). To probe endpoints directly from a script, read
  the token out of `localStorage` first:
  ```js
  const token = JSON.parse(
    Object.entries(localStorage).find(([k]) => k.startsWith('@@auth0spajs@@'))[1]
  ).body.access_token;
  ```

## SDK situation

`npm search @criblio` turns up two official TypeScript SDKs:

- **`cribl-control-plane`** — Stream resources (sources, destinations,
  routes, pipelines, workers). Uses the Cribl OpenAPI spec via
  Speakeasy codegen. `SavedJob`-related operations exist in the
  model directory but are wired into the `Collectors` SDK class
  (Stream's scheduled data-collection jobs). **Does not cover
  Cribl Search saved searches.**
- **`cribl-mgmt-plane`** — Workspaces, API credentials, health. Tiny.
  **Does not cover Cribl Search saved searches.**

There is **no official TS SDK for Cribl Search**. We hit `/search/*`
REST directly. If one lands later, we'd want to swap it in.

## The `$vt_*` datasets

`$vt_` is a virtual-table namespace — referenced in the live
`dummy_alert` saved search as `cribl dataset="$vt_dummy"`. The
`/search/datasets` endpoint does **not** list any `$vt_*` datasets,
so they're ephemeral / virtual — created by the search engine on
demand, not provisioned via API.

**Open question**: what writes into a `$vt_*` dataset and how does
our app read it back? The scheduled-search path MIGHT be:

1. A scheduled search runs, produces results.
2. Results are materialized to `$vt_<savedQueryId>` (or similar).
3. Other queries can `cribl dataset="$vt_<savedQueryId>"` to join
   against them.

This is a hypothesis — needs confirmation by either:
- Enabling a schedule on a test saved search, waiting for a run,
  and grepping `$vt_` references across subsequent queries.
- Finding the `$vt_` documentation in Cribl docs (not yet located).

If this model holds, it's **exactly what §2b needs**: a baseline
saved search runs on a cron, writes per-op p95 to `$vt_baselines`,
and our anomaly query joins against it at render time.

Alternative persistence candidates if `$vt_` is a dead end:
- **Cribl lookups** — named tabular references joinable via `lookup`.
  The `tailscale_offline` search uses `lookup monitored_hosts on
  hostname`, so lookups definitely exist. Whether they're writable
  from a scheduled search's output stage is unknown.
- **Pack-scoped KV store** — cheap, already in use, but the write
  would have to come from an app-side HTTP call against the saved
  search's `/results` endpoint after each scheduled run. Polling
  model, not push.

## Open questions for the next session

1. **`/search/saved/:id/results` returned 404** for `tailscale_offline`.
   The JS bundle clearly constructs this path in `getResults(id)`,
   so it must exist under the right conditions. Possibilities:
   - Only exists for searches that have persisted results and the
     current deployment hasn't retained any (`keepLastN` might only
     keep them if they produce non-empty output).
   - Requires a different path prefix — we only tested
     `/api/v1/m/default_search/search/saved/...` and
     `/api/v1/search/saved/...`. There might be a product-scoped
     prefix like `/api/v1/products/search/saved/.../results`.
   - The bundle path is relative to a different root that the
     REST client prepends at runtime.
2. **POST body schema for create.** We haven't captured a live
   POST yet. Almost certainly just a saved-search object matching
   the schema above, but we should verify via the Save-As flow in
   the UI.
3. **`$vt_*` mechanism**: whether scheduled searches auto-persist
   to them, and how to reference them from a subsequent query.
4. **Install-time hook on the App Platform**: AGENTS.md doesn't
   mention one. Likely answer: no such hook exists yet → we'll
   need a first-run user-approved provisioning dialog (ROADMAP §2e).
5. **Idempotent naming**: convention for app-managed IDs. Proposal:
   prefix with `traceexplorer__` so `/search/saved/` calls can find
   our rows and delete-stomping user-edited rows is impossible.
6. **Notification targets**: where do target IDs like `typhoon_ntfy`
   live? `/notifications/targets` returned 0 items when we called it,
   but the saved search references one. Likely a different path
   (maybe `/search/notification-targets` or `/notifications/channels`).

## Next concrete steps for §2b

Assuming the `$vt_` or lookup path pans out:

1. Capture a live POST body by driving the Save-As flow in the UI
   (the automation got close but the Save button label / location
   differs per page; needs manual or DOM-targeted click).
2. Prototype a scheduled saved search via direct REST POST from
   the `scripts/` directory using `node --input-type=module` + the
   token pulled from `localStorage`. Don't commit the script with a
   token; pass via env var.
3. Wait for it to run once and inspect:
   - `/search/saved/:id/results` — does it populate?
   - Does `$vt_<id>` become queryable?
   - Does a lookup file appear?
4. Write the query that the anomaly detector would use to join
   live spans against the persisted baseline. Pattern probably:
   ```
   dataset="otel" ... | lookup baseline on svc, op
     | where curr_p95 >= baseline_p95 * 5
   ```

Once the baseline path is validated, the existing parked
`OperationAnomalyList` widget gets re-wired — the only change is
the `listOperationAnomalies` verb reading from the persisted
baseline instead of an ad-hoc 24h query.
