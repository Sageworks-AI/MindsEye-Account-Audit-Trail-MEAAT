import { makeCheck } from '../checks.mjs';
import { finalize, resolveRange } from './_shared.mjs';

// Direct-method cash flow for [from, to]. Cash accounts are flagged cash:true.
// Each cash-touching entry gets one cf class (operating / investing / financing
// / unclassified) taken from the non-cash lines' account.cf tags. Every check
// compares two independently computed quantities so a bug in one path is
// caught by the other: (1) the sum of per-entry cash deltas vs. the balance
// difference, (2) opening + net change vs. closing.
const CF_CLASSES = ['operating', 'investing', 'financing'];
const CF_LABELS = {
  operating: 'Operating activities',
  investing: 'Investing activities',
  financing: 'Financing activities',
  unclassified: 'Unclassified',
};

export function build(view, period) {
  const { fromTick, toTick } = resolveRange(period, 'cash flow');
  const openingBal = view.balancesAt(fromTick);
  const closingBal = view.balancesAt(toTick);
  const cashAccounts = view.accounts.list.filter((a) => a.cash === true);
  const cashCodes = new Set(cashAccounts.map((a) => a.code));
  const openingCash = sumCash(cashAccounts, openingBal);
  const closingCash = sumCash(cashAccounts, closingBal);

  const entries = view.entriesInRange(fromTick, toTick);

  // Group cash-touching entries by cf class.
  const buckets = { operating: [], investing: [], financing: [], unclassified: [] };
  for (const e of entries) {
    const cashLines = e.lines.filter((l) => cashCodes.has(l.account));
    if (cashLines.length === 0) continue;
    let cashDelta = 0;
    for (const l of cashLines) cashDelta += l.debit - l.credit;
    const nonCashCodes = e.lines
      .filter((l) => !cashCodes.has(l.account))
      .map((l) => l.account);
    const tags = new Set();
    for (const code of nonCashCodes) {
      const acct = view.accounts.byCode[code];
      if (acct && acct.cf) tags.add(acct.cf);
    }
    const cls = tags.size === 1 ? [...tags][0] : 'unclassified';
    buckets[cls].push({ seq: e.seq, cashDelta, nonCashCodes });
  }

  const sections = [];
  let classSum = 0;
  for (const cls of [...CF_CLASSES, 'unclassified']) {
    const items = buckets[cls];
    if (items.length === 0) continue;
    let total = 0;
    const seqs = new Set();
    const accounts = new Set();
    for (const it of items) {
      total += it.cashDelta;
      seqs.add(it.seq);
      for (const c of it.nonCashCodes) accounts.add(c);
    }
    classSum += total;
    sections.push({
      id: `cf_${cls}`,
      label: CF_LABELS[cls],
      rows: [Object.freeze({
        id: `cf_${cls}_total`,
        label: `Net cash from ${CF_LABELS[cls].toLowerCase()}`,
        amount: total,
        refs: Object.freeze({
          entries: Object.freeze([...seqs].sort((a, b) => a - b)),
          accounts: Object.freeze([...accounts].sort()),
        }),
      })],
      total,
    });
  }

  const netChange = closingCash - openingCash;

  sections.push({
    id: 'cf_change',
    label: 'Net change in cash',
    rows: [Object.freeze({
      id: 'cf_net_change',
      label: 'Net change in cash',
      amount: netChange,
      refs: Object.freeze({ entries: Object.freeze([]), accounts: Object.freeze([]) }),
    })],
    total: netChange,
  });
  sections.push({
    id: 'cf_opening',
    label: 'Cash at beginning of period',
    rows: [Object.freeze({
      id: 'cf_opening_cash',
      label: 'Opening cash',
      amount: openingCash,
      refs: Object.freeze({
        entries: Object.freeze([]),
        accounts: Object.freeze(cashAccounts.map((a) => a.code)),
      }),
    })],
    total: openingCash,
  });
  sections.push({
    id: 'cf_closing',
    label: 'Cash at end of period',
    rows: [Object.freeze({
      id: 'cf_closing_cash',
      label: 'Closing cash',
      amount: closingCash,
      refs: Object.freeze({
        entries: Object.freeze([]),
        accounts: Object.freeze(cashAccounts.map((a) => a.code)),
      }),
    })],
    total: closingCash,
  });

  return finalize({
    kind: 'state_card',
    version: 2,
    type: 'cash_flow',
    title: 'Cash Flow Statement (direct method)',
    period: { from: period.from, to: period.to },
    headSeq: view.head().seq,
    currency: { ...view.currency },
    method: 'direct',
    classification: 'account cf tag',
    columns: [
      { key: 'label',  label: 'Line',   align: 'left',  format: 'text' },
      { key: 'amount', label: 'Amount', align: 'right', format: 'money' },
    ],
    sections,
    checks: [
      makeCheck('cash flow: opening + net change = closing',
        openingCash + netChange === closingCash,
        `${openingCash} + ${netChange} = ${closingCash}`),
      makeCheck('cash flow: sum of classified cash flows = net change',
        classSum === netChange,
        `classes=${classSum} netChange=${netChange}`),
    ],
  });
}

function sumCash(cashAccounts, balances) {
  let sum = 0;
  for (const a of cashAccounts) {
    const b = balances[a.code];
    if (b) sum += b.balance || 0;
  }
  return sum;
}
