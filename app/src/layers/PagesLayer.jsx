// The pages layer. Computes the layout plan for the current attention state
// and viewport, then renders one PageFrame per pane. Every frame has a
// data-att attribute set from its level in the attention frame; the
// generated attention.css turns that into a visual dim.
//
// Pointer focus is coalesced through an epoch counter (README #41): a
// pointer-sourced FOCUS is only accepted if its epoch is strictly greater
// than the last. This prevents an oscillation where a layout shift moves a
// pane under a stationary cursor and re-triggers focus forever.
import { useEffect, useMemo, useRef } from 'react';
import { planForAttention } from '../hooks/useAttention.js';
import { PageFrame } from '../components/PageFrame.jsx';

export function PagesLayer({
  attention, frame, cardMap, cards, cacheStates, viewport, onFocusActor,
}) {
  const epochRef = useRef(0);

  const plan = useMemo(() => {
    if (!attention || !attention.ring || attention.ring.length === 0) {
      return { panes: [], focalIndex: -1 };
    }
    return planForAttention(attention, cardMap, viewport);
  }, [attention, cardMap, viewport.w, viewport.h]);

  // Adjust the epoch on every plan change. A layout change that moves a
  // pane under a stationary cursor must not cause a second focus change
  // (README #41).
  useEffect(() => {
    epochRef.current += 1;
  }, [plan]);

  const handleFocus = (actorId, source) => {
    if (source === 'pointer') {
      epochRef.current += 1;
      onFocusActor(actorId, 'pointer', epochRef.current);
    } else {
      onFocusActor(actorId, source);
    }
  };

  if (plan.error) {
    return (
      <div className="pages-empty" role="status">
        <div>
          <p>Layout error: {plan.error}</p>
        </div>
      </div>
    );
  }

  if (!plan.panes || plan.panes.length === 0) {
    return (
      <div className="pages-empty" role="status">
        <div>
          <p>No cards open. Use the command box to open one, e.g.</p>
          <pre>open balance sheet for 2026-01-01 to 2026-03-31</pre>
        </div>
      </div>
    );
  }

  const levelOf = (actorId) => {
    const entry = frame.find((f) => f.id === actorId);
    return entry ? entry.level : 2;
  };
  const focalActor = plan.panes[0] ? plan.panes[0].actorId : null;

  return (
    <div className="pages-layer" role="region" aria-label="Cards">
      {plan.panes.map((pane) => {
        const card = cards[pane.card.type] || null;
        const state = cacheStates[pane.card.type] || 'unknown';
        return (
          <PageFrame
            key={pane.actorId}
            actorId={pane.actorId}
            level={levelOf(pane.actorId)}
            rect={pane.rect}
            card={card}
            tier={pane.tier}
            focused={pane.actorId === focalActor}
            onFocus={(id, src) => handleFocus(id, src)}
            error={state === 'unknown' ? null : null}
          />
        );
      })}
    </div>
  );
}
