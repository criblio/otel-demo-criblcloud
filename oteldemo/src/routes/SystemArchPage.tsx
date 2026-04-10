import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
// navigate() goes to /service/:name on click (dedicated Service detail route)
import DependencyGraph from '../components/DependencyGraph';
import StatusBanner from '../components/StatusBanner';
import { getDependencies } from '../api/search';
import type { DependencyEdge } from '../api/types';
import s from './SystemArchPage.module.css';

const LOOKBACKS = [
  { label: 'Last 15 minutes', value: '-15m' },
  { label: 'Last 1 hour', value: '-1h' },
  { label: 'Last 6 hours', value: '-6h' },
  { label: 'Last 24 hours', value: '-24h' },
];

export default function SystemArchPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const containerRef = useRef<HTMLDivElement>(null);

  const lookback = searchParams.get('lookback') ?? '-1h';
  const [edges, setEdges] = useState<DependencyEdge[]>([]);
  const [loading, setLoading] = useState(false);
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

  // Fetch dependencies whenever lookback changes
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    getDependencies(lookback, 'now')
      .then((e) => {
        if (!cancelled) setEdges(e);
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
  }, [lookback]);

  function setLookback(value: string) {
    const next = new URLSearchParams(searchParams);
    next.set('lookback', value);
    setSearchParams(next, { replace: false });
  }

  const services = new Set<string>();
  for (const e of edges) {
    services.add(e.parent);
    services.add(e.child);
  }

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
        <div className={s.spacer} />
        <div className={s.stats}>
          <span>
            Services <span className={s.statValue}>{services.size}</span>
          </span>
          <span>
            Edges <span className={s.statValue}>{edges.filter((e) => e.parent !== e.child).length}</span>
          </span>
        </div>
      </div>

      {error && <StatusBanner kind="error">{error}</StatusBanner>}

      <div className={s.canvasWrap} ref={containerRef}>
        {loading && <div className={s.empty}>Loading dependency graph…</div>}
        {!loading && edges.length === 0 && !error && (
          <div className={s.empty}>No service dependencies in this time range.</div>
        )}
        {!loading && edges.length > 0 && (
          <DependencyGraph
            edges={edges}
            width={dims.w}
            height={dims.h}
            onNodeClick={(id) => navigate(`/service/${encodeURIComponent(id)}`)}
          />
        )}
      </div>
    </div>
  );
}
