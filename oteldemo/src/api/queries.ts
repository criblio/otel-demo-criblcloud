/**
 * KQL query builders for the Jaeger-clone views.
 *
 * All queries target the "otel" lakehouse dataset.
 * Spans are identified by isnotnull(end_time_unix_nano).
 */

const SPANS_BASE = `dataset="otel" | where isnotnull(end_time_unix_nano)`;

/** All distinct service names. */
export function services(): string {
  return `${SPANS_BASE}
    | extend svc=tostring(resource.attributes['service.name'])
    | summarize by svc
    | sort by svc asc`;
}

/** Operations for a given service. */
export function operations(service: string): string {
  const s = service.replace(/"/g, '\\"');
  return `${SPANS_BASE}
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

  return `${SPANS_BASE}
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
  return `${SPANS_BASE}
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
 */
export function serviceSummary(): string {
  return `${SPANS_BASE}
    | extend svc=tostring(resource.attributes['service.name']),
            dur_us=(toreal(end_time_unix_nano)-toreal(start_time_unix_nano))/1000.0,
            is_error=(tostring(status.code)=="2")
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
  return `${SPANS_BASE}
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
  return `${SPANS_BASE}
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
  return `${SPANS_BASE}
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
 * Traces that had at least one error span — "recent errors" panel on
 * Home and Service detail. Optionally scoped to a service.
 */
export function recentErrorTraces(service?: string): string {
  const svcFilter = service ? `| where svc=="${service.replace(/"/g, '\\"')}"` : '';
  return `${SPANS_BASE}
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

/**
 * Structured logs emitted inside a trace. Logs in the otel dataset are
 * distinguished from spans by having a body+severity and lacking
 * end_time_unix_nano.
 */
export function traceLogs(traceId: string): string {
  const t = traceId.replace(/"/g, '\\"');
  return `dataset="otel"
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
 * Service dependency edges via self-join on (trace_id, span_id↔parent_span_id).
 */
export function dependencies(): string {
  return `${SPANS_BASE}
    | extend svc=tostring(resource.attributes['service.name']),
            parent=tostring(parent_span_id)
    | where parent != "" and isnotempty(parent)
    | project trace_id, parent, svc
    | join kind=inner (
        ${SPANS_BASE}
        | extend psvc=tostring(resource.attributes['service.name']),
                psid=tostring(span_id)
        | project trace_id, psid, psvc
      ) on trace_id, $left.parent == $right.psid
    | where svc != psvc
    | summarize callCount=count() by parent=psvc, child=svc
    | sort by callCount desc`;
}
