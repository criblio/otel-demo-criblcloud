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
