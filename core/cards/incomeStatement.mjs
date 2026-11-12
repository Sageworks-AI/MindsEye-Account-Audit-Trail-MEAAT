import { makeCheck } from '../checks.mjs';
import { finalize, resolveRange, collectEntriesByAccount } from './_shared.mjs';

// Income statement for [from, to]. Revenue and expense sections use natural
// balances in the range. The single check is deliberately non-circular:
// net profit is computed one way from range sums, and once more as the
// change in "accumulated earnings" between the two endpoints of the period.
// A bug in either path will show up as a failed check, but the two paths use
// different view methods (rangeByAccount vs balancesAt).
export function build(view, period) {
  const { fromTick, toTick } = resolveRange(period, 'income statement');
  const range = view.rangeByAccount(fromTick, toTick);
  const entries = view.entriesInRange(fromTick, toTick);
  const entriesByAccount = collectEntriesByAccount(entries);

  const revenueRows = [];
  const expenseRows = [];
  let revenueTotal = 0;
  let expenseTotal = 0;
  for (const acct of view.accounts.list) {
    if (acct.type !== 'revenue' && acct.type !== 'expense') continue;
    const b = range[acct.code] || { balance: 0, debit: 0, credit: 0 };
    const amt = b.balance || 0;
    if (amt === 0 && b.debit === 0 && b.credit === 0) continue;
    const row = Object.freeze({
      id: `acct_${acct.code}`,
      code: acct.code,
      label: acct.name,
      amount: amt,
      refs: Object.freeze({
        entries: entriesByAccount[acct.code] || Object.freeze([]),
        accounts: Object.freeze([acct.code]),
      }),
    });
    if (acct.type === 'revenue') { revenueRows.push(row); revenueTotal += amt; }
    else                         { expenseRows.push(row); expenseTotal += amt; }
  }
  const net = revenueTotal - expenseTotal;

  // Independent path: change in accumulated earnings.
  const accumStart = accumEarningsAt(view.accounts.list, view.balancesAt(fromTick));
  const accumEnd   = accumEarningsAt(view.accounts.list, view.balancesAt(toTick));
  const accumChange = accumEnd - accumStart;

  return finalize({
    kind: 'state_card',
    version: 2,
    type: 'income_statement',
    title: 'Income Statement',
    period: { from: period.from, to: period.to },
    headSeq: view.head().seq,
    currency: { ...view.currency },
    columns: [
      { key: 'label',  label: 'Account', align: 'left',  format: 'text' },
      { key: 'amount', label: 'Amount',  align: 'right', format: 'money' },
    ],
    sections: [
      { id: 'revenue',  label: 'Revenue',  rows: revenueRows, total: revenueTotal },
      { id: 'expenses', label: 'Expenses', rows: expenseRows, total: expenseTotal },
      {
        id: 'net',
        label: 'Net profit',
        rows: [Object.freeze({
          id: 'net_profit',
          label: 'Net profit',
          amount: net,
          refs: Object.freeze({ entries: Object.freeze([]), accounts: Object.freeze([]) }),
        })],
        total: net,
      },
    ],
    checks: [
      makeCheck('net profit = change in accumulated earnings', net === accumChange,
        `net=${net} accumChange=${accumChange}`),
    ],
  });
}

function accumEarningsAt(accounts, balances) {
  let revenue = 0;
  let expense = 0;
  for (const acct of accounts) {
    const b = balances[acct.code];
    if (!b) continue;
    if (acct.type === 'revenue') revenue += b.balance || 0;
    else if (acct.type === 'expense') expense += b.balance || 0;
  }
  return revenue - expense;
}
