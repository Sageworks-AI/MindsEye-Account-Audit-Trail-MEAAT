import { makeCheck } from '../checks.mjs';
import { finalize, resolveInstantTick, collectEntriesByAccount } from './_shared.mjs';

// Trial balance at a tick: every account with a nonzero debit or credit total,
// shown gross (not netted). This is the classic trial balance — its only job
// is to prove debits equal credits at the statement level.
export function build(view, period) {
  const tick = resolveInstantTick(period, 'trial balance');
  const balances = view.balancesAt(tick);
  const entriesByAccount = collectEntriesByAccount(view.entriesUpTo(tick));

  const rows = [];
  let totalDebit = 0;
  let totalCredit = 0;
  for (const acct of view.accounts.list) {
    const b = balances[acct.code] || { debit: 0, credit: 0 };
    if (b.debit === 0 && b.credit === 0) continue;
    rows.push(Object.freeze({
      id: `acct_${acct.code}`,
      code: acct.code,
      label: acct.name,
      debit: b.debit,
      credit: b.credit,
      refs: Object.freeze({
        entries: entriesByAccount[acct.code] || Object.freeze([]),
        accounts: Object.freeze([acct.code]),
      }),
    }));
    totalDebit += b.debit;
    totalCredit += b.credit;
  }

  return finalize({
    kind: 'state_card',
    version: 2,
    type: 'trial_balance',
    title: 'Trial Balance',
    period: { asOf: tick },
    headSeq: view.head().seq,
    currency: { ...view.currency },
    columns: [
      { key: 'code',   label: 'Code',    align: 'left',  format: 'text' },
      { key: 'label',  label: 'Account', align: 'left',  format: 'text' },
      { key: 'debit',  label: 'Debit',   align: 'right', format: 'money' },
      { key: 'credit', label: 'Credit',  align: 'right', format: 'money' },
    ],
    sections: [{
      id: 'accounts',
      label: 'Accounts',
      rows,
      total: { debit: totalDebit, credit: totalCredit },
    }],
    checks: [
      makeCheck('trial balance debits = credits', totalDebit === totalCredit,
        `debits=${totalDebit} credits=${totalCredit}`),
    ],
  });
}
