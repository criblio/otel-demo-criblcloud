import s from './TimeRangePicker.module.css';

export const TIME_RANGES: Array<{ label: string; value: string; binSeconds: number }> = [
  { label: 'Last 15 minutes', value: '-15m', binSeconds: 30 },
  { label: 'Last 1 hour', value: '-1h', binSeconds: 60 },
  { label: 'Last 6 hours', value: '-6h', binSeconds: 300 },
  { label: 'Last 24 hours', value: '-24h', binSeconds: 900 },
];

/** Look up the bin width for a relative-time value; defaults to 1m. */
export function binSecondsFor(range: string): number {
  return TIME_RANGES.find((r) => r.value === range)?.binSeconds ?? 60;
}

interface Props {
  value: string;
  onChange: (next: string) => void;
  label?: string;
  disabled?: boolean;
}

export default function TimeRangePicker({ value, onChange, label = 'Range', disabled }: Props) {
  return (
    <div className={s.wrap}>
      <span className={s.label}>{label}</span>
      <select
        className={s.select}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
      >
        {TIME_RANGES.map((r) => (
          <option key={r.value} value={r.value}>
            {r.label}
          </option>
        ))}
      </select>
    </div>
  );
}
