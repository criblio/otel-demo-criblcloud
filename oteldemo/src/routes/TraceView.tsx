import { useEffect, useMemo, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import SpanTree from '../components/SpanTree';
import SpanDetail from '../components/SpanDetail';
import { getTrace } from '../api/search';
import { summarizeTrace } from '../api/transform';
import { formatDurationUs } from '../utils/spans';
import type { JaegerTrace } from '../api/types';
import s from './TraceView.module.css';

export default function TraceView() {
  const { traceId } = useParams();
  const [searchParams] = useSearchParams();
  const lookback = searchParams.get('lookback') ?? '-1h';

  const [trace, setTrace] = useState<JaegerTrace | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedSpanId, setSelectedSpanId] = useState<string | null>(null);

  useEffect(() => {
    if (!traceId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setTrace(null);
    setSelectedSpanId(null);
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

  const summary = useMemo(() => (trace ? summarizeTrace(trace) : null), [trace]);
  const selectedSpan = useMemo(
    () => trace?.spans.find((sp) => sp.spanID === selectedSpanId) ?? null,
    [trace, selectedSpanId],
  );

  if (loading) return <div className={s.loading}>Loading trace…</div>;
  if (error) return <div className={s.errorBox}>{error}</div>;
  if (!trace || !summary) return <div className={s.errorBox}>Trace not found.</div>;

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

      <div className={s.split}>
        <SpanTree trace={trace} selectedSpanId={selectedSpanId} onSelect={setSelectedSpanId} />
        <SpanDetail trace={trace} span={selectedSpan} />
      </div>
    </div>
  );
}
