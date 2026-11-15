// The application shell. Composes the workspace, the input layer, the
// attention driver, and the API hooks. This is the only file that
// orchestrates side effects; everything below it is pure or a small hook.
//
// Behaviour summary:
//   - The workspace state drives what to fetch (cards, strip).
//   - Card map changes are synced to the attention ring via OPEN/CLOSE
//     (dispatchAll). This is the only place that creates ring actors.
//   - Clicking a page focuses its actor (pointer FOCUS with an epoch).
//   - Command box submit sets the workspace request.
//   - Escape/Backspace-driven undo goes through BACK.
//   - Focus changes are announced via aria-live.
//
// Known limitations (README #79): no selection model, no trail builder UI,
// no pointer dwell (v1 uses click-to-focus only).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useWorkspace } from './hooks/useWorkspace.js';
import { useCards } from './hooks/useCards.js';
import { useStrip } from './hooks/useStrip.js';
import { useAttention } from './hooks/useAttention.js';
import { Workspace } from './components/Workspace.jsx';
import { CommandBox } from './components/CommandBox.jsx';
import { InputLayer } from './layers/InputLayer.jsx';
import { installShortcuts, createAnnouncer, describeFocus } from './attention/keyboard.mjs';
import { openEvent, closeEvent } from './attention/driver.mjs';
import { api } from './api.js';

export default function App() {
  const workspace = useWorkspace();
  const cards = useCards(workspace.cardQuery(), workspace.state.requestId);
  const strip = useStrip(workspace.stripQuery(), workspace.state.requestId);
  const attention = useAttention();
  const announcer = useMemo(() => createAnnouncer(), []);
  const pointerEpochRef = useRef(0);

  // Sync attention ring with cardMap: OPEN new actors, CLOSE removed ones.
  // dispatchAll makes the whole diff atomic (one React render).
  useEffect(() => {
    const desired = Object.keys(workspace.state.cardMap);
    const current = attention.state.ring.filter((a) => a.kind !== 'BAR').map((a) => a.id);
    const events = [];
    for (const id of current) if (!desired.includes(id)) events.push(closeEvent({ id }));
    for (const id of desired) if (!current.includes(id)) events.push(openEvent({ id, kind: 'DOC' }));
    if (events.length > 0) attention.dispatchAll(events);
  }, [workspace.state.cardMap, attention.state.ring.length]);

  // Announce focus changes.
  useEffect(() => {
    if (attention.frame.length > 0) {
      announcer.announce(describeFocus(attention.frame));
    }
  }, [attention.frame, announcer]);

  // Install keyboard shortcuts.
  useEffect(() => {
    const getRing = () => attention.state.ring;
    const onCommandFocus = () => {
      const el = document.querySelector('.command-box input');
      if (el) el.focus();
    };
    const uninstall = installShortcuts({
      dispatch: attention.dispatch,
      getRing,
      onCommandFocus,
    });
    return uninstall;
  }, [attention.dispatch, attention.state.ring]);

  const onFocusActor = useCallback((actorId, source, epoch) => {
    if (source === 'pointer') {
      pointerEpochRef.current = epoch;
      attention.dispatch({
        type: 'FOCUS', id: actorId, source: 'pointer', pointerEpoch: pointerEpochRef.current,
      });
    } else {
      attention.dispatch({ type: 'FOCUS', id: actorId, source });
    }
  }, [attention.dispatch]);

  const onBeginInput = useCallback((channel = 'text') => {
    attention.dispatch({ type: 'INPUT_BEGIN', channel });
  }, [attention.dispatch]);

  const onEndInput = useCallback((outcome) => {
    attention.dispatch({ type: 'INPUT_END', outcome });
  }, [attention.dispatch]);

  const onRequest = useCallback((request) => {
    workspace.applyRequest(request);
  }, [workspace]);

  const onPeriodChange = useCallback((period) => {
    workspace.setPeriod(period);
  }, [workspace]);

  const onModeChange = useCallback((mode) => {
    workspace.setMode(mode);
  }, [workspace]);

  const trailTarget = useMemo(() => {
    if (workspace.state.mode !== 'trail') return null;
    const entryId = workspace.state.entryId || (workspace.state.focus && workspace.state.focus.entryId) || null;
    return { trailId: null, entryId };
  }, [workspace.state.mode, workspace.state.entryId, workspace.state.focus]);

  return (
    <div className="app">
      <header className="app-header">
        <h1>MEAAT</h1>
        <div role="group" aria-label="Mode">
          <button type="button"
            aria-pressed={workspace.state.mode === 'read'}
            onClick={() => onModeChange('read')}>Read</button>
          <button type="button"
            aria-pressed={workspace.state.mode === 'input'}
            onClick={() => onModeChange('input')}>Input</button>
          <button type="button"
            aria-pressed={workspace.state.mode === 'trail'}
            onClick={() => onModeChange('trail')}>Trail</button>
        </div>
        <CommandBox
          onRequest={onRequest}
          onBeginInput={onBeginInput}
          onEndInput={onEndInput}
          context={workspace.commandContext()}
          disabled={workspace.state.mode === 'input'}
        />
        <div className="head-info">
          {cards.head
            ? <>head {cards.head.seq} <span className="ok">·</span> {cards.head.hash.slice(0, 8)}…</>
            : 'connecting…'}
          {cards.error && <span className="fail" title={cards.error}>· offline</span>}
        </div>
      </header>

      <div className="app-main">
        <Workspace
          mode={workspace.state.mode}
          period={workspace.state.period}
          onPeriodChange={onPeriodChange}
          attention={attention.state}
          frame={attention.frame}
          cardMap={workspace.state.cardMap}
          cards={cards.cards}
          cacheStates={cards.cacheStates}
          viewport={workspace.state.viewport}
          onFocusActor={onFocusActor}
          strip={strip.strip}
          stripError={strip.error}
          trailId={trailTarget ? trailTarget.trailId : null}
          entryId={trailTarget ? trailTarget.entryId : null}
        />
        {workspace.state.mode === 'input' && (
          <InputLayer
            mode={workspace.state.mode}
            inputActive={false}
            onBeginInput={onBeginInput}
            onEndInput={(outcome) => {
              onEndInput(outcome);
              if (outcome === 'commit') {
                // Re-fetch after posting.
                workspace.setViewport({ ...workspace.state.viewport });
              }
            }}
            onCommand={onRequest}
            context={workspace.commandContext()}
          />
        )}
      </div>

      <div data-announcer="" aria-live="polite" aria-atomic="true"
           className="sr-only" />
      {workspace.lastError && (
        <div className="page-error" role="alert"
             style={{ position: 'fixed', bottom: 8, right: 8, zIndex: 10 }}>
          {workspace.lastError}
        </div>
      )}
    </div>
  );
}
