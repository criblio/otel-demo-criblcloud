import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import TimeRangePicker from '../components/TimeRangePicker';
import { binSecondsFor } from '../components/timeRanges';
import Sparkline from '../components/Sparkline';
import StatusBanner from '../components/StatusBanner';
import TraceBriefList from '../components/TraceBriefList';
import {
  listServiceSummaries,
  getServiceTimeSeries,
  listSlowestTraces,
  listRecentErrorTraces,
} from '../api/search';
import { serviceColor } from '../utils/spans';
import type {
  ServiceSummary,
  ServiceBucket,
  TraceBrief,
} from '../api/types';
import s from './HomePage.module.css';

type SortKey =
  | 'service'
  | 'requests'
  | 'errorRate'
  | 'p50Us'
  | 'p95Us'
  | 'p99Us';

interface SortState {
  key: SortKey;
  dir: 'asc' | 'desc';
}

const DEFAULT_RANGE = '-1h';
const REFRESH_INTERVAL_MS = 30_000;

function fmtRate(requestsPerMin: number): string {
  if (requestsPerMin >= 1000) return `${(requestsPerMin / 1000).toFixed(1)}k/min`;
  if (requestsPerMin >= 10) return `${requestsPerMin.toFixed(0)}/min`;
  return `${requestsPerMin.toFixed(1)}/min`;
}

function fmtUs(us: number): string {
  if (!Number.isFinite(us) || us === 0) return '—';
  if (us < 1000) return `${us.toFixed(0)} μs`;
  if (us < 1_000_000) return `${(us / 1000).toFixed(1)} ms`;
  return `${(us / 1_000_000).toFixed(2)} s`;
}

function fmtErrorRate(rate: number): { text: string; className: string } {
  if (rate === 0) return { text: '0.00%', className: s.errZero };
  const pct = rate * 100;
  const cls = pct >= 5 ? s.errHigh : pct >= 1 ? s.errHigh : s.errLow;
  return { text: `${pct.toFixed(2)}%`, className: cls };
}

/** Parse relative-time string like "-1h" / "-30m" into ms duration. */
function relativeTimeMs(rel: string): number {
  const m = rel.match(/^-(\d+)([smhd])$/);
  if (!m) return 3600_000;
  const n = Number(m[1]);
  const unit = m[2];
  return n * { s: 1000, m: 60_000, h: 3600_000, d: 86_400_000 }[unit as 's' | 'm' | 'h' | 'd'];
}

