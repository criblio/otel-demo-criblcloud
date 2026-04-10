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
  minDuration?: number; // microseconds
  maxDuration?: number; // microseconds
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
  const filters: string[] = [];

  if (params.service) {
    const s = params.service.replace(/"/g, '\\"');
    filters.push(`svc=="${s}"`);
  }
  if (params.operation) {
    const o = params.operation.replace(/"/g, '\\"');
    filters.push(`name=="${o}"`);
  }
  if (params.minDuration != null) {
    filters.push(`dur_us >= ${params.minDuration}`);
  }
  if (params.maxDuration != null) {
    filters.push(`dur_us <= ${params.maxDuration}`);
  }

  // Tag filters: "error=true http.status_code=500"
  if (params.tags) {
    for (const pair of params.tags.split(/\s+/).filter(Boolean)) {
      const eq = pair.indexOf('=');
      if (eq === -1) continue;
      const k = pair.slice(0, eq).replace(/"/g, '\\"');
      const v = pair.slice(eq + 1).replace(/"/g, '\\"');
      filters.push(`tostring(attributes['${k}'])=="${v}"`);
    }
  }

  const where = filters.length ? `| where ${filters.join(' and ')}` : '';
  const lim = params.limit ?? 20;

  return `${SPANS_BASE}
    | extend svc=tostring(resource.attributes['service.name']),
            dur_us=(toreal(end_time_unix_nano)-toreal(start_time_unix_nano))/1000.0
    ${where}
    | summarize first_seen=min(_time) by trace_id
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
