// React hook that fetches cards for the current request, keyed on the
// request id (which changes on every workspace transition that should
// trigger a re-fetch). Returns { cards, cacheStates, loading, error, head }.
//
// Cards come from GET /api/cards, which returns { head, cards: [{type,
// cacheKey, cacheState, card}] }. This hook keys the returned cards by
// type so the pages layer can render actor.id -> card without re-scanning
// an array on every render.
//
// Deliberately does not poll the head: the caller (App.jsx) re-runs this
// effect when the workspace state changes, which is the only trigger that
// matters. A background poll is a future feature.
import { useEffect, useState } from 'react';
import { api, ApiError } from '../api.js';

export function useCards(query, requestId) {
  const [state, setState] = useState({
    head: null,
    cards: {},
    cacheStates: {},
    loading: true,
    error: null,
    query: null,
  });

  useEffect(() => {
    let cancelled = false;
    setState((s) => ({ ...s, loading: true, error: null, query }));
    (async () => {
      try {
        const res = await api.cards(query);
        if (cancelled) return;
        const cards = {};
        const cacheStates = {};
        for (const entry of res.cards) {
          cards[entry.type] = entry.card;
          cacheStates[entry.type] = entry.cacheState;
        }
        setState({ head: res.head, cards, cacheStates, loading: false, error: null, query });
      } catch (e) {
        if (cancelled) return;
        const message = e instanceof ApiError ? e.message : String(e);
        setState((s) => ({ ...s, loading: false, error: message, query }));
      }
    })();
    return () => { cancelled = true; };
  }, [requestId]);

  return state;
}
