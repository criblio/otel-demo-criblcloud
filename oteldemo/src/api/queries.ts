/**
 * KQL query builders for the Jaeger-clone views.
 *
 * Every query targets the current dataset (see api/dataset.ts). The dataset
 * is injected via datasetBase() rather than a baked-in constant so the
 * Settings page can switch it at runtime without a reload.
 *
 * Spans are identified by isnotnull(end_time_unix_nano).
 */
import { getCurrentDataset } from './dataset';

function quoteDataset(): string {
  // The dataset name must be a simple identifier to embed safely as
  // dataset="...". We strip any non-safe characters as a cheap guard.
  return getCurrentDataset().replace(/[^a-zA-Z0-9_-]/g, '');
}

function datasetClause(): string {
  return `dataset="${quoteDataset()}"`;
}

function spansBase(): string {
  return `${datasetClause()} | where isnotnull(end_time_unix_nano)`;
}


/** All distinct service names. */
export function services(): string {
  return `${spansBase()}
    | extend svc=tostring(resource.attributes['service.name'])
    | summarize by svc
    | sort by svc asc`;
}

/** Operations for a given service. */
export function operations(service: string): string {
  const s = service.replace(/"/g, '\\"');
  return `${spansBase()}
    | extend svc=tostring(resource.attributes['service.name'])
    | where svc=="${s}"
    | summarize by name
    | sort by name asc`;
}

export interface FindTracesParams {
  service?: string;
  operation?: string;
  tags?: string; // free-form "key=value key2=value2"
  minDurationUs?: number; // microseconds (trace-level)
  maxDurationUs?: number; // microseconds (trace-level)
  limit?: number;
}

/**
 * Find traces where the chosen service / operation participates (any depth,
 * not just the root). Returns one row per matching trace_id with the
 * earliest timestamp seen for that trace, sorted by recency.
 *
 * The caller follows up with traceSpans() for these IDs and computes the
 * actual root span client-side. This matches Jaeger's "find traces" semantics
 * — Jaeger lets you search by participating service even when that service
 * is not the root of the trace.
 */
export function findTraces(params: FindTracesParams): string {
  // Per-span filters — applied BEFORE the summarize. These match "traces
  // where a span with this (service, operation, tag) participated."
  const spanFilters: string[] = [];

  if (params.service) {
    const s = params.service.replace(/"/g, '\\"');
    spanFilters.push(`svc=="${s}"`);
  }
  if (params.operation) {
    const o = params.operation.replace(/"/g, '\\"');
    spanFilters.push(`name=="${o}"`);
  }

  // Tag filters: "error=true http.status_code=500"
  if (params.tags) {
    for (const pair of params.tags.split(/\s+/).filter(Boolean)) {
      const eq = pair.indexOf('=');
      if (eq === -1) continue;
      const k = pair.slice(0, eq).replace(/"/g, '\\"');
      const v = pair.slice(eq + 1).replace(/"/g, '\\"');
      spanFilters.push(`tostring(attributes['${k}'])=="${v}"`);
    }
  }

  // Trace-level filters — applied AFTER the summarize. Duration is the
  // full (max_end − min_start) window of the spans that survived the per-span
  // filter, matching Jaeger's semantics ("traces where X took ≥ N ms").
  const traceFilters: string[] = [];
  if (params.minDurationUs != null) {
    traceFilters.push(`trace_dur_us >= ${params.minDurationUs}`);
  }
  if (params.maxDurationUs != null) {
    traceFilters.push(`trace_dur_us <= ${params.maxDurationUs}`);
  }

  const spanWhere = spanFilters.length ? `| where ${spanFilters.join(' and ')}` : '';
  const traceWhere = traceFilters.length ? `| where ${traceFilters.join(' and ')}` : '';
  const lim = params.limit ?? 20;

  return `${spansBase()}
    | extend svc=tostring(resource.attributes['service.name'])
    ${spanWhere}
    | summarize first_seen=min(_time),
                trace_start_ns=min(start_time_unix_nano),
                trace_end_ns=max(end_time_unix_nano)
      by trace_id
    | extend trace_dur_us=(toreal(trace_end_ns)-toreal(trace_start_ns))/1000.0
    ${traceWhere}
    | sort by first_seen desc
    | limit ${lim}`;
}

/**
 * Get all spans for a set of trace IDs. Used both for search result expansion
 * and the single-trace detail view.
 */
export function traceSpans(traceIds: string[]): string {
  const inList = traceIds.map((id) => `"${id}"`).join(', ');
  return `${spansBase()}
    | where trace_id in (${inList})
    | project _time, trace_id, span_id, parent_span_id, name, kind,
              start_time_unix_nano, end_time_unix_nano,
              attributes, events, links,
              status_code=tostring(status.code), status_message=tostring(status.message),
              service_name=tostring(resource.attributes['service.name']),
              resource_attributes=resource.attributes
    | sort by start_time_unix_nano asc`;
}

/**
 * Per-service summary aggregated over the whole time window: request count,
 * error count, duration percentiles. Powers the Home page service catalog.
 *
 * Optional `service` filter: when set, scope the query to a single
 * service BEFORE the summarize step. ServiceDetailPage uses this
 * (twice — current + previous window) and only cares about one row;
 * without the filter, each call reads and aggregates every span in
 * the dataset, which becomes very slow under load (tens of seconds
 * during kafka/flood scenarios). With the filter, the scan is
 * proportional to just that service's traffic.
 */
export function serviceSummary(service?: string): string {
  const svcFilter = service
    ? `| where svc=="${service.replace(/"/g, '\\"')}"`
    : '';
  return `${spansBase()}
    | extend svc=tostring(resource.attributes['service.name']),
            dur_us=(toreal(end_time_unix_nano)-toreal(start_time_unix_nano))/1000.0,
            is_error=(tostring(status.code)=="2")
    ${svcFilter}
    | summarize requests=count(),
                errors=countif(is_error),
                p50_us=percentile(dur_us, 50),
                p95_us=percentile(dur_us, 95),
                p99_us=percentile(dur_us, 99)
      by svc
    | extend error_rate=toreal(errors)/toreal(requests)
    | sort by requests desc`;
}

/**
 * Time-bucketed request count + p95 per service. Powers service-row
 * sparklines on the Home page and the RED charts on the Service detail page.
 *
 * binSeconds controls the bucket width — 60 for 1m bins, 300 for 5m, etc.
 * Callers typically pick a width that gives ~30–60 buckets across their
 * time range so the sparklines have enough resolution without being noisy.
 */
export function serviceTimeSeries(binSeconds: number, service?: string): string {
  const svcFilter = service ? `| where svc=="${service.replace(/"/g, '\\"')}"` : '';
  return `${spansBase()}
    | extend svc=tostring(resource.attributes['service.name']),
            dur_us=(toreal(end_time_unix_nano)-toreal(start_time_unix_nano))/1000.0,
            is_error=(tostring(status.code)=="2")
    ${svcFilter}
    | summarize requests=count(),
                errors=countif(is_error),
                p50_us=percentile(dur_us, 50),
                p95_us=percentile(dur_us, 95),
                p99_us=percentile(dur_us, 99)
      by svc, bucket=bin(_time, ${binSeconds}s)
    | sort by svc asc, bucket asc`;
}

/**
 * Top operations for a service, sorted by volume. Each row includes counts,
 * error rate, and percentile latencies — the core table on Service detail.
 */
export function serviceOperations(service: string): string {
  const s = service.replace(/"/g, '\\"');
  return `${spansBase()}
    | extend svc=tostring(resource.attributes['service.name']),
            dur_us=(toreal(end_time_unix_nano)-toreal(start_time_unix_nano))/1000.0,
            is_error=(tostring(status.code)=="2")
    | where svc=="${s}"
    | summarize requests=count(),
                errors=countif(is_error),
                p50_us=percentile(dur_us, 50),
                p95_us=percentile(dur_us, 95),
                p99_us=percentile(dur_us, 99)
      by name
    | extend error_rate=toreal(errors)/toreal(requests)
    | sort by requests desc
    | limit 50`;
}

/**
 * Traces sorted by trace duration descending — "slow traces" panel on
 * the Home page. Optionally scoped to a service.
 */
export function slowestTraces(service?: string): string {
  const svcFilter = service ? `| where svc=="${service.replace(/"/g, '\\"')}"` : '';
  return `${spansBase()}
    | extend svc=tostring(resource.attributes['service.name'])
    ${svcFilter}
    | summarize first_seen=min(_time),
                trace_start_ns=min(start_time_unix_nano),
                trace_end_ns=max(end_time_unix_nano)
      by trace_id
    | extend trace_dur_us=(toreal(trace_end_ns)-toreal(trace_start_ns))/1000.0
    | sort by trace_dur_us desc
    | limit 20`;
}

/**
 * Raw slow-trace rows enriched with the root span's (service, operation)
 * for client-side class grouping. Returns up to `limit` of the slowest
 * traces in the window, each tagged with its root svc/op so the UI can
 * collapse repeating classes (e.g. 40 identical 600s streaming traces
 * become 1 row with count=40).
 *
 * root_svc/root_op are picked via minif(col, is_root) — Cribl KQL doesn't
 * have arg_min/arg_max, but minif(col, predicate) picks the min value
 * among rows satisfying the predicate, which for a single-root trace is
 * just "the root span's value."
 *
 * Streaming / long-poll noise filter: persistent connections (gRPC
 * server-streaming, SSE, websockets, HTTP long-poll) produce traces
 * that sit at multi-minute durations but contain **only one or two
 * spans** — the connection-holding RPC and maybe one internal scope
 * span. A legitimate slow trace accumulates spans as it works
 * (client → server → downstream rpc → db → ...), so
 * `span_count >= 3` is a clean separator.
 *
 * We empirically verified this against the OTel demo: every
 * `flagd.evaluation.v1.Service/EventStream` trace in the dataset has
 * span_count ∈ {1, 2}, while real slow traces from `kafkaQueueProblems`
 * (`accounting order-consumed`) all have span_count ≥ 3. The filter
 * is environment-agnostic — it doesn't reference any service or
 * operation name.
 *
 * Threshold: span_count ≤ 2 AND duration > 30s. 30s is generous enough
 * to keep any normal slow-but-real request while still catching every
 * long-poll we've seen.
 */
const STREAM_MIN_SPANS = 3;
const STREAM_DURATION_US = 30_000_000;

export function rawSlowestTraces(limit: number = 500): string {
  return `${spansBase()}
    | extend svc=tostring(resource.attributes['service.name']),
            parent=tostring(parent_span_id),
            is_root=(parent=="" or isempty(parent))
    | summarize span_count=count(),
                trace_start_ns=min(start_time_unix_nano),
                trace_end_ns=max(end_time_unix_nano),
                root_svc=minif(svc, is_root),
                root_op=minif(name, is_root)
      by trace_id
    | extend trace_dur_us=(toreal(trace_end_ns)-toreal(trace_start_ns))/1000.0
    | where isnotnull(root_svc)
    | where not (span_count < ${STREAM_MIN_SPANS} and trace_dur_us > ${STREAM_DURATION_US})
    | sort by trace_dur_us desc
    | limit ${limit}`;
}

/**
 * Raw error span rows enriched with service + operation + status.message
 * for client-side error class grouping. Returns up to `limit` of the most
 * recent error spans.
 */
export function rawRecentErrorSpans(limit: number = 300): string {
  return `${spansBase()}
    | extend svc=tostring(resource.attributes['service.name']),
             is_error=(tostring(status.code)=="2"),
             msg=tostring(status.message)
    | where is_error
    | sort by _time desc
    | project _time, svc, name, trace_id, msg
    | limit ${limit}`;
}

/**
 * Traces that had at least one error span — "recent errors" panel on
 * Home and Service detail. Optionally scoped to a service.
 */
export function recentErrorTraces(service?: string): string {
  const svcFilter = service ? `| where svc=="${service.replace(/"/g, '\\"')}"` : '';
  return `${spansBase()}
    | extend svc=tostring(resource.attributes['service.name']),
            is_error=(tostring(status.code)=="2")
    | where is_error
    ${svcFilter}
    | summarize first_seen=max(_time),
                error_count=count()
      by trace_id
    | sort by first_seen desc
    | limit 20`;
}

/** Parameters for the standalone Log Explorer query. */
export interface SearchLogsParams {
  service?: string;
  /** Minimum severity_number (OTel scale: INFO=9, WARN=13, ERROR=17). */
  minSeverity?: number;
  /** Maximum severity_number — lets you carve out "only WARN, not ERROR". */
  maxSeverity?: number;
  /** Plain-text substring to match in the log body. Case-insensitive. */
  bodyContains?: string;
  limit?: number;
}

/**
 * Standalone log search — no trace ID required. Powers the Log Explorer
 * tab. Distinct from traceLogs() in that the latter is always scoped to
 * a single trace, while this one roams across all logs in the dataset.
 *
 * Sort order is reverse-chronological so "most recent" is always at
 * the top; the UI paginates from there.
 */
export function searchLogs(params: SearchLogsParams): string {
  const filters: string[] = [
    'isnotnull(body)',
    'isnotnull(severity_number)',
  ];

  if (params.service) {
    const s = params.service.replace(/"/g, '\\"');
    filters.push(`tostring(resource.attributes['service.name'])=="${s}"`);
  }
  if (params.minSeverity != null) {
    filters.push(`toreal(severity_number) >= ${params.minSeverity}`);
  }
  if (params.maxSeverity != null) {
    filters.push(`toreal(severity_number) <= ${params.maxSeverity}`);
  }
  if (params.bodyContains) {
    // Cribl's `contains` is case-insensitive by default on strings.
    const needle = params.bodyContains.replace(/"/g, '\\"');
    filters.push(`tostring(body) contains "${needle}"`);
  }

  const lim = params.limit ?? 200;
  return `${datasetClause()}
    | where ${filters.join(' and ')}
    | project _time, trace_id, span_id, body, severity_text, severity_number,
              attributes,
              service_name=tostring(resource.attributes['service.name']),
              pod_name=tostring(resource.attributes['k8s.pod.name']),
              code_file=tostring(attributes['code.file.path']),
              code_function=tostring(attributes['code.function.name']),
              code_line=attributes['code.line.number']
    | sort by _time desc
    | limit ${lim}`;
}

/**
 * All distinct services that have emitted logs. Smaller than the span
 * services list because not every service logs structured events.
 */
export function logServices(): string {
  return `${datasetClause()}
    | where isnotnull(body) and isnotnull(severity_number)
    | extend svc=tostring(resource.attributes['service.name'])
    | summarize by svc
    | sort by svc asc`;
}

/**
 * Structured logs emitted inside a trace. Logs in the otel dataset are
 * distinguished from spans by having a body+severity and lacking
 * end_time_unix_nano.
 */
export function traceLogs(traceId: string): string {
  const t = traceId.replace(/"/g, '\\"');
  return `${datasetClause()}
    | where isnotnull(body) and isnotnull(severity_number)
    | where trace_id=="${t}"
    | project _time, trace_id, span_id, body, severity_text, severity_number,
              attributes,
              service_name=tostring(resource.attributes['service.name']),
              code_file=tostring(attributes['code.file.path']),
              code_function=tostring(attributes['code.function.name']),
              code_line=attributes['code.line.number']
    | sort by _time asc
    | limit 5000`;
}

/**
 * Messaging / async dependency edges.
 *
 * OTel kafka / rabbitmq instrumentation does NOT link producer and
 * consumer spans via parent_span_id — they live in different traces.
 * Instead, each side has `messaging.destination.name` (the topic /
 * queue) and `messaging.operation` (publish/send on producer,
 * receive/process on consumer). We aggregate per
 * (service, topic, operation) and cross-product producers×consumers
 * client-side in transform.ts to synthesize edges.
 *
 * The span duration on the CONSUMER side is what captures lag
 * (kafkaQueueProblems scenario) — that's where p95 goes from ms to
 * tens of seconds — so we carry the consumer p95 through as the edge
 * latency metric.
 */
export function messagingDependencies(): string {
  return `${spansBase()}
    | extend svc=tostring(resource.attributes['service.name']),
            dur_us=(toreal(end_time_unix_nano)-toreal(start_time_unix_nano))/1000.0,
            is_error=(tostring(status.code)=="2"),
            msg_op=tostring(attributes['messaging.operation']),
            msg_dest=tostring(attributes['messaging.destination.name']),
            msg_system=tostring(attributes['messaging.system'])
    | where isnotempty(msg_dest) and isnotempty(msg_op)
    | summarize spans=count(),
                errors=countif(is_error),
                p95_us=percentile(dur_us, 95)
      by svc, msg_dest, msg_op, msg_system
    | sort by spans desc`;
}

/**
 * Service dependency edges via self-join on (trace_id, span_id↔parent_span_id).
 *
 * Each edge carries the caller → callee call count, error count, and p95
 * latency of the CHILD span — the thing the caller was waiting on. Error
 * is attributed to the child because that's where the failure happens
 * even though the edge is lit "from the caller's perspective." This is
 * what makes paymentUnreachable light up the checkout→payment edge
 * instead of just the payment node.
 */
export function dependencies(): string {
  return `${spansBase()}
    | extend svc=tostring(resource.attributes['service.name']),
            parent=tostring(parent_span_id),
            dur_us=(toreal(end_time_unix_nano)-toreal(start_time_unix_nano))/1000.0,
            is_error=(tostring(status.code)=="2")
    | where parent != "" and isnotempty(parent)
    | project trace_id, parent, svc, dur_us, is_error
    | join kind=inner (
        ${spansBase()}
        | extend psvc=tostring(resource.attributes['service.name']),
                psid=tostring(span_id)
        | project trace_id, psid, psvc
      ) on trace_id, $left.parent == $right.psid
    | where svc != psvc
    | summarize callCount=count(),
                errorCount=countif(is_error),
                p95DurUs=percentile(dur_us, 95)
      by parent=psvc, child=svc
    | sort by callCount desc`;
}