export default function HomePage() {
  const [range, setRange] = useState(DEFAULT_RANGE);
  const [summaries, setSummaries] = useState<ServiceSummary[]>([]);
  const [buckets, setBuckets] = useState<ServiceBucket[]>([]);
  const [slowTraces, setSlowTraces] = useState<TraceBrief[]>([]);
  const [errorTraces, setErrorTraces] = useState<TraceBrief[]>([]);
  const [loadingSummaries, setLoadingSummaries] = useState(true);
  const [loadingBuckets, setLoadingBuckets] = useState(true);
  const [loadingSlow, setLoadingSlow] = useState(true);
  const [loadingErrors, setLoadingErrors] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [sort, setSort] = useState<SortState>({ key: 'requests', dir: 'desc' });
  // Lazy initializer keeps Date.now() out of the render body (purity rule).
  const [lastRefresh, setLastRefresh] = useState<number>(() => Date.now());

  const fetchAll = useCallback(async () => {
    setError(null);
    const binSeconds = binSecondsFor(range);
    setLoadingSummaries(true);
    setLoadingBuckets(true);
    setLoadingSlow(true);
    setLoadingErrors(true);

    // Fan out — we want the table to populate as soon as summaries arrive,
    // and the sparklines + bottom panels to fill in independently.
    const pSummaries = listServiceSummaries(range, 'now')
      .then((r) => setSummaries(r))
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : String(e));
        setSummaries([]);
      })
      .finally(() => setLoadingSummaries(false));

    const pBuckets = getServiceTimeSeries(binSeconds, undefined, range, 'now')
      .then((r) => setBuckets(r))
      .catch(() => setBuckets([]))
      .finally(() => setLoadingBuckets(false));

    const pSlow = listSlowestTraces(undefined, range, 'now')
      .then((r) => setSlowTraces(r))
      .catch(() => setSlowTraces([]))
      .finally(() => setLoadingSlow(false));

    const pErrors = listRecentErrorTraces(undefined, range, 'now')
      .then((r) => setErrorTraces(r))
      .catch(() => setErrorTraces([]))
      .finally(() => setLoadingErrors(false));

    await Promise.allSettled([pSummaries, pBuckets, pSlow, pErrors]);
    setLastRefresh(Date.now());
  }, [range]);

  // Initial load + on range change
  useEffect(() => {
    void fetchAll();
  }, [fetchAll]);

  // Auto-refresh
  const timerRef = useRef<number | null>(null);
  useEffect(() => {
    if (!autoRefresh) return;
    timerRef.current = window.setInterval(() => {
      void fetchAll();
    }, REFRESH_INTERVAL_MS);
    return () => {
      if (timerRef.current != null) window.clearInterval(timerRef.current);
      timerRef.current = null;
    };
  }, [autoRefresh, fetchAll]);

  // Group time-series buckets by service for sparklines
  const sparksByService = useMemo(() => {
    const byService = new Map<string, { t: number; v: number }[]>();
    const p95ByService = new Map<string, { t: number; v: number }[]>();
    for (const b of buckets) {
      if (!byService.has(b.service)) byService.set(b.service, []);
      if (!p95ByService.has(b.service)) p95ByService.set(b.service, []);
      byService.get(b.service)!.push({ t: b.bucketMs, v: b.requests });
      p95ByService.get(b.service)!.push({ t: b.bucketMs, v: b.p95Us });
    }
    // sort each series by time
    for (const arr of byService.values()) arr.sort((a, b) => a.t - b.t);
    for (const arr of p95ByService.values()) arr.sort((a, b) => a.t - b.t);
    return { requests: byService, p95: p95ByService };
  }, [buckets]);

  // Sort service table
  const sortedSummaries = useMemo(() => {
    const arr = [...summaries];
    const { key, dir } = sort;
    arr.sort((a, b) => {
      let av: number | string = 0;
      let bv: number | string = 0;
      if (key === 'service') {
        av = a.service;
        bv = b.service;
      } else {
        av = a[key] ?? 0;
        bv = b[key] ?? 0;
      }
      if (av < bv) return dir === 'asc' ? -1 : 1;
      if (av > bv) return dir === 'asc' ? 1 : -1;
      return 0;
    });
    return arr;
  }, [summaries, sort]);

  // Convert total requests over range → requests per minute
  const rangeMinutes = relativeTimeMs(range) / 60_000;
  function reqPerMin(totalRequests: number): number {
    return rangeMinutes > 0 ? totalRequests / rangeMinutes : 0;
  }

  function toggleSort(key: SortKey) {
    setSort((cur) => {
      if (cur.key === key) return { key, dir: cur.dir === 'asc' ? 'desc' : 'asc' };
      // Default direction: text = asc, numeric = desc (show highest first)
      return { key, dir: key === 'service' ? 'asc' : 'desc' };
    });
  }

  function sortIndicator(key: SortKey): string {
    if (sort.key !== key) return '';
    return sort.dir === 'desc' ? '▼' : '▲';
  }

  const lastRefreshText = new Date(lastRefresh).toLocaleTimeString();

  return (
    <div className={s.page}>
      {/* Hero bar with title, range picker, auto-refresh toggle */}
      <div className={s.hero}>
        <div>
          <h1 className={s.heroTitle}>Trace Explorer</h1>
          <div className={s.heroSubtitle}>
            Service catalog, recent activity, and live trace data from the{' '}
            <code>otel</code> dataset.
          </div>
        </div>
        <div className={s.heroControls}>
          <TimeRangePicker value={range} onChange={setRange} />
          <button
            type="button"
            className={`${s.refreshBtn} ${autoRefresh ? s.refreshBtnActive : ''}`}
            onClick={() => setAutoRefresh((v) => !v)}
            title={
              autoRefresh
                ? `Auto-refresh every ${REFRESH_INTERVAL_MS / 1000}s — last: ${lastRefreshText}`
                : `Auto-refresh paused — last: ${lastRefreshText}`
            }
          >
            <span className={s.dot} />
            {autoRefresh ? 'Live' : 'Paused'}
          </button>
          <button type="button" className={s.refreshBtn} onClick={() => void fetchAll()}>
            Refresh now
          </button>
        </div>
      </div>

      {error && <StatusBanner kind="error">{error}</StatusBanner>}

      {/* Service catalog */}
      <div className={s.catalog}>
        <div className={s.catalogHeader}>
          <span className={s.catalogTitle}>
            Services{' '}
            <span className={s.catalogCount}>
              {!loadingSummaries && `(${sortedSummaries.length})`}
            </span>
          </span>
          <span className={s.catalogCount}>
            Click a row for the service detail view
          </span>
        </div>
        {loadingSummaries ? (
          <div className={s.tableSkeleton}>
            {[82, 75, 88, 70, 94, 66, 80].map((w, i) => (
              <div key={i} style={{ width: `${w}%` }} />
            ))}
          </div>
        ) : sortedSummaries.length === 0 ? (
          <div className={s.empty}>No services reported traces in this range.</div>
        ) : (
          <table className={s.table}>
            <thead>
              <tr>
                <th onClick={() => toggleSort('service')}>
                  Service <span className={s.sortChip}>{sortIndicator('service')}</span>
                </th>
                <th className={s.num} onClick={() => toggleSort('requests')}>
                  Rate <span className={s.sortChip}>{sortIndicator('requests')}</span>
                </th>
                <th className={s.num} onClick={() => toggleSort('errorRate')}>
                  Errors <span className={s.sortChip}>{sortIndicator('errorRate')}</span>
                </th>
                <th className={s.num} onClick={() => toggleSort('p50Us')}>
                  p50 <span className={s.sortChip}>{sortIndicator('p50Us')}</span>
                </th>
                <th className={s.num} onClick={() => toggleSort('p95Us')}>
                  p95 <span className={s.sortChip}>{sortIndicator('p95Us')}</span>
                </th>
                <th className={s.num} onClick={() => toggleSort('p99Us')}>
                  p99 <span className={s.sortChip}>{sortIndicator('p99Us')}</span>
                </th>
                <th>Requests</th>
                <th>Latency p95</th>
              </tr>
            </thead>
            <tbody>
              {sortedSummaries.map((svc) => {
                const color = serviceColor(svc.service);
                const err = fmtErrorRate(svc.errorRate);
                const reqSpark = sparksByService.requests.get(svc.service) ?? [];
                const p95Spark = sparksByService.p95.get(svc.service) ?? [];
                return (
                  <tr
                    key={svc.service}
                    onClick={() =>
                      (window.location.href = `./service/${encodeURIComponent(svc.service)}`)
                    }
                  >
                    <td>
                      <Link
                        to={`/service/${encodeURIComponent(svc.service)}`}
                        className={s.svcCell}
                        onClick={(e) => e.stopPropagation()}
                        style={{ textDecoration: 'none', color: 'inherit' }}
                      >
                        <span className={s.svcDot} style={{ background: color }} />
                        <span className={s.svcName}>{svc.service}</span>
                      </Link>
                    </td>
                    <td className={s.num}>
                      <strong>{fmtRate(reqPerMin(svc.requests))}</strong>
                    </td>
                    <td className={`${s.num} ${err.className}`}>{err.text}</td>
                    <td className={s.num}>{fmtUs(svc.p50Us)}</td>
                    <td className={s.num}>
                      <strong>{fmtUs(svc.p95Us)}</strong>
                    </td>
                    <td className={s.num}>{fmtUs(svc.p99Us)}</td>
                    <td className={s.sparkCell}>
                      <Sparkline
                        data={reqSpark}
                        width={110}
                        height={24}
                        color={color}
                        fill
                        ariaLabel={`Request rate sparkline for ${svc.service}`}
                      />
                    </td>
                    <td className={s.sparkCell}>
                      <Sparkline
                        data={p95Spark}
                        width={110}
                        height={24}
                        color={color}
                        strokeWidth={1.5}
                        ariaLabel={`p95 latency sparkline for ${svc.service}`}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Bottom panels: slow traces + error traces */}
      <div className={s.panels}>
        <TraceBriefList
          title="Slowest traces"
          subtitle="Top 20 by total duration"
          traces={slowTraces}
          loading={loadingSlow}
          mode="duration"
          emptyMessage="No traces in this range."
        />
        <TraceBriefList
          title="Recent errors"
          subtitle="Most recent traces with ≥1 error span"
          traces={errorTraces}
          loading={loadingErrors}
          mode="errors"
          emptyMessage="No errors in this range — all clear."
        />
      </div>

      {loadingBuckets && null /* sparklines fill in when buckets arrive */}
    </div>
  );
}
