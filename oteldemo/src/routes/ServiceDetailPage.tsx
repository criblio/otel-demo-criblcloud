import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import TimeRangePicker, { binSecondsFor } from '../components/TimeRangePicker';
import LineChart, { type LineSeries } from '../components/LineChart';
import TraceBriefList from '../components/TraceBriefList';
import StatusBanner from '../components/StatusBanner';
import {
  listServiceSummaries,
  getServiceTimeSeries,
  listOperationSummaries,
  listRecentErrorTraces,
  getDependencies,
} from '../api/search';
import { serviceColor } from '../utils/spans';
import type {
  ServiceSummary,
  ServiceBucket,
  OperationSummary,
  TraceBrief,
  DependencyEdge,
} from '../api/types';
import s from './ServiceDetailPage.module.css';

const DEFAULT_RANGE = '-1h';

function fmtUs(us: number): string {
  if (!Number.isFinite(us) || us === 0) return '—';
  if (us < 1000) return `${us.toFixed(0)} μs`;
  if (us < 1_000_000) return `${(us / 1000).toFixed(1)} ms`;
  return `${(us / 1_000_000).toFixed(2)} s`;
}

function fmtUsAxis(us: number): string {
  if (us === 0) return '0';
  if (us < 1000) return `${us.toFixed(0)}μs`;
  if (us < 1_000_000) return `${(us / 1000).toFixed(0)}ms`;
  return `${(us / 1_000_000).toFixed(1)}s`;
}

function fmtRate(requestsPerMin: number): string {
  if (requestsPerMin >= 1000) return `${(requestsPerMin / 1000).toFixed(1)}k/min`;
  if (requestsPerMin >= 10) return `${requestsPerMin.toFixed(0)}/min`;
  return `${requestsPerMin.toFixed(1)}/min`;
}

function errClass(rate: number): string {
  if (rate === 0) return s.errZero;
  return rate * 100 >= 1 ? s.errHigh : s.errLow;
}

/** Parse a relative-time like "-1h" into ms duration, for rate normalization. */
function relativeTimeMs(rel: string): number {
  const m = rel.match(/^-(\d+)([smhd])$/);
  if (!m) return 3600_000;
  const n = Number(m[1]);
  const unit = m[2] as 's' | 'm' | 'h' | 'd';
  return n * { s: 1000, m: 60_000, h: 3600_000, d: 86_400_000 }[unit];
}

