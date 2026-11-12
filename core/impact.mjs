// Impact (before / delta / after) for a card and one entry. The card is built
// twice — once from the normal view and once from view.exclude(seq) — and the
// two builds are merged by section id and row id. Every row carries
// { before, after, delta, touched } so the renderer can dim untouched rows.
// Checks compare the deltas against the entry's own lines, the double-entry
// identity (sum of natural-signed deltas is zero), and the balance-sheet
// equation delta. A failure here means the card and the journal disagree.
import { shortHash } from './hash.mjs';
import { makeCheck } from './checks.mjs';

export function computeImpact(buildFn, view, period, entryId) {
  const entry = Number.isSafeInteger(entryId)
    ? view.getEntry(entryId)
    : view.byId(entryId);

  const withEntry = buildFn(view, period);
  if (withEntry.type === 'receipt' || withEntry.type === 'trial_balance') {
    throw new Error(`impact not supported for card type "${withEntry.type}"`);
  }
  const withoutEntry = buildFn(view.exclude(entry.seq), period);

  const mergedSections = [];
  for (const section of withEntry.sections) {
    const other = withoutEntry.sections.find((s) => s.id === section.id);
    const rows = [];
    let totalBefore = 0;
    let totalAfter = 0;
    for (const row of section.rows) {
      const otherRow = other ? other.rows.find((r) => r.id === row.id) : null;
      const before = otherRow ? pickAmount(otherRow) : 0;
      const after = pickAmount(row);
      const delta = after - before;
      rows.push(Object.freeze({
        ...row, before, after, delta, touched: delta !== 0,
      }));
      totalBefore += before;
      totalAfter += after;
    }
    if (other) {
      for (const r of other.rows) {
        if (section.rows.some((row) => row.id === r.id)) continue;
        const before = pickAmount(r);
        if (before === 0) continue;
        rows.push(Object.freeze({
          ...r, before, after: 0, delta: -before, touched: true,
        }));
        totalBefore += before;
      }
    }
    mergedSections.push({
      ...section,
      rows,
      total: { before: totalBefore, after: totalAfter, delta: totalAfter - totalBefore },
    });
  }

  const checks = [];
  const expected = expectedDeltas(view, entry);

  // (a) Every single-account row's delta matches the entry's natural-signed
  // effect on that account. Derived rows (no `code`) are checked separately.
  for (const section of mergedSections) {
    for (const row of section.rows) {
      if (!row.code) continue;
      if (!Object.prototype.hasOwnProperty.call(expected, row.code)) continue;
      checks.push(makeCheck(
        `impact: delta for ${row.code} matches entry effect`,
        row.delta === expected[row.code],
        `row=${row.delta} expected=${expected[row.code]}`));
    }
  }

  // (b) Balance-sheet equation in deltas.
  if (withEntry.type === 'balance_sheet') {
    const assets = mergedSections.find((s) => s.id === 'assets');
    const liab = mergedSections.find((s) => s.id === 'liabilities');
    const eq = mergedSections.find((s) => s.id === 'equity');
    if (assets && liab && eq) {
      const dA = assets.total.delta;
      const dLE = liab.total.delta + eq.total.delta;
      checks.push(makeCheck(
        'impact: balance sheet delta equation',
        dA === dLE, `Δassets=${dA} Δ(L+E)=${dLE}`));
    }
  }

  // (c) Cash-flow class deltas sum to the entry's net cash effect.
  if (withEntry.type === 'cash_flow') {
    const cashCodes = new Set(view.accounts.list.filter((a) => a.cash).map((a) => a.code));
    let cashEffect = 0;
    for (const line of entry.lines) {
      if (cashCodes.has(line.account)) cashEffect += line.debit - line.credit;
    }
    let classDeltaSum = 0;
    for (const sec of mergedSections) {
      if (sec.id.startsWith('cf_') && !['cf_change', 'cf_opening', 'cf_closing'].includes(sec.id)) {
        classDeltaSum += sec.total.delta;
      }
    }
    checks.push(makeCheck(
      'impact: cash flow class deltas sum to entry cash effect',
      classDeltaSum === cashEffect,
      `sum=${classDeltaSum} effect=${cashEffect}`));
  }

  // (d) Double-entry identity: sum of natural-signed deltas across all of the
  // entry's lines is zero.
  let naturalSum = 0;
  for (const v of Object.values(expected)) naturalSum += v;
  checks.push(makeCheck('impact: entry natural-signed effect sums to zero',
    naturalSum === 0, `sum=${naturalSum}`));

  // Outside the period: every delta must be zero.
  const outside = isEntryOutside(entry, withEntry.period);
  if (outside) {
    const allZero = mergedSections.every((s) => s.total.delta === 0);
    checks.push(makeCheck('impact: entry outside period produces zero deltas', allZero));
  }

  const ok = checks.every((c) => c.pass);
  const card = {
    ...withEntry,
    title: `${withEntry.title} (impact of entry ${entry.seq})`,
    sections: mergedSections,
    checks,
    impact: {
      entrySeq: entry.seq,
      entryId: entry.id,
      outsidePeriod: outside,
    },
  };
  const withOk = { ...card, ok };
  const hash = shortHash(withOk, 16);
  return Object.freeze({ ...withOk, hash });
}

function pickAmount(row) {
  return typeof row.amount === 'number' ? row.amount : 0;
}

function expectedDeltas(view, entry) {
  const out = Object.create(null);
  for (const line of entry.lines) {
    const acct = view.accounts.byCode[line.account];
    const natural = (acct.type === 'asset' || acct.type === 'expense')
      ? line.debit - line.credit
      : line.credit - line.debit;
    out[line.account] = (out[line.account] || 0) + natural;
  }
  return out;
}

function isEntryOutside(entry, period) {
  if (period.from && entry.date < period.from) return true;
  if (period.to   && entry.date > period.to)   return true;
  if (period.asOf) {
    if (typeof period.asOf === 'string') {
      if (entry.date > period.asOf) return true;
    } else {
      if (entry.date > period.asOf.date) return true;
      if (entry.date === period.asOf.date && entry.seq > period.asOf.seq) return true;
    }
  }
  return false;
}
