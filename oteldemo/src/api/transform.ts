/**
 * Transform raw otel span rows (from Cribl Search) into Jaeger-compatible
 * trace objects.
 */
import type {
  JaegerTrace,
  JaegerSpan,
  JaegerProcess,
  JaegerTag,
  JaegerLogEntry,
  JaegerReference,
  TraceSummary,
  DependencyEdge,
} from './types';

/** Convert an attributes object { key: value, ... } into JaegerTag[]. */
function toTags(attrs: Record<string, unknown> | null | undefined): JaegerTag[] {
  if (!attrs || typeof attrs !== 'object' || Array.isArray(attrs)) return [];
  return Object.entries(attrs).map(([key, value]) => ({
    key,
    type: typeof value === 'number' ? (Number.isInteger(value) ? 'int64' : 'float64') : 'string',
    value: value as string | number | boolean,
  }));
}

/** Coerce a value to an array — Cribl Search sometimes returns null/{} for empty lists. */
function toArray<T>(v: unknown): T[] {
  if (Array.isArray(v)) return v as T[];
  return [];
}

/** Build a stable processID from service name + instance id. */
function processKey(serviceName: string, instanceId?: string): string {
  return instanceId ? `${serviceName}::${instanceId}` : serviceName;
}

interface OtelSpanRow {
  trace_id: string;
  span_id: string;
  parent_span_id?: string;
  name: string;
  kind?: number;
  start_time_unix_nano: number;
  end_time_unix_nano: number;
  attributes?: Record<string, unknown>;
  events?: Array<{
    time_unix_nano: number;
    name: string;
    attributes?: Record<string, unknown>;
  }>;
  status_code?: string;
  status_message?: string;
  service_name: string;
  resource_attributes?: Record<string, unknown>;
}

/**
 * Group otel span rows by trace_id and produce Jaeger-shaped traces.
 */
export function toJaegerTraces(rows: Record<string, unknown>[]): JaegerTrace[] {
  const byTrace = new Map<string, OtelSpanRow[]>();
  for (const row of rows) {
    const r = row as unknown as OtelSpanRow;
    const tid = r.trace_id;
    if (!tid) continue;
    let arr = byTrace.get(tid);
    if (!arr) {
      arr = [];
      byTrace.set(tid, arr);
    }
    arr.push(r);
  }

  const traces: JaegerTrace[] = [];
  for (const [traceID, spans] of byTrace) {
    const processes: Record<string, JaegerProcess> = {};
    const pidMap = new Map<string, string>(); // processKey → pN
    let pidCounter = 1;

    const jaegerSpans: JaegerSpan[] = spans.map((s) => {
      const svcName = s.service_name || 'unknown';
      const instanceId = s.resource_attributes?.['service.instance.id'] as string | undefined;
      const pk = processKey(svcName, instanceId);

      let pid = pidMap.get(pk);
      if (!pid) {
        pid = `p${pidCounter++}`;
        pidMap.set(pk, pid);
        processes[pid] = {
          serviceName: svcName,
          tags: toTags(s.resource_attributes),
        };
      }

      const startUs = Number(s.start_time_unix_nano) / 1000;
      const endUs = Number(s.end_time_unix_nano) / 1000;

      const refs: JaegerReference[] = [];
      if (s.parent_span_id && s.parent_span_id !== '') {
        refs.push({ refType: 'CHILD_OF', traceID, spanID: s.parent_span_id });
      }

      const tags: JaegerTag[] = toTags(s.attributes);
      if (s.kind != null) {
        tags.push({ key: 'span.kind', type: 'string', value: kindName(s.kind) });
      }
      if (s.status_code === '2') {
        tags.push({ key: 'error', type: 'bool', value: true });
      }

      const logs: JaegerLogEntry[] = toArray<{
        time_unix_nano: number;
        name: string;
        attributes?: Record<string, unknown>;
      }>(s.events).map((e) => ({
        timestamp: Number(e.time_unix_nano) / 1000,
        fields: [
          { key: 'event', type: 'string', value: e.name },
          ...toTags(e.attributes),
        ],
      }));

      return {
        traceID,
        spanID: s.span_id,
        operationName: s.name,
        references: refs,
        startTime: startUs,
        duration: endUs - startUs,
        tags,
        logs,
        processID: pid,
        warnings: null,
      };
    });

    traces.push({ traceID, spans: jaegerSpans, processes, warnings: null });
  }

  return traces;
}

function kindName(kind: number): string {
  const names: Record<number, string> = {
    0: 'unspecified', 1: 'internal', 2: 'server', 3: 'client', 4: 'producer', 5: 'consumer',
  };
  return names[kind] ?? 'unknown';
}

/** Summarize a JaegerTrace into a table row for the search results view. */
export function summarizeTrace(trace: JaegerTrace): TraceSummary {
  const root = trace.spans.find((s) => s.references.length === 0) ?? trace.spans[0];
  const services = new Set<string>();
  let errorCount = 0;
  for (const s of trace.spans) {
    const proc = trace.processes[s.processID];
    if (proc) services.add(proc.serviceName);
    if (s.tags.some((t) => t.key === 'error' && t.value === true)) errorCount++;
  }
  const rootProc = root ? trace.processes[root.processID] : undefined;
  return {
    traceID: trace.traceID,
    rootService: rootProc?.serviceName ?? 'unknown',
    rootOperation: root?.operationName ?? 'unknown',
    startTime: root?.startTime ?? 0,
    duration: root?.duration ?? 0,
    spanCount: trace.spans.length,
    errorCount,
    services: [...services],
  };
}

/** Parse dependency edge rows from the KQL join result. */
export function toDependencyEdges(rows: Record<string, unknown>[]): DependencyEdge[] {
  return rows.map((r) => ({
    parent: String(r.parent ?? r.parent_svc ?? ''),
    child: String(r.child ?? r.child_svc ?? ''),
    callCount: Number(r.callCount ?? 0),
  }));
}
