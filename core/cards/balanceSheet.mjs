import { makeCheck } from '../checks.mjs';
import { finalize, resolveInstantTick, collectEntriesByAccount } from './_shared.mjs';

// Balance sheet at a tick. Three sections: assets, liabilities, equity.
// Equity includes one derived row, `accumulated_earnings`, defined as
// revenue_natural - expense_natural up to the tick. That derived row is what
// makes the balance sheet balance WITHOUT any closing entries, and it is the
// same quantity the income statement reconciles against.
export function build(view, period) {
  const tick = resolveInstantTick(period, 'balance sheet');
  const balances = view.balancesAt(tick);
  const visible = view.entriesUpTo(tick);
  const entriesByAccount = collectEntriesByAccount(visible);

  const assets = [];
  const liabilities = [];
  const equityAccounts = [];
  let assetsTotal = 0;
  let liabTotal = 0;
  let equityAccountsTotal = 0;
  let revenueTotal = 0;
  let expenseTotal = 0;

  for (const acct of view.accounts.list) {
    const b = balances[acct.code] || { debit: 0, credit: 0, balance: 0 };
    const amt = b.balance || 0;
    if (acct.type === 'asset') {
      if (amt === 0 && b.debit === 0 && b.credit === 0) continue;
      assets.push(singleAccountRow(acct, amt, entriesByAccount));
      assetsTotal += amt;
    } else if (acct.type === 'liability') {
      if (amt === 0 && b.debit === 0 && b.credit === 0) continue;
      liabilities.push(singleAccountRow(acct, amt, entriesByAccount));
      liabTotal += amt;
    } else if (acct.type === 'equity') {
      if (amt === 0 && b.debit === 0 && b.credit === 0) continue;
      equityAccounts.push(singleAccountRow(acct, amt, entriesByAccount));
      equityAccountsTotal += amt;
    } else if (acct.type === 'revenue') {
      revenueTotal += amt;
    } else if (acct.type === 'expense') {
      expenseTotal += amt;
    }
  }

  const accumulated = revenueTotal - expenseTotal;

  // refs.entries for the derived row: every entry touching any revenue or
  // expense account up to the tick. This lets drill-down from the accumulated
  // row reach the same receipts that fed the income statement.
  const accumAccounts = view.accounts.list
    .filter((a) => a.type === 'revenue' || a.type === 'expense')
    .map((a) => a.code);
  const accumSeqs = new Set();
  for (const seq of visible.map((e) => e.seq)) {
    const e = visible.find((x) => x.seq === seq);
    if (e.lines.some((l) => accumAccounts.includes(l.account))) accumSeqs.add(seq);
  }
  const accumulatedRow = Object.freeze({
    id: 'accumulated_earnings',
    label: 'Accumulated earnings',
    amount: accumulated,
    refs: Object.freeze({
      entries: Object.freeze([...accumSeqs].sort((a, b) => a - b)),
      accounts: Object.freeze(accumAccounts),
    }),
  });

  const equityRows = [...equityAccounts, accumulatedRow];
  const totalEquity = equityAccountsTotal + accumulated;

  return finalize({
    kind: 'state_card',
    version: 2,
    type: 'balance_sheet',
    title: 'Balance Sheet',
    period: { asOf: tick },
    headSeq: view.head().seq,
    currency: { ...view.currency },
    columns: [
      { key: 'label',  label: 'Account', align: 'left',  format: 'text' },
      { key: 'amount', label: 'Amount',  align: 'right', format: 'money' },
    ],
    sections: [
      { id: 'assets',      label: 'Assets',      rows: assets,      total: assetsTotal },
      { id: 'liabilities', label: 'Liabilities', rows: liabilities, total: liabTotal },
      { id: 'equity',      label: 'Equity',      rows: equityRows,  total: totalEquity },
    ],
    checks: [
      makeCheck('balance sheet equation: assets = liabilities + equity',
        assetsTotal === liabTotal + totalEquity,
        `assets=${assetsTotal} L+E=${liabTotal + totalEquity}`),
    ],
  });
}

function singleAccountRow(acct, amount, entriesByAccount) {
  return Object.freeze({
    id: `acct_${acct.code}`,
    code: acct.code,
    label: acct.name,
    amount,
    refs: Object.freeze({
      entries: entriesByAccount[acct.code] || Object.freeze([]),
      accounts: Object.freeze([acct.code]),
    }),
  });
}
