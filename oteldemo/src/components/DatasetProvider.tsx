/**
 * Loads the saved dataset preference from the pack-scoped KV store on
 * mount and pushes it into the current-dataset module. Children are
 * rendered immediately (with the default "otel") so there's no loading
 * gate on first paint — if the KV read succeeds later, the
 * subscribe-notify pattern will trigger re-fetches in any mounted pages.
 */
import { useEffect, type ReactNode } from 'react';
import { loadAppSettings } from '../api/appSettings';
import { setCurrentDataset } from '../api/dataset';

interface Props {
  children: ReactNode;
}

export default function DatasetProvider({ children }: Props) {
  useEffect(() => {
    let cancelled = false;
    loadAppSettings()
      .then((settings) => {
        if (cancelled) return;
        const ds = settings && typeof settings === 'object' ? settings.dataset : null;
        if (ds && typeof ds === 'string' && ds.trim()) {
          setCurrentDataset(ds.trim());
        }
      })
      .catch(() => {
        // KV unreachable or empty — leave the default dataset in place.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return <>{children}</>;
}
