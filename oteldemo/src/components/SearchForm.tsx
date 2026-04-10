import { useEffect, useState, type FormEvent } from 'react';
import { listServices, listOperations } from '../api/search';
import s from './SearchForm.module.css';

export interface SearchFormState {
  service: string;
  operation: string;
  tags: string;
  minDuration: string;
  maxDuration: string;
  limit: number;
  lookback: string;
}

export const DEFAULT_SEARCH_STATE: SearchFormState = {
  service: '',
  operation: '',
  tags: '',
  minDuration: '',
  maxDuration: '',
  limit: 20,
  lookback: '-1h',
};

const LOOKBACK_OPTIONS: Array<{ label: string; value: string }> = [
  { label: 'Last 5 minutes', value: '-5m' },
  { label: 'Last 15 minutes', value: '-15m' },
  { label: 'Last 1 hour', value: '-1h' },
  { label: 'Last 6 hours', value: '-6h' },
  { label: 'Last 24 hours', value: '-24h' },
  { label: 'Last 7 days', value: '-7d' },
];

interface Props {
  state: SearchFormState;
  onSubmit: (next: SearchFormState) => void;
  loading: boolean;
}

export default function SearchForm({ state, onSubmit, loading }: Props) {
  const [draft, setDraft] = useState<SearchFormState>(state);
  const [services, setServices] = useState<string[]>([]);
  const [operations, setOperations] = useState<string[]>([]);
  const [servicesError, setServicesError] = useState<string | null>(null);

  // Sync draft with parent-driven state (e.g. URL hydration)
  useEffect(() => {
    setDraft(state);
  }, [state]);

  // Fetch services on mount and whenever lookback changes
  useEffect(() => {
    let cancelled = false;
    setServicesError(null);
    listServices(draft.lookback)
      .then((svcs) => {
        if (!cancelled) setServices(svcs);
      })
      .catch((err) => {
        if (!cancelled) setServicesError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, [draft.lookback]);

  // Fetch operations whenever the selected service changes
  useEffect(() => {
    let cancelled = false;
    if (!draft.service) {
      setOperations([]);
      return;
    }
    listOperations(draft.service, draft.lookback)
      .then((ops) => {
        if (!cancelled) setOperations(ops);
      })
      .catch(() => {
        if (!cancelled) setOperations([]);
      });
    return () => {
      cancelled = true;
    };
  }, [draft.service, draft.lookback]);

  function update<K extends keyof SearchFormState>(key: K, value: SearchFormState[K]) {
    setDraft((d) => ({ ...d, [key]: value }));
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    onSubmit(draft);
  }

  return (
    <form className={s.form} onSubmit={handleSubmit}>
      <div className={s.field}>
        <label className={s.label}>Service</label>
        <select
          className={s.select}
          value={draft.service}
          onChange={(e) => update('service', e.target.value)}
          disabled={loading}
        >
          <option value="">{servicesError ? 'Error loading services' : 'Select a service…'}</option>
          {services.map((svc) => (
            <option key={svc} value={svc}>
              {svc}
            </option>
          ))}
        </select>
      </div>

      <div className={s.field}>
        <label className={s.label}>Operation</label>
        <select
          className={s.select}
          value={draft.operation}
          onChange={(e) => update('operation', e.target.value)}
          disabled={loading || !draft.service}
        >
          <option value="">All operations</option>
          {operations.map((op) => (
            <option key={op} value={op}>
              {op}
            </option>
          ))}
        </select>
      </div>

      <div className={s.field}>
        <label className={s.label}>Lookback</label>
        <select
          className={s.select}
          value={draft.lookback}
          onChange={(e) => update('lookback', e.target.value)}
          disabled={loading}
        >
          {LOOKBACK_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      <div className={s.field}>
        <label className={s.label}>Tags</label>
        <input
          className={s.input}
          type="text"
          placeholder="error=true http.status_code=500"
          value={draft.tags}
          onChange={(e) => update('tags', e.target.value)}
          disabled={loading}
        />
      </div>

      <div className={s.field}>
        <label className={s.label}>Min Duration (μs)</label>
        <input
          className={s.input}
          type="number"
          min="0"
          placeholder="0"
          value={draft.minDuration}
          onChange={(e) => update('minDuration', e.target.value)}
          disabled={loading}
        />
      </div>

      <div className={s.field}>
        <label className={s.label}>Max Duration (μs)</label>
        <input
          className={s.input}
          type="number"
          min="0"
          placeholder="∞"
          value={draft.maxDuration}
          onChange={(e) => update('maxDuration', e.target.value)}
          disabled={loading}
        />
      </div>

      <div className={s.field}>
        <label className={s.label}>Limit</label>
        <input
          className={s.input}
          type="number"
          min="1"
          max="1000"
          value={draft.limit}
          onChange={(e) => update('limit', Number(e.target.value) || 20)}
          disabled={loading}
        />
      </div>

      <div className={s.actions}>
        <button type="submit" className={s.primaryBtn} disabled={loading || !draft.service}>
          {loading ? 'Searching…' : 'Find Traces'}
        </button>
      </div>
    </form>
  );
}
