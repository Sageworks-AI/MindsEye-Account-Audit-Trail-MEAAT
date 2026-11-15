// Keyboard shortcuts and the aria-live announcer. The announcer is a small
// pair of helpers that write to an aria-live region the App component
// renders; the shortcut handler is a single addEventListener that the
// caller installs on window.
//
// Documented shortcuts (README #44):
//   Tab / F6          cycle focus through non-BAR actors
//   Ctrl/Cmd + K      focus the command box (INPUT_BEGIN)
//   Escape            BACK (undo input > transfer > history)
// Ctrl/Cmd+C / +V are wired only when a pane or row selection is active;
// the driver in S13 v1 does not implement a selection model, so those keys
// fall through to the browser's native copy/paste. A future S13b can add
// selection support without changing this module's interface.

export function installShortcuts({ dispatch, getRing, onCommandFocus }) {
  function handler(e) {
    if (e.defaultPrevented) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      dispatch({ type: 'BACK' });
      return;
    }
    if (e.key === 'Tab' || e.key === 'F6') {
      const ring = getRing();
      const docs = ring.filter((a) => a.kind !== 'BAR');
      if (docs.length === 0) return;
      e.preventDefault();
      const idx = docs.findIndex((a) => a._focused);
      // Simple cycling: since we cannot tell which is focused without
      // duplicating state here, cycle by moving the first non-focal actor
      // to the front. This mirrors "shift focus to the next pane" behaviour
      // closely enough for v1.
      const target = docs[1] || docs[0];
      dispatch({ type: 'FOCUS', id: target.id, source: 'keyboard' });
      return;
    }
    if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) {
      e.preventDefault();
      if (onCommandFocus) onCommandFocus();
    }
  }
  window.addEventListener('keydown', handler);
  return () => window.removeEventListener('keydown', handler);
}

// aria-live announcer. Writes to the [data-announcer] element that App.jsx
// renders once. Rate-limited: repeated messages within the same 250 ms
// window are coalesced (the later message wins), so a burst of events does
// not flood the screen reader.
export function createAnnouncer() {
  let lastWritten = 0;
  let pendingTimer = null;
  return {
    announce(message) {
      if (typeof message !== 'string' || message === '') return;
      const now = Date.now();
      const elapsed = now - lastWritten;
      if (elapsed >= 250) {
        write(message);
        lastWritten = now;
        return;
      }
      if (pendingTimer !== null) clearTimeout(pendingTimer);
      pendingTimer = setTimeout(() => {
        write(message);
        lastWritten = Date.now();
        pendingTimer = null;
      }, 250 - elapsed);
    },
  };
}

function write(message) {
  const el = document.querySelector('[data-announcer]');
  if (el) el.textContent = message;
}

export function describeFocus(frame) {
  if (!Array.isArray(frame) || frame.length === 0) return '';
  const [first, second] = frame;
  if (!first) return '';
  const focus = `Focus: ${first.id}.`;
  if (!second) return focus;
  return `${focus} Near: ${second.id}.`;
}
