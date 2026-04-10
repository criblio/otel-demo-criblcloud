/**
 * High-level search operations: combine queries.ts + cribl.ts + transform.ts
 * into the verbs the UI calls.
 */
import { runQuery } from './cribl';
import * as Q from './queries';
import { toJaegerTraces, summarizeTrace, toDependencyEdges } from './transform';
import type {
  TraceSummary,
  JaegerTrace,
  DependencyEdge,
  ServiceSummary,
  ServiceBucket,
  OperationSummary,
  TraceBrief,
  TraceLogEntry,
} from './types';

export async function listServices(earliest = '-1h'): Promise<string[]> {
  const rows = await runQuery(Q.services(), earliest, 'now', 500);
  return rows.map((r) => String(r.svc)).filter(Boolean);
}

export async function listOperations(service: string, earliest = '-1h'): Promise<string[]> {
  if (!service) return [];
  const rows = await runQuery(Q.operations(service), earliest, 'now', 1000);
  return rows.map((r) => String(r.name)).filter(Boolean);
}

/**
 * 2-stage search:
 *   1. Find root spans matching filters → list of trace IDs.
 *   2. Fetch all spans for those trace IDs → transform to Jaeger shape.
 *
 * Returns both summaries (for the table) and full traces (cached for click-through).
 */
export interface SearchResult {
  summaries: TraceSummary[];
  traces: Map<string, JaegerTrace>;
}

export async function findTraces(
  params: Q.FindTracesParams,
  earliest = '-1h',
  latest = 'now',
): Promise<SearchResult> {
  const rootRows = await runQuery(Q.findTraces(params), earliest, latest, params.limit ?? 20);
  const traceIds = rootRows.map((r) => String(r.trace_id)).filter(Boolean);
  if (traceIds.length === 0) {
    return { summaries: [], traces: new Map() };
  }

  // Fetch all spans for the matching trace IDs in one query.
  const spanRows = await runQuery(Q.traceSpans(traceIds), earliest, latest, 10000);
  const traces = toJaegerTraces(spanRows);
  const traceMap = new Map<string, JaegerTrace>();
  for (const t of traces) traceMap.set(t.traceID, t);

  // Preserve the root-span order (by recency)
  const summaries: TraceSummary[] = [];
  for (const id of traceIds) {
    const tr = traceMap.get(id);
    if (tr) summaries.push(summarizeTrace(tr));
  }

  return { summaries, traces: traceMap };
}

/** Fetch a single trace's full span list. */
export async function getTrace(
  traceId: string,
  earliest = '-1h',
  latest = 'now',
): Promise<JaegerTrace | null> {
  const rows = await runQuery(Q.traceSpans([traceId]), earliest, latest, 10000);
  const traces = toJaegerTraces(rows);
  return traces[0] ?? null;
}

export async function getDependencies(
  earliest = '-1h',
  latest = 'now',
): Promise<DependencyEdge[]> {
  const rows = await runQuery(Q.dependencies(), earliest, latest, 1000);
  return toDependencyEdges(rows);
}

