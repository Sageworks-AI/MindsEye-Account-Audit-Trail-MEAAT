// Date range scrubber. Emits onChange({ from, to }) on every valid pair.
// The parent decides whether to re-fetch immediately or debounce. In v1 the
// parent re-fetches on every keystroke-completion; React's batching handles
// the case where a user types many characters quickly.
//
// The two fields are `type="date"` and are kept as plain strings so a
// partially-typed value does not produce an invalid Date object. The parent
// (workspace.setPeriod) validates via resolve/request.mjs and reports an
// error if the pair is invalid.
import { useEffect, useState } from 'react';

export function TimeCursor({ period, onChange, mode }) {
  const [from, setFrom] = useState(period.from || '');
  const [to, setTo] = useState(period.to || '');

  useEffect(() => {
    setFrom(period.from || '');
    setTo(period.to || '');
  }, [period.from, period.to]);

  function commit(nextFrom, nextTo) {
    if (!nextFrom || !nextTo) return;
    if (nextFrom > nextTo) return;
    if (nextFrom === period.from && nextTo === period.to) return;
    onChange({ from: nextFrom, to: nextTo });
  }

  return (
    <div className="time-cursor" role="group" aria-label="Time cursor">
      <label>
        <span>From</span>
        <input type="date" value={from}
          onChange={(e) => { setFrom(e.target.value); commit(e.target.value, to); }} />
      </label>
      <span className="sep">→</span>
      <label>
        <span>To</span>
        <input type="date" value={to}
          onChange={(e) => { setTo(e.target.value); commit(from, e.target.value); }} />
      </label>
      <span className="sep">·</span>
      <span>mode: {mode}</span>
    </div>
  );
}
