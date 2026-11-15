// Replays a committed choreography. Choreographies are produced by
// `conductor/` (S9) and shipped under `conductor/out/choreography/Wn.json`;
// each step is { event, code, ring, levels, frame }. This component does
// not interpret them; it dispatches the events through the same
// `onEvent(event)` callback that user interactions use. That way the
// replayed movement and the live movement are indistinguishable.
//
// `onEvent` is called for each step, in order, with a delay equal to the
// duration tokens from `choreography.timing`. Reduced motion (via
// `window.matchMedia('(prefers-reduced-motion: reduce)').matches`) collapses
// every delay to 0 so replay is instant for users who prefer it.
//
// Playback is cancellable: changing `choreography` or unmounting stops the
// pending timer. No animation frames, no libraries.
import { useEffect, useRef, useState } from 'react';

function durationFor(step, timing) {
  const t = step.event.type;
  if (t === 'INPUT_BEGIN') return timing.inputBeginMs;
  if (t === 'INPUT_END') return timing.inputEndMs;
  if (t === 'TRANSFER_COPY' || t === 'TRANSFER_PASTE' || t === 'TRANSFER_CANCEL') {
    return timing.transferMs;
  }
  return timing.focusMs;
}

export function ChoreoPlayer({ choreography, onEvent, autoPlay = false }) {
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(autoPlay);
  const timerRef = useRef(null);

  useEffect(() => {
    setIndex(0);
    setPlaying(autoPlay);
  }, [choreography, autoPlay]);

  useEffect(() => {
    if (!playing || !choreography) return undefined;
    if (index >= choreography.steps.length) { setPlaying(false); return undefined; }
    const step = choreography.steps[index];
    const reduced = typeof window !== 'undefined' &&
      window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const duration = reduced ? 0 : durationFor(step, choreography.timing);
    timerRef.current = setTimeout(() => {
      onEvent(step.event);
      setIndex((i) => i + 1);
    }, duration);
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [playing, index, choreography, onEvent]);

  if (!choreography) return null;

  return (
    <div className="choreo-player" role="group" aria-label="Choreography player">
      <button type="button" onClick={() => setPlaying((p) => !p)}>
        {playing ? 'Pause' : 'Play'}
      </button>
      <button type="button" onClick={() => { setPlaying(false); setIndex(0); }}>
        Reset
      </button>
      <span className="muted">
        step {Math.min(index, choreography.steps.length)} / {choreography.steps.length}
      </span>
    </div>
  );
}
