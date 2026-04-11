/**
 * Metrics explorer. Modeled after Datadog's metrics browser: a
 * facet sidebar on the left (metric picker, service filter,
 * aggregation, lookback) and a chart pane on the right rendering
 * the selected series.
 *
 * Deliberately minimal for v1:
 *  - Single metric at a time (no overlay of multiple metrics yet)
 *  - Single time series (no group-by — the service filter scopes it)
 *  - Aggregations limited to avg/sum/min/max/count
 *  - Histograms render as mean (the `_value` column is pre-computed
 *    mean across the collector export interval). Real percentiles
 *    would require reading the cumulative bucket map, a v2 job.
 *  - Counters render as their raw cumulative value. Users can sort
 *    this out by eyeballing the slope — rate derivation is a v2.
 *
 * The picker shows metrics sorted by raw sample volume so high-signal
 * metrics (system.cpu.time, traces.span.metrics.calls) surface at
 * the top. A free-text filter trims the list.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import LineChart, { type LineSeries } from '../components/LineChart';
import TimeRangePicker from '../components/TimeRangePicker';
import StatusBanner from '../components/StatusBanner';
import {
  listMetrics,
  listMetricServices,
  getMetricSeries,
} from '../api/search';
import { binSecondsFor } from '../components/timeRanges';
import { useRangeParam } from '../hooks/useRangeParam';
import type { MetricSummary, MetricSeries } from '../api/types';
import s from './MetricsPage.module.css';

const DEFAULT_RANGE = '-1h';

type AggFn = 'avg' | 'sum' | 'min' | 'max' | 'count';
const AGG_OPTIONS: Array<{ id: AggFn; label: string }> = [
  { id: 'avg', label: 'avg' },
  { id: 'sum', label: 'sum' },
  { id: 'min', label: 'min' },
  { id: 'max', label: 'max' },
  { id: 'count', label: 'count' },
];

/** Format a metric value for display in the chart y-axis and tooltip.
 * Does light unit inference from the metric name: things with
 * `_bytes` / `.bytes` format as bytes; `_seconds` / `.time` as ms.
 * Fallback: generic k/M/B short form. */
function formatMetricValue(metric: string, v: number): string {
  if (!Number.isFinite(v)) return '—';
  const lower = metric.toLowerCase();
  if (
    lower.endsWith('_bytes') ||
    lower.endsWith('.bytes') ||
    lower.includes('memory') ||
    lower.includes('.disk.') ||
    lower.includes('heap_alloc')
  ) {
    if (Math.abs(v) >= 1e9) return `${(v / 1e9).toFixed(2)} GB`;
    if (Math.abs(v) >= 1e6) return `${(v / 1e6).toFixed(1)} MB`;
    if (Math.abs(v) >= 1e3) return `${(v / 1e3).toFixed(1)} KB`;
    return `${v.toFixed(0)} B`;
  }
  if (
    lower.endsWith('_seconds') ||
    lower.includes('.time') ||
    lower.includes('.duration')
  ) {
    // Many of these land in ms already via the OTel collector; show
    // whichever unit gives a readable number.
    if (Math.abs(v) >= 1000) return `${(v / 1000).toFixed(2)} s`;
    return `${v.toFixed(1)} ms`;
  }
  if (Math.abs(v) >= 1e9) return `${(v / 1e9).toFixed(2)}B`;
  if (Math.abs(v) >= 1e6) return `${(v / 1e6).toFixed(2)}M`;
  if (Math.abs(v) >= 1e3) return `${(v / 1e3).toFixed(1)}k`;
  return v.toFixed(v < 10 ? 2 : 0);
}

