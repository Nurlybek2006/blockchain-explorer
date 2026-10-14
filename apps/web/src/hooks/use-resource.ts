'use client';
import { useCallback, useEffect, useState } from 'react';
import { ApiError } from '@/lib/api/client';

export function useResource<T>(load: (signal: AbortSignal) => Promise<T>, options: { enabled?: boolean; pollInterval?: number } = {}) {
  const { enabled = true, pollInterval = 0 } = options;
  const [state, setState] = useState<{ data: T | null; error: ApiError | null; loading: boolean; loader: typeof load }>({ data: null, error: null, loading: enabled, loader: load });
  const [generation, setGeneration] = useState(0);
  const reload = useCallback(() => setGeneration(value => value + 1), []);
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController(); let timer: ReturnType<typeof setTimeout> | undefined;
    const run = async () => {
      setState(previous => ({ data: previous.loader === load ? previous.data : null, loader: load, loading: previous.loader !== load || previous.data === null, error: null }));
      try { const data = await load(controller.signal); if (!controller.signal.aborted) setState({ data, error: null, loading: false, loader: load }); }
      catch (error) { if (!controller.signal.aborted) setState(previous => ({ ...previous, error: error instanceof ApiError ? error : new ApiError(0, 'unknown', 'The request could not be completed.'), loading: false })); }
      finally { schedule(); }
    };
    const schedule = () => { if (pollInterval > 0 && !controller.signal.aborted) timer = setTimeout(() => { if (document.visibilityState === 'visible') void run(); else schedule(); }, pollInterval); };
    void run(); return () => { controller.abort(); clearTimeout(timer); };
  }, [load, enabled, pollInterval, generation]);
  return { ...(state.loader === load ? state : { data: null, error: null, loading: enabled }), reload };
}
