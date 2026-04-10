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

/** Dependency edge for the System Architecture graph. */
export interface DependencyEdge {
  parent: string;
  child: string;
  callCount: number;
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
