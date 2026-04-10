/**
 * High-level search operations: combine queries.ts + cribl.ts + transform.ts
 * into the verbs the UI calls.
 */
import { runQuery } from './cribl';
import * as Q from './queries';
import { toJaegerTraces, summarizeTrace, toDependencyEdges } from './transform';
import type { TraceSummary, JaegerTrace, DependencyEdge } from './types';

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
