/** Jaeger-compatible data shapes used throughout the app. */

export interface JaegerTag {
  key: string;
  type: string;
  value: string | number | boolean;
}

export interface JaegerReference {
  refType: 'CHILD_OF' | 'FOLLOWS_FROM';
  traceID: string;
  spanID: string;
}

export interface JaegerLogEntry {
  timestamp: number; // microseconds
  fields: JaegerTag[];
}

export interface JaegerSpan {
  traceID: string;
  spanID: string;
  operationName: string;
  references: JaegerReference[];
  startTime: number; // microseconds since epoch
  duration: number; // microseconds
  tags: JaegerTag[];
  logs: JaegerLogEntry[];
  processID: string;
  warnings: string[] | null;
}

export interface JaegerProcess {
  serviceName: string;
  tags: JaegerTag[];
}

export interface JaegerTrace {
  traceID: string;
  spans: JaegerSpan[];
  processes: Record<string, JaegerProcess>;
  warnings: string[] | null;
}

/** Summary for the search results table (one row per trace). */
export interface TraceSummary {
  traceID: string;
  rootService: string;
  rootOperation: string;
  startTime: number; // μs
  duration: number; // μs
  spanCount: number;
  errorCount: number;
  services: string[];
}

/**
 * Dependency edge for the System Architecture graph.
 *
 * Two kinds exist:
 *  - `rpc` (default): edges derived from parent→child span relationships,
 *    i.e. gRPC / HTTP call chains where the callee span is a child of
 *    the caller's span.
 *  - `messaging`: edges derived from producer/consumer pairs via the
 *    OTel `messaging.*` attributes. The producer and consumer typically
 *    live in different traces so they wouldn't otherwise appear on the
 *    graph; the messaging lens queries them separately and reconstructs
 *    the edge.
 *
 * Metrics are attributed differently per kind:
 *  - `rpc`: p95 is the child span's latency (how long the callee took
 *    to respond).
 *  - `messaging`: p95 is the **consumer's** span duration (how long
 *    the receiver took to process), which is where kafka lag shows up.
 */
export interface DependencyEdge {
  parent: string;
  child: string;
  callCount: number;
  errorCount: number;
  /** p95 latency of the relevant span on this edge, microseconds. */
  p95DurUs: number;
  /** How this edge was discovered. Defaults to 'rpc' if missing. */
  kind?: 'rpc' | 'messaging';
  /** Topic / queue name for messaging edges only. */
  topic?: string;
}

/** Per-service rollup for the Home page catalog + Service detail header. */
export interface ServiceSummary {
  service: string;
  requests: number;
  errors: number;
  errorRate: number; // 0..1
  p50Us: number;
  p95Us: number;
  p99Us: number;
}

/** One time bucket of per-service aggregates; drives sparklines + RED charts. */
export interface ServiceBucket {
  service: string;
  bucketMs: number; // epoch ms at bucket start
  requests: number;
  errors: number;
  p50Us: number;
  p95Us: number;
  p99Us: number;
}

/** Per-operation rollup inside a service. */
export interface OperationSummary {
  operation: string;
  requests: number;
  errors: number;
  errorRate: number;
  p50Us: number;
  p95Us: number;
  p99Us: number;
}

/** Short summary of a trace for "slow traces" / "error traces" panels. */
export interface TraceBrief {
  traceID: string;
  durationUs: number;
  startTime: number; // μs
  errorCount?: number;
}

/** A class of slow traces: all traces sharing a (service, operation) root. */
export interface SlowTraceClass {
  rootService: string;
  rootOperation: string;
  count: number;
  maxDurationUs: number;
  p95DurationUs: number;
  p50DurationUs: number;
  /** Trace IDs in this class, sorted by duration desc. First is the slowest. */
  sampleTraceIDs: string[];
}

/** A class of errors: (service, operation, first-line-of-message). */
export interface ErrorClass {
  service: string;
  operation: string;
  message: string;
  count: number;
  lastSeenMs: number;
  /** Trace IDs that contained this error, most-recent first. */
  sampleTraceIDs: string[];
}

/** A correlated log entry — trace_id + span_id matching the trace. */
export interface TraceLogEntry {
  time: number; // ms
  traceID: string;
  spanID: string;
  service: string;
  body: string;
  severityText: string;
  severityNumber: number;
  codeFile?: string;
  codeFunction?: string;
  codeLine?: number;
  attributes: Record<string, unknown>;
}

/** OTel span kind numeric values. */
export const SpanKind: Record<number, string> = {
  0: 'UNSPECIFIED',
  1: 'INTERNAL',
  2: 'SERVER',
  3: 'CLIENT',
  4: 'PRODUCER',
  5: 'CONSUMER',
};

/** OTel status code values. */
export const StatusCode: Record<string, string> = {
  '0': 'UNSET',
  '1': 'OK',
  '2': 'ERROR',
};
