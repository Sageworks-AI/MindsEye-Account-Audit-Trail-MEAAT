// Fetches the pre-built Sequence strip data for the current request. Same
// cancellation pattern as useCards. The strip is read-only and small; it is
// re-fetched on every workspace change because its figures depend on period
// and focus.
import { useEffect, useState } from 'react';
import { api, ApiError } from '../api.js';

export function useStrip(query, requestId) {
  const [state, setState] = useState({ strip: null, loading: true, error: null });
  useEffect(() => {
    let cancelled = false;
    setState((s) => ({ ...s, loading: true, error: null }));
    (async () => {
      try {
        const res = await api.strip(query);
        if (cancelled) return;
        setState({ strip: res.strip, loading: false, error: null });
      } catch (e) {
        if (cancelled) return;
        const message = e instanceof ApiError ? e.message : String(e);
        setState({ strip: null, loading: false, error: message });
      }
    })();
    return () => { cancelled = true; };
  }, [requestId]);
  return state;
}
