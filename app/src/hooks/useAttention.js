// React hook wrapping the attention state machine. Holds the current state
// in useState and applies one event at a time. The hook exposes `state`,
// `frame` (per-actor appearance summary computed from the state and the
// level table), and a `dispatch` function that returns { code, state }.
//
// A `useEffect` on every state change posts the new state's ring to the
// bridge (bridge/attention.mjs) to re-solve the layout. The bridge is pure
// and synchronous; the hook exposes the resulting `plan` so the PagesLayer
// can render it. When the plan changes, only the *rects* move; the attention
// levels are applied via data-att attributes in App.jsx (attention.css does
// the actual transitions).
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  makeState, step, frame as buildFrame, loadLevels, hashState,
} from '../../../attention/index.mjs';
import { planFromAttention } from '../../../bridge/attention.mjs';

const LEVELS = loadLevels();
const PT_PER_PX = 75n;

export function useAttention(initialActors = []) {
  const [state, setState] = useState(() => makeState({ actors: initialActors }));
  const [lastCode, setLastCode] = useState(null);
  const [lastEvent, setLastEvent] = useState(null);

  const dispatch = useCallback((event) => {
    const result = step(state, event);
    setLastCode(result.code);
    setLastEvent(event);
    if (result.code === 0 || result.code === 1 || result.code === 2 || result.code === 3) {
      setState(result.state);
    }
    return result;
  }, [state]);

  const frame = useMemo(() => buildFrame(state, LEVELS), [state]);
  const hash = useMemo(() => hashState(state), [state]);

  return { state, frame, hash, dispatch, lastCode, lastEvent };
}

// Compute the layout plan for the current state, cardMap and viewport.
// Pure. Called from PagesLayer with the current values.
export function planForAttention(state, cardMap, viewportPx) {
  const viewportCpt = {
    w: BigInt(viewportPx.w) * PT_PER_PX,
    h: BigInt(viewportPx.h) * PT_PER_PX,
  };
  return planFromAttention(state, cardMap, viewportCpt);
}
