/**
 * Latency anomaly widget shown on the Home page next to Slowest Trace
 * Classes and Error Classes. Lists operations whose current-window
 * p95 is ≥ N× the prior window's p95 — catches consumer-side delay,
 * downstream regressions, and other "this was fine yesterday" signals
 * that absolute-duration ranking misses.
 *
 * Each row click drills into Search, pre-filtered to (service,
 * operation) so the user lands on actual traces to investigate.
 *
 * TODO: render "reason pills" on each row once multiple heuristics
 * feed into the widget — ratio vs baseline, absolute p95, volume
 * jump, error-rate delta — so the user can see *why* an op was
 * flagged instead of having to trust a single scalar ratio.
 */
import { Link } from 'react-router-dom';
import { serviceColor } from '../utils/spans';
import type { OperationAnomaly } from '../api/types';
import s from './TraceClassList.module.css';

interface Props {
  items: OperationAnomaly[];
  loading?: boolean;
  /** Current lookback string ("-1h"), forwarded to the Search deep
   * link so the drill-through keeps the same window. */
  lookback: string;
}

function fmtDurationUs(us: number): string {
  if (!Number.isFinite(us) || us === 0) return '—';
  if (us < 1000) return `${us.toFixed(0)} μs`;
  if (us < 1_000_000) return `${(us / 1000).toFixed(1)} ms`;
  return `${(us / 1_000_000).toFixed(2)} s`;
}

function fmtRatio(ratio: number): string {
  if (!Number.isFinite(ratio)) return '—';
  if (ratio >= 100) return `×${ratio.toFixed(0)}`;
  if (ratio >= 10) return `×${ratio.toFixed(1)}`;
  return `×${ratio.toFixed(2)}`;
}

export default function OperationAnomalyList({ items, loading, lookback }: Props) {
  return (
    <div className={s.wrap}>
      <div className={s.header}>
        <span className={s.title}>
          Latency anomalies{' '}
          {!loading && <span className={s.subtitle}>({items.length} ops)</span>}
        </span>
        <span className={s.subtitle}>
          Operations whose p95 is ≥5× the prior window — click to search
        </span>
      </div>
      {loading ? (
        <div className={s.skeleton}>
          {[80, 68, 90, 72, 55].map((w, i) => (
            <div key={i} className={s.skeletonBar} style={{ width: `${w}%` }} />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className={s.empty}>No anomalies detected in this range.</div>
      ) : (
        <ul className={s.list}>
          {items.map((item) => (
            <li key={`${item.service}\u0000${item.operation}`}>
              <Link
                to={`/search?service=${encodeURIComponent(item.service)}&operation=${encodeURIComponent(item.operation)}&lookback=${lookback}`}
                className={s.row}
              >
                <div className={s.mainCol}>
                  <div className={s.topLine}>
                    <span
                      className={s.svcDot}
                      style={{ background: serviceColor(item.service) }}
                    />
                    <span className={s.svcName}>{item.service}</span>
                    <span className={s.opName}>{item.operation}</span>
                  </div>
                  <div className={s.statLine}>
                    <span>
                      <span className={s.statKey}>now p95</span>{' '}
                      <span className={s.statValue}>
                        {fmtDurationUs(item.currP95Us)}
                      </span>
                    </span>
                    <span>
                      <span className={s.statKey}>prev p95</span>{' '}
                      <span className={s.statValue}>
                        {fmtDurationUs(item.prevP95Us)}
                      </span>
                    </span>
                    <span>
                      <span className={s.statKey}>count</span>{' '}
                      <span className={s.statValue}>
                        {item.requests.toLocaleString()}
                      </span>
                    </span>
                  </div>
                </div>
                <span
                  className={s.countChip}
                  style={{
                    background: 'rgba(6, 182, 212, 0.15)',
                    color: '#06b6d4',
                  }}
                  title={`Current p95 is ${fmtRatio(item.ratio)} the prior-window p95`}
                >
                  {fmtRatio(item.ratio)}
                </span>
                <span className={s.arrow}>→</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
