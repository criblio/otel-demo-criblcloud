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
