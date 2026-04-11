/**
 * High-level search operations: combine queries.ts + cribl.ts + transform.ts
 * into the verbs the UI calls.
 */
import { runQuery } from './cribl';
import * as Q from './queries';
import { toJaegerTraces, summarizeTrace, toDependencyEdges, toMessagingEdges } from './transform';
import type {
  TraceSummary,
  JaegerTrace,
  DependencyEdge,
  ServiceSummary,
  ServiceBucket,
  OperationSummary,
  TraceBrief,
  TraceLogEntry,
  SlowTraceClass,
  ErrorClass,
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

/**
 * Fetch the full set of dependency edges for the System Architecture
 * graph. Runs two queries in parallel:
 *   1. RPC edges via parent→child span self-join (dependencies()).
 *   2. Messaging edges via OTel messaging.* attributes
 *      (messagingDependencies()), which catch kafka-style async flows
 *      where producer and consumer live in different traces and so
 *      would otherwise be invisible on the graph.
 *
 * Both sets are merged; messaging edges are tagged with kind='messaging'
 * so the graph can render them differently (dashed stroke in the 2D view).
 * If the messaging query returns nothing (no async services) the result
 * is functionally identical to the old RPC-only edge list.
 */
export async function getDependencies(
  earliest = '-1h',
  latest = 'now',
): Promise<DependencyEdge[]> {
  const [rpcRows, msgRows] = await Promise.all([
    runQuery(Q.dependencies(), earliest, latest, 1000),
    runQuery(Q.messagingDependencies(), earliest, latest, 1000).catch(() => []),
  ]);
  return [...toDependencyEdges(rpcRows), ...toMessagingEdges(msgRows)];
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

/**
 * Fetch the per-service rollup. When `service` is provided, the query
 * is pre-filtered to that service at the KQL level — a big speedup on
 * Service Detail (see serviceSummary() docstring).
 */
export async function listServiceSummaries(
  earliest = '-1h',
  latest = 'now',
  service?: string,
): Promise<ServiceSummary[]> {
  const rows = await runQuery(Q.serviceSummary(service), earliest, latest, 500);
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

/**
 * Fetch the raw slowest-trace rows and group them client-side by
 * (root_service, root_operation). Each class collapses N duplicate-looking
 * traces into one row with count, max, p95, p50, and a sorted list of
 * sample trace IDs.
 */
export async function listSlowTraceClasses(
  earliest = '-1h',
  latest = 'now',
  rawLimit = 500,
  topClasses = 20,
): Promise<SlowTraceClass[]> {
  const rows = await runQuery(Q.rawSlowestTraces(rawLimit), earliest, latest, rawLimit);
  interface Acc {
    rootService: string;
    rootOperation: string;
    durations: number[];
    traceIds: string[]; // sorted by duration as we go
  }
  const groups = new Map<string, Acc>();
  for (const r of rows) {
    const svc = String(r.root_svc ?? '');
    const op = String(r.root_op ?? '');
    const dur = toNum(r.trace_dur_us);
    const id = String(r.trace_id ?? '');
    if (!svc || !id) continue;
    const key = `${svc}\u0000${op}`;
    let g = groups.get(key);
    if (!g) {
      g = { rootService: svc, rootOperation: op, durations: [], traceIds: [] };
      groups.set(key, g);
    }
    g.durations.push(dur);
    g.traceIds.push(id);
  }
  const classes: SlowTraceClass[] = [];
  for (const g of groups.values()) {
    // Pair durations with trace_ids and sort so the first trace_id is the
    // slowest exemplar.
    const paired = g.durations.map((d, i) => ({ d, id: g.traceIds[i] }));
    paired.sort((a, b) => b.d - a.d);
    const durs = paired.map((p) => p.d);
    classes.push({
      rootService: g.rootService,
      rootOperation: g.rootOperation,
      count: durs.length,
      maxDurationUs: durs[0] ?? 0,
      p95DurationUs: percentile(durs, 95),
      p50DurationUs: percentile(durs, 50),
      sampleTraceIDs: paired.map((p) => p.id).slice(0, 5),
    });
  }
  classes.sort((a, b) => b.maxDurationUs - a.maxDurationUs);
  return classes.slice(0, topClasses);
}

/**
 * Fetch raw recent error spans and group them client-side by
 * (service, operation, first-line-of-message). Counts, last seen, and
 * up to 5 sample trace IDs per class.
 */
export async function listErrorClasses(
  earliest = '-1h',
  latest = 'now',
  rawLimit = 300,
  topClasses = 20,
): Promise<ErrorClass[]> {
  const rows = await runQuery(Q.rawRecentErrorSpans(rawLimit), earliest, latest, rawLimit);
  interface Acc {
    service: string;
    operation: string;
    message: string;
    count: number;
    lastSeenMs: number;
    traceIds: string[];
  }
  const groups = new Map<string, Acc>();
  for (const r of rows) {
    const svc = String(r.svc ?? 'unknown');
    const op = String(r.name ?? 'unknown');
    const rawMsg = String(r.msg ?? '').trim();
    // Normalize: take the first line and strip trailing whitespace; if
    // empty, fall back to "(no status message)" so the grouping still
    // has a stable key.
    const firstLine = rawMsg.split('\n')[0].trim();
    const msg = firstLine || '(no status message)';
    const t = toNum(r._time) * 1000;
    const id = String(r.trace_id ?? '');
    if (!id) continue;
    const key = `${svc}\u0000${op}\u0000${msg}`;
    let g = groups.get(key);
    if (!g) {
      g = { service: svc, operation: op, message: msg, count: 0, lastSeenMs: 0, traceIds: [] };
      groups.set(key, g);
    }
    g.count += 1;
    if (t > g.lastSeenMs) g.lastSeenMs = t;
    if (g.traceIds.length < 5) g.traceIds.push(id);
  }
  const classes: ErrorClass[] = Array.from(groups.values()).map((g) => ({
    service: g.service,
    operation: g.operation,
    message: g.message,
    count: g.count,
    lastSeenMs: g.lastSeenMs,
    sampleTraceIDs: g.traceIds,
  }));
  classes.sort((a, b) => b.count - a.count || b.lastSeenMs - a.lastSeenMs);
  return classes.slice(0, topClasses);
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

/**
 * Standalone log search — Log Explorer tab. Filters at the KQL level for
 * service/severity/body text; returns most-recent-first.
 */
export async function searchLogs(
  params: Q.SearchLogsParams,
  earliest = '-1h',
  latest = 'now',
): Promise<TraceLogEntry[]> {
  const rows = await runQuery(Q.searchLogs(params), earliest, latest, params.limit ?? 200);
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

/** List distinct services that have emitted logs. */
export async function listLogServices(earliest = '-1h'): Promise<string[]> {
  const rows = await runQuery(Q.logServices(), earliest, 'now', 500);
  return rows.map((r) => String(r.svc)).filter(Boolean);
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
