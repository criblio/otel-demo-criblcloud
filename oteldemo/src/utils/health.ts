/**
 * Map a service's recent stats into a health bucket + display color.
 *
 * Buckets are driven off error rate (primary signal). Latency is shown
 * alongside in the tooltip but doesn't affect the color because an
 * always-slow service isn't necessarily unhealthy — it might just be
 * a compute-heavy workload. Errors are more unambiguously bad.
 */
import type { ServiceSummary } from '../api/types';

export type HealthBucket = 'healthy' | 'watch' | 'warn' | 'critical' | 'idle';

export interface HealthInfo {
  bucket: HealthBucket;
  color: string;
  label: string;
}

const HEALTH: Record<HealthBucket, { color: string; label: string }> = {
  healthy: { color: '#10b981', label: 'Healthy (0 errors)' },
  watch: { color: '#eab308', label: 'Watch (<1% errors)' },
  warn: { color: '#f59e0b', label: 'Warn (1–5% errors)' },
  critical: { color: '#dc2626', label: 'Critical (>5% errors)' },
  idle: { color: '#9ca3af', label: 'No recent traffic' },
};

/** Very subtle row-background tint for a health bucket, matched to
 * Cribl's semantic-token palette. Used by the Home catalog to scan
 * for issues without overpowering the identity color dots. */
const HEALTH_BG: Record<HealthBucket, string> = {
  healthy: 'transparent',
  watch: 'rgba(234, 179, 8, 0.08)',
  warn: 'rgba(245, 158, 11, 0.12)',
  critical: 'rgba(220, 38, 38, 0.12)',
  idle: 'transparent',
};

export function healthRowBg(bucket: HealthBucket): string {
  return HEALTH_BG[bucket];
}

export const HEALTH_LEGEND: Array<{ bucket: HealthBucket; color: string; label: string }> = [
  { bucket: 'healthy', ...HEALTH.healthy },
  { bucket: 'watch', ...HEALTH.watch },
  { bucket: 'warn', ...HEALTH.warn },
  { bucket: 'critical', ...HEALTH.critical },
  { bucket: 'idle', ...HEALTH.idle },
];

export function serviceHealth(summary: ServiceSummary | undefined): HealthInfo {
  if (!summary || summary.requests === 0) {
    return { bucket: 'idle', ...HEALTH.idle };
  }
  const errPct = summary.errorRate * 100;
  if (errPct >= 5) return { bucket: 'critical', ...HEALTH.critical };
  if (errPct >= 1) return { bucket: 'warn', ...HEALTH.warn };
  if (errPct > 0) return { bucket: 'watch', ...HEALTH.watch };
  return { bucket: 'healthy', ...HEALTH.healthy };
}