export default function ServiceDetailPage() {
  const { serviceName = '' } = useParams();
  const navigate = useNavigate();
  const [range, setRange] = useState(DEFAULT_RANGE);
  const [summary, setSummary] = useState<ServiceSummary | null>(null);
  const [buckets, setBuckets] = useState<ServiceBucket[]>([]);
  const [operations, setOperations] = useState<OperationSummary[]>([]);
  const [errorTraces, setErrorTraces] = useState<TraceBrief[]>([]);
  const [edges, setEdges] = useState<DependencyEdge[]>([]);
  const [loadingSummary, setLoadingSummary] = useState(true);
  const [loadingBuckets, setLoadingBuckets] = useState(true);
  const [loadingOps, setLoadingOps] = useState(true);
  const [loadingErrors, setLoadingErrors] = useState(true);
  const [loadingDeps, setLoadingDeps] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);

  const fetchAll = useCallback(async () => {
    setError(null);
    setNotFound(false);
    setLoadingSummary(true);
    setLoadingBuckets(true);
    setLoadingOps(true);
    setLoadingErrors(true);
    setLoadingDeps(true);
    const binSeconds = binSecondsFor(range);

    // Summary (and "does the service even exist in this range?")
    listServiceSummaries(range, 'now')
      .then((all) => {
        const mine = all.find((x) => x.service === serviceName);
        setSummary(mine ?? null);
        setNotFound(!mine);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => setLoadingSummary(false));

    getServiceTimeSeries(binSeconds, serviceName, range, 'now')
      .then((rows) => setBuckets(rows))
      .catch(() => setBuckets([]))
      .finally(() => setLoadingBuckets(false));

    listOperationSummaries(serviceName, range, 'now')
      .then((ops) => setOperations(ops))
      .catch(() => setOperations([]))
      .finally(() => setLoadingOps(false));

    listRecentErrorTraces(serviceName, range, 'now')
      .then((et) => setErrorTraces(et))
      .catch(() => setErrorTraces([]))
      .finally(() => setLoadingErrors(false));

    getDependencies(range, 'now')
      .then((e) => setEdges(e))
      .catch(() => setEdges([]))
      .finally(() => setLoadingDeps(false));
  }, [range, serviceName]);

  useEffect(() => {
    void fetchAll();
  }, [fetchAll]);

  const color = serviceColor(serviceName);
  const rangeMinutes = relativeTimeMs(range) / 60_000;

  // Prepare chart series from buckets
  const chartSeries = useMemo(() => {
    const sorted = [...buckets].sort((a, b) => a.bucketMs - b.bucketMs);
    const binMs = binSecondsFor(range) * 1000;
    const ratePoints = sorted.map((b) => ({
      t: b.bucketMs,
      // Express as req/min regardless of bin width for a stable y-axis unit
      v: (b.requests * 60_000) / binMs,
    }));
    const errorPoints = sorted.map((b) => ({
      t: b.bucketMs,
      v: b.requests > 0 ? (b.errors / b.requests) * 100 : 0,
    }));
    const p50Points = sorted.map((b) => ({ t: b.bucketMs, v: b.p50Us }));
    const p95Points = sorted.map((b) => ({ t: b.bucketMs, v: b.p95Us }));
    const p99Points = sorted.map((b) => ({ t: b.bucketMs, v: b.p99Us }));
    return { ratePoints, errorPoints, p50Points, p95Points, p99Points };
  }, [buckets, range]);

  const rateSeries: LineSeries[] = [
    {
      name: 'Requests/min',
      color,
      data: chartSeries.ratePoints,
      format: (v) => fmtRate(v),
    },
  ];
  const errorsSeries: LineSeries[] = [
    {
      name: 'Error rate',
      color: 'var(--cds-color-danger)',
      data: chartSeries.errorPoints,
      format: (v) => `${v.toFixed(2)}%`,
    },
  ];
  const durSeries: LineSeries[] = [
    {
      name: 'p50',
      color: '#60a5fa',
      data: chartSeries.p50Points,
      format: fmtUs,
    },
    {
      name: 'p95',
      color: '#f59e0b',
      data: chartSeries.p95Points,
      format: fmtUs,
    },
    {
      name: 'p99',
      color: '#ef4444',
      data: chartSeries.p99Points,
      format: fmtUs,
    },
  ];

  // Derive upstream / downstream from dependencies
  const { upstream, downstream } = useMemo(() => {
    const up = edges
      .filter((e) => e.child === serviceName && e.parent !== serviceName)
      .sort((a, b) => b.callCount - a.callCount);
    const down = edges
      .filter((e) => e.parent === serviceName && e.child !== serviceName)
      .sort((a, b) => b.callCount - a.callCount);
    return { upstream: up, downstream: down };
  }, [edges, serviceName]);

  if (notFound && !loadingSummary) {
    return (
      <div className={s.page}>
        <div className={s.crumbs}>
          <Link to="/">Home</Link>
          <span className={s.crumbSep}>/</span>
          <span>{serviceName}</span>
        </div>
        <div className={s.notFound}>
          <strong>{serviceName}</strong> has no traces in this time range. Try a wider
          lookback or <Link to="/">return to Home</Link>.
        </div>
        <div style={{ display: 'flex', justifyContent: 'center' }}>
          <TimeRangePicker value={range} onChange={setRange} />
        </div>
      </div>
    );
  }

  return (
    <div className={s.page}>
      <div className={s.crumbs}>
        <Link to="/">Home</Link>
        <span className={s.crumbSep}>/</span>
        <span>Service</span>
        <span className={s.crumbSep}>/</span>
        <span>{serviceName}</span>
      </div>

      {error && <StatusBanner kind="error">{error}</StatusBanner>}

      <div className={s.hero}>
        <div className={s.heroSwatch} style={{ background: color }} />
        <div className={s.heroMain}>
          <h1 className={s.heroName}>{serviceName}</h1>
          <div className={s.heroSubtitle}>
            {loadingSummary
              ? 'Loading…'
              : summary
                ? `${summary.requests.toLocaleString()} requests · ${operations.length} operations · ${upstream.length} upstream / ${downstream.length} downstream`
                : 'No data'}
          </div>
        </div>
        <div className={s.heroStats}>
          <div className={s.stat}>
            <span className={s.statLabel}>Rate</span>
            <span className={s.statValue}>
              {summary ? fmtRate(summary.requests / rangeMinutes) : '—'}
            </span>
          </div>
          <div className={s.stat}>
            <span className={s.statLabel}>Error rate</span>
            <span
              className={`${s.statValue} ${summary && summary.errorRate > 0 ? s.statValueError : ''}`}
            >
              {summary ? `${(summary.errorRate * 100).toFixed(2)}%` : '—'}
            </span>
          </div>
          <div className={s.stat}>
            <span className={s.statLabel}>p95</span>
            <span className={s.statValue}>{summary ? fmtUs(summary.p95Us) : '—'}</span>
          </div>
          <TimeRangePicker value={range} onChange={setRange} />
        </div>
      </div>

      {/* RED charts */}
      <div className={s.charts}>
        <LineChart
          title="Rate"
          subtitle="Requests per minute"
          series={rateSeries}
          yFormat={(v) => (v >= 1 ? v.toFixed(0) : v.toFixed(1))}
          emptyMessage={loadingBuckets ? 'Loading…' : 'No data'}
        />
        <LineChart
          title="Errors"
          subtitle="Error rate (%)"
          series={errorsSeries}
          yFormat={(v) => `${v.toFixed(1)}%`}
          emptyMessage={loadingBuckets ? 'Loading…' : 'No data'}
        />
        <LineChart
          title="Duration"
          subtitle="Latency p50 / p95 / p99"
          series={durSeries}
          yFormat={fmtUsAxis}
          emptyMessage={loadingBuckets ? 'Loading…' : 'No data'}
        />
      </div>

      {/* Lower grid */}
      <div className={s.grid}>
        <div className={s.opsCard}>
          <div className={s.cardHeader}>
            <span className={s.cardTitle}>
              Top operations{' '}
              {!loadingOps && (
                <span className={s.cardSubtitle}>({operations.length})</span>
              )}
            </span>
            <span className={s.cardSubtitle}>Click a row to search for matching traces</span>
          </div>
          {loadingOps ? (
            <div className={s.skeletonRows}>
              {[0, 1, 2, 3, 4, 5, 6].map((i) => (
                <div key={i} style={{ width: `${50 + Math.random() * 40}%` }} />
              ))}
            </div>
          ) : operations.length === 0 ? (
            <div className={s.emptyState}>No operations in this range.</div>
          ) : (
            <table className={s.opsTable}>
              <thead>
                <tr>
                  <th>Operation</th>
                  <th className={s.num}>Requests</th>
                  <th className={s.num}>Errors</th>
                  <th className={s.num}>p50</th>
                  <th className={s.num}>p95</th>
                  <th className={s.num}>p99</th>
                </tr>
              </thead>
              <tbody>
                {operations.map((op) => (
                  <tr
                    key={op.operation}
                    onClick={() =>
                      navigate(
                        `/search?service=${encodeURIComponent(serviceName)}&operation=${encodeURIComponent(op.operation)}&lookback=${range}`,
                      )
                    }
                  >
                    <td>
                      <div className={s.opName}>{op.operation}</div>
                    </td>
                    <td className={s.num}>{op.requests.toLocaleString()}</td>
                    <td className={`${s.num} ${errClass(op.errorRate)}`}>
                      {op.errorRate === 0 ? '0' : `${(op.errorRate * 100).toFixed(1)}%`}
                    </td>
                    <td className={s.num}>{fmtUs(op.p50Us)}</td>
                    <td className={s.num}>{fmtUs(op.p95Us)}</td>
                    <td className={s.num}>{fmtUs(op.p99Us)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className={s.sideCol}>
          <TraceBriefList
            title="Recent errors"
            subtitle={`Error traces touching ${serviceName}`}
            traces={errorTraces}
            loading={loadingErrors}
            mode="errors"
            emptyMessage="No error traces in this range — all clear."
          />

          <div className={s.depsCard}>
            <div className={s.cardHeader}>
              <span className={s.cardTitle}>
                Dependencies{' '}
                {!loadingDeps && (
                  <span className={s.cardSubtitle}>
                    ({upstream.length} ↑ · {downstream.length} ↓)
                  </span>
                )}
              </span>
            </div>
            {loadingDeps ? (
              <div className={s.skeletonRows}>
                {[0, 1, 2, 3].map((i) => (
                  <div key={i} style={{ width: `${40 + Math.random() * 40}%` }} />
                ))}
              </div>
            ) : upstream.length + downstream.length === 0 ? (
              <div className={s.depsEmpty}>No edges involving {serviceName}.</div>
            ) : (
              <>
                {upstream.length > 0 && (
                  <div>
                    <div
                      style={{
                        padding: '6px 16px',
                        fontSize: '11px',
                        textTransform: 'uppercase',
                        letterSpacing: '0.4px',
                        color: 'var(--cds-color-fg-muted)',
                        background: 'var(--cds-color-bg-subtle)',
                      }}
                    >
                      Upstream ({upstream.length})
                    </div>
                    <ul className={s.depsList}>
                      {upstream.map((e) => (
                        <li key={`up-${e.parent}`}>
                          <Link
                            to={`/service/${encodeURIComponent(e.parent)}`}
                            className={s.depsItem}
                          >
                            <div className={s.depsLeft}>
                              <span
                                className={s.depsSvcDot}
                                style={{ background: serviceColor(e.parent) }}
                              />
                              <span className={s.depsSvc}>{e.parent}</span>
                            </div>
                            <span className={s.depsCount}>
                              {e.callCount.toLocaleString()} calls
                            </span>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {downstream.length > 0 && (
                  <div>
                    <div
                      style={{
                        padding: '6px 16px',
                        fontSize: '11px',
                        textTransform: 'uppercase',
                        letterSpacing: '0.4px',
                        color: 'var(--cds-color-fg-muted)',
                        background: 'var(--cds-color-bg-subtle)',
                      }}
                    >
                      Downstream ({downstream.length})
                    </div>
                    <ul className={s.depsList}>
                      {downstream.map((e) => (
                        <li key={`down-${e.child}`}>
                          <Link
                            to={`/service/${encodeURIComponent(e.child)}`}
                            className={s.depsItem}
                          >
                            <div className={s.depsLeft}>
                              <span
                                className={s.depsSvcDot}
                                style={{ background: serviceColor(e.child) }}
                              />
                              <span className={s.depsSvc}>{e.child}</span>
                            </div>
                            <span className={s.depsCount}>
                              {e.callCount.toLocaleString()} calls
                            </span>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
