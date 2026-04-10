/**
 * Floating stat card rendered on top of the dependency graph when the
 * user hovers or pins a service node. Shares layout with the Home
 * catalog row + Service detail hero but in a compact, positioned form.
 */
import { Link } from 'react-router-dom';
import Sparkline from './Sparkline';
import { serviceHealth } from '../utils/health';
import type { ServiceSummary, ServiceBucket } from '../api/types';
import s from './NodeTooltip.module.css';

interface Props {
  service: string;
  summary: ServiceSummary | undefined;
  buckets: ServiceBucket[];
  pinned: boolean;
  left: number;
  top: number;
  onClose: () => void;
}

function fmtRate(perMin: number): string {
  if (perMin >= 1000) return `${(perMin / 1000).toFixed(1)}k/min`;
  if (perMin >= 10) return `${perMin.toFixed(0)}/min`;
  return `${perMin.toFixed(1)}/min`;
}

function fmtUs(us: number): string {
  if (!Number.isFinite(us) || us === 0) return '—';
  if (us < 1000) return `${us.toFixed(0)} μs`;
  if (us < 1_000_000) return `${(us / 1000).toFixed(1)} ms`;
  return `${(us / 1_000_000).toFixed(2)} s`;
}

export default function NodeTooltip({
  service,
  summary,
  buckets,
  pinned,
  left,
  top,
  onClose,
}: Props) {
  const health = serviceHealth(summary);

  // Compute req/min assuming buckets cover the full window
  let reqPerMin = 0;
  let rangeMs = 0;
  if (buckets.length >= 2) {
    rangeMs = buckets[buckets.length - 1].bucketMs - buckets[0].bucketMs;
  }
  if (summary && rangeMs > 0) {
    reqPerMin = summary.requests / (rangeMs / 60_000);
  }

  const reqSpark = buckets.map((b) => ({ t: b.bucketMs, v: b.requests }));
  const p95Spark = buckets.map((b) => ({ t: b.bucketMs, v: b.p95Us }));
  const errSpark = buckets.map((b) => ({
    t: b.bucketMs,
    v: b.requests > 0 ? (b.errors / b.requests) * 100 : 0,
  }));

  return (
    <div
      className={`${s.card} ${pinned ? s.cardPinned : ''}`}
      style={{ left, top }}
      onClick={(e) => e.stopPropagation()}
    >
      <div className={s.header}>
        <span className={s.healthDot} style={{ background: health.color }} />
        <span className={s.name}>{service}</span>
        {pinned && (
          <button
            type="button"
            className={s.closeBtn}
            onClick={onClose}
            aria-label="Close"
          >
            ×
          </button>
        )}
      </div>

      <div className={s.statusLine}>{health.label}</div>

      {!summary ? (
        <div className={s.missing}>No traffic for this service in the selected range.</div>
      ) : (
        <>
          <div className={s.stats}>
            <span className={s.statLabel}>Requests</span>
            <span className={s.statValue}>{summary.requests.toLocaleString()}</span>
            <span className={s.statLabel}>Rate</span>
            <span className={s.statValue}>{fmtRate(reqPerMin)}</span>
            <span className={s.statLabel}>Errors</span>
            <span
              className={`${s.statValue} ${summary.errorRate > 0 ? s.statValueErr : ''}`}
            >
              {(summary.errorRate * 100).toFixed(2)}%
            </span>
            <span className={s.statLabel}>p50</span>
            <span className={s.statValue}>{fmtUs(summary.p50Us)}</span>
            <span className={s.statLabel}>p95</span>
            <span className={s.statValue}>{fmtUs(summary.p95Us)}</span>
            <span className={s.statLabel}>p99</span>
            <span className={s.statValue}>{fmtUs(summary.p99Us)}</span>
          </div>

          {reqSpark.length >= 2 && (
            <div className={s.sparkBlock}>
              <div className={s.sparkLabel}>
                <span>Requests over time</span>
              </div>
              <div className={s.sparkSvgWrap}>
                <Sparkline
                  data={reqSpark}
                  width={272}
                  height={28}
                  color={health.color}
                  fill
                  ariaLabel={`${service} request rate sparkline`}
                />
              </div>
            </div>
          )}

          {p95Spark.length >= 2 && (
            <div className={s.sparkBlock}>
              <div className={s.sparkLabel}>
                <span>p95 latency over time</span>
              </div>
              <div className={s.sparkSvgWrap}>
                <Sparkline
                  data={p95Spark}
                  width={272}
                  height={28}
                  color="#6366f1"
                  strokeWidth={1.5}
                  ariaLabel={`${service} p95 sparkline`}
                />
              </div>
            </div>
          )}

          {summary.errorRate > 0 && errSpark.length >= 2 && (
            <div className={s.sparkBlock}>
              <div className={s.sparkLabel}>
                <span>Error rate over time</span>
              </div>
              <div className={s.sparkSvgWrap}>
                <Sparkline
                  data={errSpark}
                  width={272}
                  height={28}
                  color="#dc2626"
                  fill
                  ariaLabel={`${service} error rate sparkline`}
                />
              </div>
            </div>
          )}
        </>
      )}

      <Link to={`/service/${encodeURIComponent(service)}`} className={s.openLink}>
        View service detail →
      </Link>

      {!pinned && <div className={s.pinHint}>Click the node to pin this card</div>}
    </div>
  );
}
