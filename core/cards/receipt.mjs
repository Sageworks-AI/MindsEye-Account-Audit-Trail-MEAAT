import { makeCheck } from '../checks.mjs';
import { finalize } from './_shared.mjs';

// One journal entry rendered as a slip. Uses `entryId` (which is either the
// integer seq or the full entry id) so the card can be opened from either a
// drill-down click or a reference in a document.
export function build(view, period) {
  let seq;
  if (Number.isSafeInteger(period.entryId)) seq = period.entryId;
  else if (Number.isSafeInteger(period.seq)) seq = period.seq;
  else if (typeof period.entryId === 'string' || typeof period.id === 'string') {
    const id = period.entryId || period.id;
    const entry = view.byId(id);
    seq = entry.seq;
  } else {
    throw new Error('receipt needs entryId (seq or id string)');
  }
  const entry = view.getEntry(seq);

  const rows = entry.lines.map((line, i) => {
    const acct = view.accounts.byCode[line.account];
    return Object.freeze({
      id: `line_${i}`,
      code: line.account,
      label: acct.name,
      debit: line.debit,
      credit: line.credit,
      refs: Object.freeze({
        entries: Object.freeze([entry.seq]),
        accounts: Object.freeze([line.account]),
      }),
    });
  });
  let dTotal = 0;
  let cTotal = 0;
  for (const l of entry.lines) { dTotal += l.debit; cTotal += l.credit; }

  return finalize({
    kind: 'state_card',
    version: 2,
    type: 'receipt',
    title: `Receipt #${entry.seq}`,
    period: { entryId: entry.seq },
    headSeq: view.head().seq,
    currency: { ...view.currency },
    columns: [
      { key: 'code',   label: 'Code',    align: 'left',  format: 'text' },
      { key: 'label',  label: 'Account', align: 'left',  format: 'text' },
      { key: 'debit',  label: 'Debit',   align: 'right', format: 'money' },
      { key: 'credit', label: 'Credit',  align: 'right', format: 'money' },
    ],
    sections: [{
      id: 'lines',
      label: `Entry ${entry.seq} — ${entry.date}`,
      rows,
      total: { debit: dTotal, credit: cTotal },
    }],
    checks: [
      makeCheck('receipt: debits = credits', dTotal === cTotal, `${dTotal} vs ${cTotal}`),
    ],
    meta: {
      seq: entry.seq,
      id: entry.id,
      date: entry.date,
      memo: entry.memo
