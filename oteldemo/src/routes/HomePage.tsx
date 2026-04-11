import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import TimeRangePicker from '../components/TimeRangePicker';
import { binSecondsFor } from '../components/timeRanges';
import Sparkline from '../components/Sparkline';
import StatusBanner from '../components/StatusBanner';
import TraceClassList, { type ClassItem } from '../components/TraceClassList';
import OperationAnomalyList from '../components/OperationAnomalyList';
import {
  listServiceSummaries,
  getServiceTimeSeries,
  listSlowTraceClasses,
  listErrorClasses,
  listOperationAnomalies,
} from '../api/search';
import { serviceColor } from '../utils/spans';
import { serviceHealth, healthRowBg } from '../utils/health';
import { previousWindow } from '../utils/timeRange';
import { useRangeParam } from '../hooks/useRangeParam';
import { useStreamFilterEnabled } from '../hooks/useStreamFilter';
import DeltaChip from '../components/DeltaChip';
import type {
  ServiceSummary,
  ServiceBucket,
  SlowTraceClass,
  ErrorClass,
  OperationAnomaly,
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

/** Minimum previous-window sample count before we trust its percentiles
 * enough to render a delta chip. Smaller windows produce noisy tails. */
const MIN_PREV_SAMPLES = 10;

/** Auto-refresh interval options. 0 = off. */
const REFRESH_OPTIONS: Array<{ label: string; ms: number }> = [
  { label: 'Off', ms: 0 },
  { label: '15s', ms: 15_000 },
  { label: '30s', ms: 30_000 },
  { label: '1m', ms: 60_000 },
  { label: '2m', ms: 120_000 },
  { label: '5m', ms: 300_000 },
];
const DEFAULT_REFRESH_MS = 60_000;

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
  const [range, setRange] = useRangeParam(DEFAULT_RANGE);
  const navigate = useNavigate();
  const location = useLocation();
  // Passthrough the current search string (including ?range=) so
  // clicking into a service detail keeps the range context.
  const drillSuffix = location.search;
  const [summaries, setSummaries] = useState<ServiceSummary[]>([]);
  const [prevSummaries, setPrevSummaries] = useState<ServiceSummary[]>([]);
  const [buckets, setBuckets] = useState<ServiceBucket[]>([]);
  const [slowClasses, setSlowClasses] = useState<SlowTraceClass[]>([]);
  const [errorClasses, setErrorClasses] = useState<ErrorClass[]>([]);
  const [anomalies, setAnomalies] = useState<OperationAnomaly[]>([]);
  const [loadingSummaries, setLoadingSummaries] = useState(true);
  const [loadingBuckets, setLoadingBuckets] = useState(true);
  const [loadingSlow, setLoadingSlow] = useState(true);
  const [loadingErrors, setLoadingErrors] = useState(true);
  const [loadingAnomalies, setLoadingAnomalies] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshMs, setRefreshMs] = useState<number>(DEFAULT_REFRESH_MS);
  const [sort, setSort] = useState<SortState>({ key: 'requests', dir: 'desc' });
  // Lazy initializer keeps Date.now() out of the render body (purity rule).
  const [lastRefresh, setLastRefresh] = useState<number>(() => Date.now());
  // Subscribing to the stream-filter toggle so the page re-fetches
  // when the user flips it in Settings. The value isn't used directly
  // in render; it just needs to be in fetchAll's dep list below.
  const streamFilterEnabled = useStreamFilterEnabled();

  const fetchAll = useCallback(async () => {
    setError(null);
    const binSeconds = binSecondsFor(range);
    setLoadingSummaries(true);
    setLoadingBuckets(true);
    setLoadingSlow(true);
    setLoadingErrors(true);
    setLoadingAnomalies(true);

    // Fan out — we want the table to populate as soon as summaries arrive,
    // and the sparklines + bottom panels to fill in independently.
    const pSummaries = listServiceSummaries(range, 'now')
      .then((r) => setSummaries(r))
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : String(e));
        setSummaries([]);
      })
      .finally(() => setLoadingSummaries(false));

    // Previous window of the same length — fuels the delta-vs-baseline
    // chips. Failure here is non-fatal; we just skip the chips.
    const prev = previousWindow(range);
    const pPrevSummaries = listServiceSummaries(prev.earliest, prev.latest)
      .then((r) => setPrevSummaries(r))
      .catch(() => setPrevSummaries([]));

    const pBuckets = getServiceTimeSeries(binSeconds, undefined, range, 'now')
      .then((r) => setBuckets(r))
      .catch(() => setBuckets([]))
      .finally(() => setLoadingBuckets(false));

    const pSlow = listSlowTraceClasses(range, 'now')
      .then((r) => setSlowClasses(r))
      .catch(() => setSlowClasses([]))
      .finally(() => setLoadingSlow(false));

    const pErrors = listErrorClasses(range, 'now')
      .then((r) => setErrorClasses(r))
      .catch(() => setErrorClasses([]))
      .finally(() => setLoadingErrors(false));

    // Latency anomaly detection — runs two KQL queries (current
    // window + 24h rolling baseline), joins client-side. A long
    // baseline is necessary: an incident that's been running longer
    // than the current window would poison a same-length prior
    // window too, and the anomaly would sit hidden at ratio ≈1×.
    // 24h covers 23h of healthy history for any incident ≤1h old.
    //
    // This is the current approximation — see ROADMAP for the
    // scheduled-search-backed durable-baseline plan that replaces it.
    //
    // Non-fatal on failure; the widget simply shows empty.
    const pAnomalies = listOperationAnomalies(
      range,
      'now',
      '-25h',
      range,
    )
      .then((r) => setAnomalies(r))
      .catch(() => setAnomalies([]))
      .finally(() => setLoadingAnomalies(false));

    await Promise.allSettled([
      pSummaries,
      pPrevSummaries,
      pBuckets,
      pSlow,
      pErrors,
      pAnomalies,
    ]);
    setLastRefresh(Date.now());
    // streamFilterEnabled is intentionally in the dep list — the
    // queries pick it up from module state at build time, but the
    // callback itself doesn't reference it. Including it here gives
    // the useEffect below a fresh `fetchAll` identity when the user
    // toggles the filter in Settings, which triggers a re-fetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range, streamFilterEnabled]);

  // Initial load + on range change
  useEffect(() => {
    void fetchAll();
  }, [fetchAll]);

  // Auto-refresh with configurable interval. refreshMs === 0 disables.
  const timerRef = useRef<number | null>(null);
  useEffect(() => {
    if (refreshMs <= 0) return;
    timerRef.current = window.setInterval(() => {
      void fetchAll();
    }, refreshMs);
    return () => {
      if (timerRef.current != null) window.clearInterval(timerRef.current);
      timerRef.current = null;
    };
  }, [refreshMs, fetchAll]);

  // Index previous-window summaries for O(1) lookup in the render loop.
  const prevByService = useMemo(() => {
    const m = new Map<string, ServiceSummary>();
    for (const svc of prevSummaries) m.set(svc.service, svc);
    return m;
  }, [prevSummaries]);

  // Services with at least one operation latency anomaly — used by
  // serviceHealth() to tint the row cyan when a service has any
  // anomalous op, regardless of where it ranks in the anomaly widget.
  const anomalousServices = useMemo(() => {
    const set = new Set<string>();
    for (const a of anomalies) set.add(a.service);
    return set;
  }, [anomalies]);

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
          <div className={s.refreshPicker}>
            <span
              className={`${s.refreshStatusDot} ${refreshMs > 0 ? s.refreshStatusDotLive : ''}`}
              title={
                refreshMs > 0
                  ? `Auto-refresh every ${refreshMs / 1000}s — last: ${lastRefreshText}`
                  : `Auto-refresh off — last: ${lastRefreshText}`
              }
            />
            <span className={s.refreshLabel}>Refresh</span>
            <select
              className={s.refreshSelect}
              value={refreshMs}
              onChange={(e) => setRefreshMs(Number(e.target.value))}
              aria-label="Auto-refresh interval"
            >
              {REFRESH_OPTIONS.map((opt) => (
                <option key={opt.ms} value={opt.ms}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
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
                // Only compare against the previous window when it had
                // enough samples to trust the percentiles. Without this,
                // services with tiny prev-window volume (flagd, image-
                // provider) produce noisy chips that misfire in the
                // wrong direction.
                const prevRaw = prevByService.get(svc.service);
                const prev = prevRaw && prevRaw.requests >= MIN_PREV_SAMPLES ? prevRaw : undefined;
                // serviceHealth takes the previous window + the
                // anomalous-services set so it can promote to
                // `traffic_drop` (rate fell off) or `latency_anomaly`
                // (specific op is 5×+ slower than baseline) — the
                // two signals error-rate-only bucketing misses.
                const health = serviceHealth(svc, prevRaw, anomalousServices);
                const rowBg = healthRowBg(health.bucket);
                const prevReqPerMin = prev ? reqPerMin(prev.requests) : undefined;
                return (
                  <tr
                    key={svc.service}
                    style={rowBg !== 'transparent' ? { background: rowBg } : undefined}
                    onClick={() =>
                      navigate(`/service/${encodeURIComponent(svc.service)}${drillSuffix}`)
                    }
                  >
                    <td>
                      <Link
                        to={`/service/${encodeURIComponent(svc.service)}${drillSuffix}`}
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
                      <DeltaChip
                        curr={reqPerMin(svc.requests)}
                        prev={prevReqPerMin}
                        mode="relNeutral"
                        threshold={25}
                      />
                    </td>
                    <td className={`${s.num} ${err.className}`}>
                      {err.text}
                      <DeltaChip
                        curr={svc.errorRate}
                        prev={prev?.errorRate}
                        mode="points"
                        threshold={0.5}
                      />
                    </td>
                    <td className={s.num}>{fmtUs(svc.p50Us)}</td>
                    <td className={s.num}>
                      <strong>{fmtUs(svc.p95Us)}</strong>
                      <DeltaChip
                        curr={svc.p95Us}
                        prev={prev?.p95Us}
                        mode="rel"
                        threshold={30}
                      />
                    </td>
                    <td className={s.num}>
                      {fmtUs(svc.p99Us)}
                      <DeltaChip
                        curr={svc.p99Us}
                        prev={prev?.p99Us}
                        mode="rel"
                        threshold={30}
                      />
                    </td>
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

      {/* Anomalies panel — sits above the slow/error row so it reads
          first. Full-width because anomaly rows carry more text
          (op name + before/after p95 + count + ratio pill) and would
          clip in a half-column. */}
      <div className={s.panelsFull}>
        <OperationAnomalyList
          items={anomalies}
          loading={loadingAnomalies}
          lookback={range}
        />
      </div>

      {/* Bottom panels: slow trace classes + error classes */}
      <div className={s.panels}>
        <TraceClassList
          title="Slowest trace classes"
          subtitle="Grouped by root (service, operation) — click to view the worst example"
          items={slowClasses.map<ClassItem>((c) => ({
            key: `${c.rootService}\u0000${c.rootOperation}`,
            service: c.rootService,
            operation: c.rootOperation,
            count: c.count,
            sampleTraceID: c.sampleTraceIDs[0] ?? '',
            maxDurationUs: c.maxDurationUs,
            p95DurationUs: c.p95DurationUs,
            p50DurationUs: c.p50DurationUs,
          }))}
          loading={loadingSlow}
          mode="duration"
          emptyMessage="No traces in this range."
        />
        <TraceClassList
          title="Error classes"
          subtitle="Grouped by (service, operation, message) — click to view a sample"
          items={errorClasses.map<ClassItem>((c) => ({
            key: `${c.service}\u0000${c.operation}\u0000${c.message}`,
            service: c.service,
            operation: c.operation,
            count: c.count,
            message: c.message,
            sampleTraceID: c.sampleTraceIDs[0] ?? '',
            lastSeenMs: c.lastSeenMs,
          }))}
          loading={loadingErrors}
          mode="errors"
          emptyMessage="No errors in this range — all clear."
        />
      </div>

      {loadingBuckets && null /* sparklines fill in when buckets arrive */}
    </div>
  );
}