function toNum(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Cribl Search returns nested objects either as parsed objects or as
 * JSON-encoded strings depending on how the projection was written.
 * Object.entries() on a string iterates characters, which blows up
 * anything that renders attributes as key/value rows. Normalize to a
 * plain object or empty.
 */
function toObject(v: unknown): Record<string, unknown> {
  if (!v) return {};
  if (typeof v === 'string') {
    try {
      const parsed = JSON.parse(v);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      /* not JSON */
    }
    return {};
  }
  if (typeof v === 'object' && !Array.isArray(v)) {
    return v as Record<string, unknown>;
  }
  return {};
}

/** Fetch the per-service rollup. */
export async function listServiceSummaries(
  earliest = '-1h',
  latest = 'now',
): Promise<ServiceSummary[]> {
  const rows = await runQuery(Q.serviceSummary(), earliest, latest, 500);
  return rows.map((r) => {
    const requests = toNum(r.requests);
    const errors = toNum(r.errors);
    return {
      service: String(r.svc ?? 'unknown'),
      requests,
      errors,
      errorRate: toNum(r.error_rate),
      p50Us: toNum(r.p50_us),
      p95Us: toNum(r.p95_us),
      p99Us: toNum(r.p99_us),
    };
  });
}

/** Fetch time-bucketed per-service aggregates. */
export async function getServiceTimeSeries(
  binSeconds: number,
  service?: string,
  earliest = '-1h',
  latest = 'now',
): Promise<ServiceBucket[]> {
  const rows = await runQuery(Q.serviceTimeSeries(binSeconds, service), earliest, latest, 10000);
  return rows.map((r) => ({
    service: String(r.svc ?? 'unknown'),
    // bin(_time, Ns) returns a "bucket" column; the Cribl engine sometimes
    // returns epoch seconds as a number, sometimes as a string. Handle both.
    bucketMs: toNum(r.bucket) * 1000,
    requests: toNum(r.requests),
    errors: toNum(r.errors),
    p50Us: toNum(r.p50_us),
    p95Us: toNum(r.p95_us),
    p99Us: toNum(r.p99_us),
  }));
}

/** Fetch operations for a service, sorted by volume. */
export async function listOperationSummaries(
  service: string,
  earliest = '-1h',
  latest = 'now',
): Promise<OperationSummary[]> {
  const rows = await runQuery(Q.serviceOperations(service), earliest, latest, 100);
  return rows.map((r) => ({
    operation: String(r.name ?? 'unknown'),
    requests: toNum(r.requests),
    errors: toNum(r.errors),
    errorRate: toNum(r.error_rate),
    p50Us: toNum(r.p50_us),
    p95Us: toNum(r.p95_us),
    p99Us: toNum(r.p99_us),
  }));
}

/** Brief listings for Home page panels. */
export async function listSlowestTraces(
  service: string | undefined,
  earliest = '-1h',
  latest = 'now',
): Promise<TraceBrief[]> {
  const rows = await runQuery(Q.slowestTraces(service), earliest, latest, 30);
  return rows
    .map((r) => ({
      traceID: String(r.trace_id ?? ''),
      durationUs: toNum(r.trace_dur_us),
      startTime: toNum(r.trace_start_ns) / 1000,
    }))
    .filter((t) => t.traceID);
}

export async function listRecentErrorTraces(
  service: string | undefined,
  earliest = '-1h',
  latest = 'now',
): Promise<TraceBrief[]> {
  const rows = await runQuery(Q.recentErrorTraces(service), earliest, latest, 30);
  return rows
    .map((r) => ({
      traceID: String(r.trace_id ?? ''),
      durationUs: 0,
      startTime: toNum(r.first_seen) * 1_000_000,
      errorCount: toNum(r.error_count),
    }))
    .filter((t) => t.traceID);
}

/** Fetch logs correlated to a given trace. */
export async function getTraceLogs(
  traceId: string,
  earliest = '-24h',
  latest = 'now',
): Promise<TraceLogEntry[]> {
  if (!traceId) return [];
  const rows = await runQuery(Q.traceLogs(traceId), earliest, latest, 5000);
  return rows.map((r) => ({
    time: toNum(r._time) * 1000,
    traceID: String(r.trace_id ?? ''),
    spanID: String(r.span_id ?? ''),
    service: String(r.service_name ?? 'unknown'),
    body: String(r.body ?? ''),
    severityText: String(r.severity_text ?? ''),
    severityNumber: toNum(r.severity_number),
    codeFile: r.code_file ? String(r.code_file) : undefined,
    codeFunction: r.code_function ? String(r.code_function) : undefined,
    codeLine: r.code_line != null ? toNum(r.code_line) : undefined,
    attributes: toObject(r.attributes),
  }));
}
