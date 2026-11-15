// The text command box. Sits above the pages (or within the InputLayer in
// Input mode). This standalone component is used directly in read/trail
// modes; the InputLayer keeps its own inline command form for Input mode
// where the layout is different. Both call the same API.
//
// Focus/blur wire to the caller's attention lifecycle (INPUT_BEGIN /
// INPUT_END). Submit produces a request; the caller is responsible for
// applying it (App.jsx calls workspace.applyRequest).
import { useRef, useState } from 'react';
import { api, ApiError } from '../api.js';

export function CommandBox({ onRequest, onBeginInput, onEndInput, context, disabled }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const inputRef = useRef(null);

  async function submit(e) {
    e.preventDefault();
    if (!text.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.command(text, context);
      if (!res.ok) { setError(res.error); return; }
      onRequest && onRequest(res.request);
      setText('');
      onEndInput && onEndInput('commit');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="command-box" onSubmit={submit}>
      <input
        ref={inputRef}
        type="text"
        value={text}
        disabled={disabled || busy}
        placeholder="open balance sheet and cash flow for 2026-01-01 to 2026-03-31"
        aria-label="Command"
        onChange={(e) => setText(e.target.value)}
        onFocus={() => onBeginInput && onBeginInput('text')}
        onBlur={() => !busy && text === '' && onEndInput && onEndInput('cancel')}
      />
      <button type="submit" disabled={disabled || busy}>
        {busy ? '…' : 'Go'}
      </button>
      {error && <span className="command-error" role="alert">{error}</span>}
    </form>
  );
}
