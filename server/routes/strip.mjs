// GET /api/strip?mode=read&types=…&from=…&to=…&asOf=…&entryId=…
//
// Returns the pre-built strip data (moving numbers) for the current request
// parameters. The figures come from a receipt card if entryId is supplied,
// otherwise from the running balance of cash accounts up to the requested
// tick. This is the only endpoint that produces a "figures" array; the
// client's Sequence strip component renders it directly.
//
// All numbers come from card builders (rule 4): we build the cash flow card
// if a range is requested, and a receipt card if an entry is supplied, and
// read the figures from their sections.
import { jsonResponse, jsonError } from '../errors.mjs';
import { buildCard } from '../../core/cards/index.mjs';
import { buildStrip } from '../../sequencer/strip.mjs';

export function strip(req, res, ctx) {
  const q = req.query;
  const mode = q.mode || 'read';
  const types = (q.types || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (types.length === 0) {
    return jsonError(res, 400, 'BAD_QUERY', 'types is required');
  }
  const from = q.from;
  const to = q.to;
  const asOf = q.asOf;
  const entryId = q.entryId !== undefined ? Number(q.entryId) : null;
  if (q.entryId !== undefined && (!Number.isSafeInteger(entryId) || entryId < 1)) {
    return jsonError(res, 400, 'BAD_QUERY', 'entryId must be a positive integer');
  }
  const head = ctx.ledger.head();
  const view = ctx.ledger.view();
  const figures = [];

  if (entryId !== null) {
    // Running balance per affected account for the focused entry.
    let receipt;
    try {
      receipt = buildCard('receipt', view, { entryId });
    } catch (e) {
      return jsonError(res, 400, 'STRIP_FAILED', e.message);
    }
    for (const line of receipt.sections[0].rows) {
      const balance = view.balancesAt({ date: '9999-12-31', seq: Number.MAX_SAFE_INTEGER });
      const cur = balance[line.code] || { balance: 0 };
      // Opening = current balance minus the line's natural contribution;
      // change = line's natural contribution; closing = current balance.
      const natural = (line.credit || 0) - (line.debit || 0);
      const closing = cur.balance;
      const opening = closing + natural;
      figures.push({ label: line.label, opening, change: -natural, closing });
    }
  } else if (from !== undefined && to !== undefined) {
    // Cash flow figures: opening, change, closing for the range.
    let cashFlow;
    try {
      cashFlow = buildCard('cash_flow', view, { from, to });
    } catch (e) {
      return jsonError(res, 400, 'STRIP_FAILED', e.message);
    }
    const opening = cashFlow.sections.find((s) => s.id === 'cf_opening')?.total ?? 0;
    const change  = cashFlow.sections.find((s) => s.id === 'cf_change')?.total ?? 0;
    const closing = cashFlow.sections.find((s) => s.id === 'cf_closing')?.total ?? 0;
    figures.push({ label: 'Cash', opening, change, closing });
  }

  const request = {
    mode,
    cards: types.map((t) => ({ type: t })),
    period: { ...(from ? { from } : {}), ...(to ? { to } : {}), ...(asOf ? { asOf } : {}) },
    focus: entryId !== null ? { entryId } : null,
  };
  const strip = buildStrip({
    request,
    head,
    cacheStates: Object.fromEntries(types.map((t) => [t, 'unknown'])),
    figures,
  });
  jsonResponse(res, 200, { strip });
}
