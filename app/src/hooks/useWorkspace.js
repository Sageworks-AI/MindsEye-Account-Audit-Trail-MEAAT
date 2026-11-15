// React hook wrapping the pure workspace state. Keeps the reducer state in
// useState, exposes dispatch-shaped helpers, and re-renders only when a
// value the renderer actually reads changes. All state transitions go
// through state/workspace.mjs so the reducer logic stays testable without
// React.
import { useCallback, useState } from 'react';
import {
  createInitialState, setPeriod, setMode, applyRequest, setFocus,
  setEntryId, setViewport, currentCardQuery, currentStripQuery,
  commandContext,
} from '../state/workspace.mjs';

export function useWorkspace({ today } = {}) {
  const [state, setState] = useState(() => createInitialState({ today }));
  const [lastError, setLastError] = useState(null);

  const run = useCallback((result) => {
    if (result.error) {
      setLastError(result.error);
      return false;
    }
    setLastError(null);
    setState(result.state);
    return true;
  }, []);

  return {
    state,
    lastError,
    clearError: useCallback(() => setLastError(null), []),

    setPeriod:  useCallback((p) => run(setPeriod(state, p)),  [state, run]),
    setMode:    useCallback((m) => run(setMode(state, m)),    [state, run]),
    applyRequest: useCallback((r) => run(applyRequest(state, r)), [state, run]),
    setFocus:   useCallback((id) => run(setFocus(state, id)), [state, run]),
    setEntryId: useCallback((id) => run(setEntryId(state, id)), [state, run]),
    setViewport: useCallback((v) => run(setViewport(state, v)), [state, run]),

    cardQuery: useCallback(() => currentCardQuery(state), [state]),
    stripQuery: useCallback(() => currentStripQuery(state), [state]),
    commandContext: useCallback(() => commandContext(state), [state]),
  };
}
