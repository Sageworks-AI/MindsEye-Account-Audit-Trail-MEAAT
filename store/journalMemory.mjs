// In-memory journal adapter for tests. Same public surface as journalFile so
// a test can substitute one for the other without changing the caller. A
// shared interface (get ledger, append, readAll, verify, close) keeps the
// persistence concern out of the Ledger itself.
import { Ledger } from '../core/ledger.mjs';
import { DEFAULT_CURRENCY } from '../core/money.mjs';

function serializeEntry(e) {
  const obj = {
    seq: e.seq, id: e.id, prevHash: e.prevHash,
    date: e.date, memo: e.memo, lines: e.lines,
  };
  if (e.reverses !== undefined) obj.reverses = e.reverses;
  if (e.refs !== undefined) obj.refs = e.refs;
  return obj;
}

export function openJournalMemory({ accounts, currency = DEFAULT_CURRENCY } = {}) {
  const ledger = new Ledger({ accounts, currency });
  const entries = [];
  let closed = false;

  return {
    get ledger() { return ledger; },
    get path() { return null; },
    append(entry) {
      if (closed) throw new Error('journal closed');
      // Reject misuse: append() is for entries produced by THIS adapter's
      // ledger; otherwise the in-memory list would silently diverge.
      const head = ledger.head();
      if (entry.id !== head.hash) {
        throw new Error('append() called with an entry that is not the current head');
      }
      entries.push(serializeEntry(entry));
    },
    readAll() { return entries.map((e) => ({ ...e, lines: e.lines.map((l) => ({ ...l })) })); },
    verify() { return ledger.verify(); },
    close() { closed = true; },
  };
}
