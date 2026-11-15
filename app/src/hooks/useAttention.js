// React hook wrapping the attention state machine. Uses the browser-safe
// duplicate in app/src/attention/machine-browser.mjs (README #78): the
// canonical attention/js/machine.mjs imports `node:crypto` at module load,
// which the browser has no equivalent for.
//
// Two dispatch entry points:
//   - `dispatch(event)`: apply one event, using functional state update so
//     event handlers (clicks, keyboard) cannot see a stale state.
//   - `dispatchAll(events)`: apply a batch atomically inside a single
//     setState, so an effect that needs to OPEN/CLOSE several actors does
//     not lose intermediate updates to React's batching. `lastCode` reflects
//     the code of the *last* event in the batch.
//
// `frame` is derived on every state change from the bundled levels table.
// `planForAttention` is exposed as a helper so the PagesLayer can compute a
// layout plan; it is pure and does not touch the DOM.
import { useCallback, useMemo, useState } from 'react';
import {
  makeState, step, frame as buildFrame,
} from '../attention/machine-browser.mjs';
import { LEVELS } from '../attention/levels.mjs';
import { planFromAttention } from '../../../bridge/attention.mjs';

const PT_PER_PX = 75n;

export function useAttention(initialActors = []) {
  const [state, setState] = useState(() => makeState({ actors: initialActors }));
  const [lastCode, setLastCode] = useState(null);

  const dispatch = useCallback((event) => {
    setState((prev) => {
      const result = step(prev, event);
      setLastCode(result.code);
      // OK, NOOP, POINTER_STALE, ALREADY_FOCUSED all keep the returned
      // state (which may equal the input state). Error codes also keep it.
      if (result.code === 0 || result.code === 1 || result.code === 2 || result.code === 3) {
        return result.state;
      }
      return prev;
    });
  }, []);

  const dispatchAll = useCallback((events) => {
    setState((prev) => {
      let s = prev;
      let last = null;
      for (const event of events) {
        const result = step(s, event);
        last = result.code;
        if (result.code === 0 || result.code === 1 ||
            result.code === 2 || result.code === 3) {
          s = result.state;
        }
      }
      if (last !== null) setLastCode(last);
      return s;
    });
  }, []);

  const frame = useMemo(() => buildFrame(state, LEVELS), [state]);

  return { state, frame, dispatch, dispatchAll, lastCode };
}

export function planForAttention(state, cardMap, viewportPx) {
  const viewportCpt = {
    w: BigInt(viewportPx.w) * PT_PER_PX,
    h: BigInt(viewportPx.h) * PT_PER_PX,
  };
  return planFromAttention(state, cardMap, viewportCpt);
}
