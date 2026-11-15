// The floating input layer: command box, entry form (in Input mode), and
// the error line. It reserves no layout space (Law L12); it is positioned
// in a fixed overlay at the bottom of the workspace and covers the strip
// only when the user is typing.
//
// The input layer participates in the attention ring only while input is
// active (INPUT_BEGIN / INPUT_END). The parent App.jsx dispatches those
// events on focus/blur of the command box; the appearance of the input bar
// itself is set via data-att="0" only when the input state is active (see
// attention.css for the accent ring).
import { useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../api.js';

export function InputLayer({
  mode, inputActive, onBeginInput, onEndInput, onCommand, context,
}) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [draft, setDraft] = useState({
    date: '',
    memo: '',
    lines: [{ account: '', debit: '', credit: '' }, { account: '', debit: '', credit: '' }],
  });
  const inputRef = useRef(null);

  useEffect(() => {
    if (inputActive && inputRef.current) inputRef.current.focus();
  }, [inputActive]);

  async function submitCommand(e) {
    e.preventDefault();
    if (!text.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.command(text, context);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      onCommand && onCommand(res.request);
      setText('');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function submitEntry(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const lines = draft.lines
      .filter((l) => l.account && (l.debit || l.credit))
      .map((l) => {
        const d = Number(l.debit);
        const c = Number(l.credit);
        const line = { account: l.account };
        if (Number.isFinite(d) && d > 0) line.debit = d;
        if (Number.isFinite(c) && c > 0) line.credit = c;
        return line;
      });
    try {
      await api.postEntry({ date: draft.date, memo: draft.memo, lines });
      setDraft({
        date: draft.date,
        memo: '',
        lines: [{ account: '', debit: '', credit: '' }, { account: '', debit: '', credit: '' }],
      });
      onEndInput && onEndInput('commit');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="input-layer" data-input-active={inputActive ? 'true' : 'false'}>
      {error && <div className="input-error" role="alert">{error}</div>}
      {mode === 'input' ? (
        <form onSubmit={submitEntry} className="entry-form">
          <div className="entry-form-row">
            <label>Date <input type="date" value={draft.date}
              onChange={(e) => setDraft({ ...draft, date: e.target.value })} required /></label>
            <label>Memo <input type="text" value={draft.memo}
              onChange={(e) => setDraft({ ...draft, memo: e.target.value })} required /></label>
          </div>
          {draft.lines.map((line, i) => (
            <div className="entry-form-row" key={i}>
              <label>Account
                <input type="text" value={line.account} onChange={(e) => {
                  const lines = draft.lines.slice();
                  lines[i] = { ...line, account: e.target.value };
                  setDraft({ ...draft, lines });
                }} />
              </label>
              <label>Debit
                <input type="number" min="0" step="1" value={line.debit} onChange={(e) => {
                  const lines = draft.lines.slice();
                  lines[i] = { ...line, debit: e.target.value, credit: '' };
                  setDraft({ ...draft, lines });
                }} />
              </label>
              <label>Credit
                <input type="number" min="0" step="1" value={line.credit} onChange={(e) => {
                  const lines = draft.lines.slice();
                  lines[i] = { ...line, credit: e.target.value, debit: '' };
                  setDraft({ ...draft, lines });
                }} />
              </label>
            </div>
          ))}
          <div className="entry-form-row entry-form-actions">
            <button type="button" onClick={() => setDraft({
              ...draft,
              lines: [...draft.lines, { account: '', debit: '', credit: '' }],
            })}>Add line</button>
            <button type="submit" disabled={busy}>{busy ? 'Posting…' : 'Post'}</button>
          </div>
        </form>
      ) : (
        <form onSubmit={submitCommand} className="command-form">
          <input
            ref={inputRef}
            type="text"
            value={text}
            placeholder="open balance sheet and cash flow for 2026-01-01 to 2026-03-31"
            onChange={(e) => setText(e.target.value)}
            onFocus={() => onBeginInput && onBeginInput('text')}
            onBlur={() => !busy && text === '' && onEndInput && onEndInput('cancel')}
            aria-label="Command"
          />
          <button type="submit" disabled={busy}>{busy ? '…' : 'Go'}</button>
        </form>
      )}
    </div>
  );
}