export default function MetricsPage() {
  const [range, setRange] = useRangeParam(DEFAULT_RANGE);
  const [metrics, setMetrics] = useState<MetricSummary[]>([]);
  const [metricsLoading, setMetricsLoading] = useState(true);
  const [metricsError, setMetricsError] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [selected, setSelected] = useState<string>('');
  const [services, setServices] = useState<string[]>([]);
  const [service, setService] = useState<string>('');
  const [agg, setAgg] = useState<AggFn>('avg');
  const [series, setSeries] = useState<MetricSeries | null>(null);
  const [chartLoading, setChartLoading] = useState(false);
  const [chartError, setChartError] = useState<string | null>(null);

  // Populate the metric catalog whenever the range changes.
  useEffect(() => {
    let cancelled = false;
    setMetricsLoading(true);
    setMetricsError(null);
    listMetrics(range, 'now')
      .then((list) => {
        if (cancelled) return;
        setMetrics(list);
        // Auto-select the first metric so the page is useful on
        // first paint instead of starting empty.
        if (list.length > 0 && !selected) {
          setSelected(list[0].name);
        }
      })
      .catch((err) => {
        if (cancelled) return;
        setMetricsError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setMetricsLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range]);

  // Populate the service filter dropdown whenever the chosen metric
  // changes — scoped to services that actually emit this metric.
  useEffect(() => {
    if (!selected) {
      setServices([]);
      return;
    }
    let cancelled = false;
    listMetricServices(selected, range, 'now')
      .then((list) => {
        if (!cancelled) {
          setServices(list);
          // If the currently-selected service doesn't emit this
          // metric, clear it so the chart shows all services.
          if (service && !list.includes(service)) setService('');
        }
      })
      .catch(() => {
        if (!cancelled) setServices([]);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, range]);

  // Fetch the chart data whenever any of the axis inputs change.
  const fetchSeries = useCallback(async () => {
    if (!selected) {
      setSeries(null);
      return;
    }
    setChartLoading(true);
    setChartError(null);
    try {
      const result = await getMetricSeries(
        {
          metric: selected,
          service: service || undefined,
          binSeconds: binSecondsFor(range),
          agg,
        },
        range,
        'now',
      );
      setSeries(result);
    } catch (err) {
      setChartError(err instanceof Error ? err.message : String(err));
      setSeries(null);
    } finally {
      setChartLoading(false);
    }
  }, [selected, service, agg, range]);

  useEffect(() => {
    void fetchSeries();
  }, [fetchSeries]);

  // Filter the metric picker by the free-text filter (substring match).
  const filteredMetrics = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return metrics;
    return metrics.filter((m) => m.name.toLowerCase().includes(q));
  }, [metrics, filter]);

  // Convert the loaded series into a LineChart-ready shape.
  const chartSeries: LineSeries[] = useMemo(() => {
    if (!series) return [];
    return [
      {
        name: `${agg}(${selected})${service ? ` · ${service}` : ''}`,
        color: 'var(--cds-color-accent)',
        data: series.points,
        format: (v) => formatMetricValue(selected, v),
      },
    ];
  }, [series, agg, selected, service]);

  const selectedSummary = metrics.find((m) => m.name === selected);

  return (
    <div className={s.layout}>
      <aside className={s.sidebar}>
        <div className={s.panel}>
          <div className={s.panelHeader}>
            <span className={s.panelTitle}>Filters</span>
            <span className={s.panelHint}>
              {metricsLoading
                ? 'loading…'
                : `${metrics.length} metric${metrics.length === 1 ? '' : 's'}`}
            </span>
          </div>

          <div className={s.field}>
            <span className={s.fieldLabel}>Metric</span>
            <input
              type="text"
              className={s.input}
              placeholder="filter metric names…"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
            <div className={s.metricList}>
              {metricsLoading && (
                <div className={s.metricHint}>Loading metrics…</div>
              )}
              {!metricsLoading && filteredMetrics.length === 0 && (
                <div className={s.metricHint}>No metrics match.</div>
              )}
              {filteredMetrics.map((m) => (
                <button
                  key={m.name}
                  type="button"
                  className={`${s.metricItem} ${selected === m.name ? s.metricItemActive : ''}`}
                  onClick={() => setSelected(m.name)}
                  title={`${m.samples.toLocaleString()} samples · ${m.services} service${m.services === 1 ? '' : 's'}`}
                >
                  <span className={s.metricName}>{m.name}</span>
                  <span className={s.metricCount}>
                    {m.samples >= 1000
                      ? `${(m.samples / 1000).toFixed(1)}k`
                      : m.samples}
                  </span>
                </button>
              ))}
            </div>
          </div>

          <label className={s.field}>
            <span className={s.fieldLabel}>Service</span>
            <select
              className={s.select}
              value={service}
              onChange={(e) => setService(e.target.value)}
              disabled={!selected || services.length === 0}
            >
              <option value="">All services</option>
              {services.map((svc) => (
                <option key={svc} value={svc}>
                  {svc}
                </option>
              ))}
            </select>
          </label>

          <div className={s.field}>
            <span className={s.fieldLabel}>Aggregation</span>
            <div className={s.aggGroup}>
              {AGG_OPTIONS.map((o) => (
                <button
                  key={o.id}
                  type="button"
                  className={`${s.aggBtn} ${agg === o.id ? s.aggBtnActive : ''}`}
                  onClick={() => setAgg(o.id)}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </div>

          <label className={s.field}>
            <span className={s.fieldLabel}>Lookback</span>
            <TimeRangePicker value={range} onChange={setRange} />
          </label>
        </div>
      </aside>

      <main className={s.results}>
        <div className={s.hero}>
          <div>
            <h1 className={s.heroTitle}>Metrics</h1>
            <div className={s.heroSubtitle}>
              OTel metric explorer backed by the <code>otel</code> dataset.
            </div>
          </div>
        </div>

        {metricsError && <StatusBanner kind="error">{metricsError}</StatusBanner>}
        {chartError && <StatusBanner kind="error">{chartError}</StatusBanner>}

        {selected && (
          <div className={s.metricHeader}>
            <div>
              <div className={s.metricTitle}>{selected}</div>
              {selectedSummary && (
                <div className={s.metricMeta}>
                  {selectedSummary.samples.toLocaleString()} samples ·{' '}
                  {selectedSummary.services} service
                  {selectedSummary.services === 1 ? '' : 's'} · agg ={' '}
                  <strong>{agg}</strong>
                  {service && (
                    <>
                      {' '}
                      · filtered to <strong>{service}</strong>
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {selected && (
          <LineChart
            title={selected}
            subtitle={`${agg}${service ? ` · ${service}` : ''}`}
            series={chartSeries}
            yFormat={(v) => formatMetricValue(selected, v)}
            emptyMessage={
              chartLoading
                ? 'Loading…'
                : chartError
                  ? 'Query failed'
                  : 'No data for this metric in the selected range.'
            }
          />
        )}

        {!selected && !metricsLoading && (
          <StatusBanner kind="info">
            Pick a metric from the sidebar to chart it.
          </StatusBanner>
        )}
      </main>
    </div>
  );
}
