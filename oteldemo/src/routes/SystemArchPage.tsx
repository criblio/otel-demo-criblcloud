import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import DependencyGraph from '../components/DependencyGraph';
import StatusBanner from '../components/StatusBanner';
import {
  getDependencies,
  listServiceSummaries,
  getServiceTimeSeries,
} from '../api/search';
import { binSecondsFor } from '../components/timeRanges';
import { HEALTH_LEGEND } from '../utils/health';
import type {
  DependencyEdge,
  ServiceSummary,
  ServiceBucket,
} from '../api/types';
import s from './SystemArchPage.module.css';

const LOOKBACKS = [
  { label: 'Last 15 minutes', value: '-15m' },
  { label: 'Last 1 hour', value: '-1h' },
  { label: 'Last 6 hours', value: '-6h' },
  { label: 'Last 24 hours', value: '-24h' },
];

export default function SystemArchPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const containerRef = useRef<HTMLDivElement>(null);

  const lookback = searchParams.get('lookback') ?? '-1h';
  const [edges, setEdges] = useState<DependencyEdge[]>([]);
  const [summaries, setSummaries] = useState<ServiceSummary[]>([]);
  const [buckets, setBuckets] = useState<ServiceBucket[]>([]);
  const [loadingDeps, setLoadingDeps] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dims, setDims] = useState({ w: 800, h: 600 });

  // Track container size for the SVG
  useEffect(() => {
    if (!containerRef.current) return;
    const ro = new ResizeObserver(() => {
      const r = containerRef.current?.getBoundingClientRect();
      if (r && r.width > 0 && r.height > 0) setDims({ w: r.width, h: r.height });
    });
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  // Fetch dependencies + service stats + time-series in parallel
  useEffect(() => {
    let cancelled = false;
    const binSeconds = binSecondsFor(lookback);
    setLoadingDeps(true);
    setError(null);

    const pDeps = getDependencies(lookback, 'now')
      .then((e) => {
        if (!cancelled) setEdges(e);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
          setEdges([]);
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingDeps(false);
      });

    listServiceSummaries(lookback, 'now')
      .then((r) => {
        if (!cancelled) setSummaries(r);
      })
      .catch(() => {
        if (!cancelled) setSummaries([]);
      });

    getServiceTimeSeries(binSeconds, undefined, lookback, 'now')
      .then((r) => {
        if (!cancelled) setBuckets(r);
      })
      .catch(() => {
        if (!cancelled) setBuckets([]);
      });

    void pDeps;
    return () => {
      cancelled = true;
    };
  }, [lookback]);

  function setLookback(value: string) {
    const next = new URLSearchParams(searchParams);
    next.set('lookback', value);
    setSearchParams(next, { replace: false });
  }

  // Build fast lookups used by the graph
  const servicesMap = useMemo(() => {
    const m = new Map<string, ServiceSummary>();
    for (const sv of summaries) m.set(sv.service, sv);
    return m;
  }, [summaries]);

  const bucketsByService = useMemo(() => {
    const m = new Map<string, ServiceBucket[]>();
    for (const b of buckets) {
      if (!m.has(b.service)) m.set(b.service, []);
      m.get(b.service)!.push(b);
    }
    for (const arr of m.values()) arr.sort((a, b) => a.bucketMs - b.bucketMs);
    return m;
  }, [buckets]);

  // Summary count prefers the services we have stats for, falling back to edges
  const serviceNames = new Set<string>();
  for (const sv of summaries) serviceNames.add(sv.service);
  for (const e of edges) {
    serviceNames.add(e.parent);
    serviceNames.add(e.child);
  }

  // Count unhealthy services for the toolbar summary
  const unhealthyCount = summaries.filter((sv) => sv.errorRate > 0).length;

  return (
    <div className={s.page}>
      <div className={s.toolbar}>
        <span className={s.label}>Lookback</span>
        <select className={s.select} value={lookback} onChange={(e) => setLookback(e.target.value)}>
          {LOOKBACKS.map((l) => (
            <option key={l.value} value={l.value}>
              {l.label}
            </option>
          ))}
        </select>
        <div className={s.legend}>
          {HEALTH_LEGEND.map((h) => (
            <span key={h.bucket} className={s.legendItem} title={h.label}>
              <span className={s.legendDot} style={{ background: h.color }} />
              {h.bucket}
            </span>
          ))}
        </div>
        <div className={s.spacer} />
        <div className={s.stats}>
          <span>
            Services <span className={s.statValue}>{serviceNames.size}</span>
          </span>
          <span>
            Edges{' '}
            <span className={s.statValue}>
              {edges.filter((e) => e.parent !== e.child).length}
            </span>
          </span>
          {unhealthyCount > 0 && (
            <span className={s.unhealthy}>
              {unhealthyCount} with errors
            </span>
          )}
        </div>
      </div>

      {error && <StatusBanner kind="error">{error}</StatusBanner>}

      <div className={s.canvasWrap} ref={containerRef}>
        {loadingDeps && <div className={s.empty}>Loading dependency graph…</div>}
        {!loadingDeps && edges.length === 0 && !error && (
          <div className={s.empty}>No service dependencies in this time range.</div>
        )}
        {!loadingDeps && edges.length > 0 && (
          <DependencyGraph
            edges={edges}
            services={servicesMap}
            bucketsByService={bucketsByService}
            width={dims.w}
            height={dims.h}
          />
        )}
      </div>
    </div>
  );
}
