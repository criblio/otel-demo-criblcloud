/**
 * Tiny "vs previous window" delta pill.
 *
 * Used next to error rate, p95 latency, and request rate in the Home
 * service catalog and the Service Detail header. Answers the "is this
 * new?" question a user can't answer from an aggregate number alone —
 * a service stuck at 5% errors forever looks identical to a service
 * that started erroring 30 seconds ago, unless you have the delta.
 *
 * Props:
 *  - curr/prev: the two values being compared. Undefined prev means
 *    we don't have a baseline (e.g. the range reaches beyond the data
 *    retention window) — the chip then hides itself.
 *  - mode: rate uses relative %, errorRate uses absolute percentage
 *    points, latency uses relative %. Matches how humans read each
 *    metric.
 *  - threshold: only render when the change exceeds this (hides noise).
 *
 * Colour follows health semantics: worse = red, better = green, with
 * a subtle neutral gray when the change is tiny. "Worse" depends on
 * the metric — more errors = worse, higher latency = worse, but more
 * requests is neutral (load spike is informative, not bad).
 */
import { memo } from 'react';
import s from './DeltaChip.module.css';

export type DeltaMode = 'rel' | 'points' | 'relNeutral';

interface Props {
  curr: number | undefined;
  prev: number | undefined;
  mode: DeltaMode;
  /** Minimum absolute change required to render. */
  threshold: number;
  title?: string;
}

function DeltaChipImpl({ curr, prev, mode, threshold, title }: Props) {
  if (curr == null || prev == null || !Number.isFinite(curr) || !Number.isFinite(prev)) {
    return null;
  }
  // For relative modes, hide when prev is 0 (relative change is undefined).
  if ((mode === 'rel' || mode === 'relNeutral') && prev === 0) return null;

  let delta: number;
  let text: string;
  if (mode === 'points') {
    // Error rate: absolute percentage points (curr/prev are 0..1).
    delta = (curr - prev) * 100;
    if (Math.abs(delta) < threshold) return null;
    text = `${delta >= 0 ? '+' : ''}${delta.toFixed(2)}pp`;
  } else {
    // Relative % change.
    const rel = (curr - prev) / prev;
    delta = rel * 100;
    if (Math.abs(delta) < threshold) return null;
    text = `${delta >= 0 ? '+' : ''}${delta.toFixed(0)}%`;
  }

  // Direction coloring:
  //   points + rel: increase = bad (red), decrease = good (green)
  //   relNeutral: both directions are neutral (blue-ish), just informative
  let toneClass = s.neutral;
  if (mode !== 'relNeutral') {
    toneClass = delta > 0 ? s.worse : s.better;
  }
  const arrow = delta > 0 ? '▲' : '▼';

  return (
    <span className={`${s.chip} ${toneClass}`} title={title ?? `vs previous window: ${text}`}>
      {arrow} {text}
    </span>
  );
}

export default memo(DeltaChipImpl);
