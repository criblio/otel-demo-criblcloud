import { useEffect, useMemo, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import SpanTree from '../components/SpanTree';
import SpanDetail from '../components/SpanDetail';
import TraceLogsView from '../components/TraceLogsView';
import { getTrace, getTraceLogs } from '../api/search';
import { summarizeTrace } from '../api/transform';
import { formatDurationUs } from '../utils/spans';
import type { JaegerTrace, TraceLogEntry } from '../api/types';
import s from './TraceView.module.css';

type Tab = 'timeline' | 'logs';

export default function TraceView() {
  const { traceId } = useParams();
  const [searchParams] = useSearchParams();
  const lookback = searchParams.get('lookback') ?? '-1h';

  const [trace, setTrace] = useState<JaegerTrace | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedSpanId, setSelectedSpanId] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('timeline');
  const [logs, setLogs] = useState<TraceLogEntry[]>([]);
  const [loadingLogs, setLoadingLogs] = useState(false);

  useEffect(() => {
    if (!traceId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setTrace(null);
    setSelectedSpanId(null);
    setLogs([]);
    getTrace(traceId, lookback, 'now')
      .then((t) => {
        if (cancelled) return;
        setTrace(t);
        if (t && t.spans.length > 0) {
          // Default-select the root span
          const root = t.spans.find((sp) => sp.references.length === 0) ?? t.spans[0];
          setSelectedSpanId(root.spanID);
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [traceId, lookback]);

  // Fetch logs in parallel. We use a wide 24h lookback because otel logs
  // can drift slightly from the span timestamps and this query is
  // trace_id-filtered anyway, so the range doesn't materially affect cost.
  useEffect(() => {
    if (!traceId) return;
    let cancelled = false;
    setLoadingLogs(true);
    getTraceLogs(traceId, '-24h', 'now')
      .then((rows) => {
        if (!cancelled) setLogs(rows);
      })
      .catch(() => {
        if (!cancelled) setLogs([]);
      })
      .finally(() => {
        if (!cancelled) setLoadingLogs(false);
      });
    return () => {
      cancelled = true;
    };
  }, [traceId]);

  const summary = useMemo(() => (trace ? summarizeTrace(trace) : null), [trace]);
  const selectedSpan = useMemo(
    () => trace?.spans.find((sp) => sp.spanID === selectedSpanId) ?? null,
    [trace, selectedSpanId],
  );
  // Logs scoped to the selected span, used in the per-span accordion inside
  // SpanDetail. Also fed into the main Logs tab as a quick-filter hint.
  const logsForSelectedSpan = useMemo(
    () => (selectedSpanId ? logs.filter((l) => l.spanID === selectedSpanId) : []),
    [logs, selectedSpanId],
  );

  if (loading) return <div className={s.loading}>Loading trace…</div>;
  if (error) return <div className={s.errorBox}>{error}</div>;
  if (!trace || !summary) return <div className={s.errorBox}>Trace not found.</div>;

  const traceStartMs = summary.startTime / 1000;

  return (
    <div className={s.page}>
      <div className={s.header}>
        <div className={s.headerLeft}>
          <div className={s.title}>
            <span className={s.svcChip}>{summary.rootService}</span>
            {summary.rootOperation}
          </div>
          <div className={s.subtitle}>
            {summary.spanCount} spans across {summary.services.length} service
            {summary.services.length !== 1 ? 's' : ''}
            {summary.errorCount > 0 && ` · ${summary.errorCount} errors`}
            {' · '}
            {loadingLogs ? 'loading logs…' : `${logs.length} log entries`}
          </div>
          <div className={s.traceIdMono}>{trace.traceID}</div>
        </div>
        <div className={s.stats}>
          <div className={s.stat}>
            <span className={s.statLabel}>Duration</span>
            <span className={s.statValue}>{formatDurationUs(summary.duration)}</span>
          </div>
          <div className={s.stat}>
            <span className={s.statLabel}>Spans</span>
            <span className={s.statValue}>{summary.spanCount}</span>
          </div>
          <div className={s.stat}>
            <span className={s.statLabel}>Services</span>
            <span className={s.statValue}>{summary.services.length}</span>
          </div>
        </div>
      </div>

      <div className={s.tabBar}>
        <button
          type="button"
          className={`${s.tab} ${tab === 'timeline' ? s.tabActive : ''}`}
          onClick={() => setTab('timeline')}
        >
          Timeline
        </button>
        <button
          type="button"
          className={`${s.tab} ${tab === 'logs' ? s.tabActive : ''}`}
          onClick={() => setTab('logs')}
        >
          Logs{' '}
          <span className={s.tabCount}>
            {loadingLogs ? '…' : logs.length}
          </span>
        </button>
      </div>

      {tab === 'timeline' ? (
        <div className={s.split}>
          <SpanTree
            trace={trace}
            selectedSpanId={selectedSpanId}
            onSelect={setSelectedSpanId}
          />
          <SpanDetail
            trace={trace}
            span={selectedSpan}
            spanLogs={logsForSelectedSpan}
            loadingLogs={loadingLogs}
            traceStartMs={traceStartMs}
          />
        </div>
      ) : (
        <TraceLogsView
          logs={logs}
          loading={loadingLogs}
          subtitle="All logs emitted during this trace, in timeline order"
          referenceTimeMs={traceStartMs}
        />
      )}
    </div>
  );
}
