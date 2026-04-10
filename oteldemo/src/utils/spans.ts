/**
 * Utilities for working with Jaeger-shaped traces:
 *  - building a parent/child tree from references
 *  - DFS flattening to a linear ordered list with depth
 *  - deterministic per-service colour assignment
 */
import type { JaegerSpan, JaegerTrace } from '../api/types';

export interface SpanNode {
  span: JaegerSpan;
  depth: number;
  hasChildren: boolean;
  childIds: string[];
}

export interface TraceTimeline {
  traceStart: number; // μs
  traceEnd: number; // μs
  traceDuration: number; // μs (always > 0)
  rootSpanId: string | null;
  nodes: SpanNode[]; // DFS-ordered
}

/**
 * Walk a trace's spans, build a parent→children map, then DFS in start-time
 * order so the timeline reads top-down.
 */
export function buildTimeline(trace: JaegerTrace): TraceTimeline {
  const spans = trace.spans;
  if (spans.length === 0) {
    return { traceStart: 0, traceEnd: 0, traceDuration: 1, rootSpanId: null, nodes: [] };
  }

  const byId = new Map<string, JaegerSpan>();
  const childrenOf = new Map<string, string[]>();
  for (const sp of spans) {
    byId.set(sp.spanID, sp);
  }
  const roots: string[] = [];
  for (const sp of spans) {
    const parentRef = sp.references.find((r) => r.refType === 'CHILD_OF');
    if (parentRef && byId.has(parentRef.spanID)) {
      const list = childrenOf.get(parentRef.spanID) ?? [];
      list.push(sp.spanID);
      childrenOf.set(parentRef.spanID, list);
    } else {
      roots.push(sp.spanID);
    }
  }

  // Sort children by startTime
  for (const list of childrenOf.values()) {
    list.sort((a, b) => byId.get(a)!.startTime - byId.get(b)!.startTime);
  }
  roots.sort((a, b) => byId.get(a)!.startTime - byId.get(b)!.startTime);

  const nodes: SpanNode[] = [];
  function visit(id: string, depth: number) {
    const span = byId.get(id);
    if (!span) return;
    const children = childrenOf.get(id) ?? [];
    nodes.push({ span, depth, hasChildren: children.length > 0, childIds: children });
    for (const cid of children) visit(cid, depth + 1);
  }
  for (const r of roots) visit(r, 0);

  // Time window — defensive: if a span is missing parents we still want a sane window
  let traceStart = Infinity;
  let traceEnd = -Infinity;
  for (const sp of spans) {
    if (sp.startTime < traceStart) traceStart = sp.startTime;
    const e = sp.startTime + sp.duration;
    if (e > traceEnd) traceEnd = e;
  }
  const traceDuration = Math.max(1, traceEnd - traceStart);

  return {
    traceStart,
    traceEnd,
    traceDuration,
    rootSpanId: roots[0] ?? null,
    nodes,
  };
}

/** Stable hash → hue mapping for service colors. */
export function serviceColor(service: string): string {
  let hash = 0;
  for (let i = 0; i < service.length; i++) {
    hash = (hash * 31 + service.charCodeAt(i)) | 0;
  }
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 60%, 50%)`;
}

/** Format a μs duration as a short human string. */
export function formatDurationUs(us: number): string {
  if (us < 1000) return `${us.toFixed(0)} μs`;
  if (us < 1_000_000) return `${(us / 1000).toFixed(2)} ms`;
  return `${(us / 1_000_000).toFixed(2)} s`;
}
