// GET /api/cards?types=balance_sheet,cash_flow&from=…&to=…&asOf=…
//                 &entryId=N&focus=N
//
// Builds one card per requested type against the current head, caches it,
// and returns { head, cards: [{ type, cacheKey, cacheState, card }] }.
// When `focus=N` is set and the card type supports impact, the card is an
// impact card (before/delta/after) for entry N; trial_balance and receipt
// are built normally (they do not support impact per the base spec).
//
// Events: card.hit / card.miss / card.built emitted per card; impact.computed
// once if any impact card was built. All events go to the sequencer log and
// to any SSE subscribers.
import { jsonResponse, jsonError } from '../errors.mjs';
import { CardStore } from '../../store/cardStore.mjs';
import { buildCard } from '../../core/cards/index.mjs';
import { computeImpact } from '../../core/impact.mjs';
import { build as buildBalanceSheet } from '../../core/cards/balanceSheet.mjs';
import { build as buildIncomeStatement } from '../../core/cards/incomeStatement.mjs';
import { build as buildCashFlow } from '../../core/cards/cashFlow.mjs';

const KNOWN_TYPES = new Set([
  'trial_balance', 'balance_sheet', 'income_statement', 'cash_flow', 'receipt',
]);

const IMPACT_BUILDERS = {
  balance_sheet: buildBalanceSheet,
  income_statement: buildIncomeStatement,
  cash_flow: buildCashFlow,
};

export function cards(req, res, ctx) {
  const q = req.query;
  const types = (q.types || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (types.length === 0) {
    return jsonError(res, 400, 'BAD_QUERY', 'types is required');
  }
  if (types.length > 4) {
    return jsonError(res, 400, 'BAD_QUERY', 'at most 4 card types per request');
  }
  for (const t of types) {
    if (!KNOWN_TYPES.has(t)) {
      return jsonError(res, 400, 'BAD_QUERY', `unknown card type: ${t}`);
    }
  }

  const params = {};
  if (q.from !== undefined) params.from = q.from;
  if (q.to !== undefined) params.to = q.to;
  if (q.asOf !== undefined) params.asOf = q.asOf;
  if (q.entryId !== undefined) {
    const n = Number(q.entryId);
    if (!Number.isSafeInteger(n) || n < 1) {
      return jsonError(res, 400, 'BAD_QUERY', 'entryId must be a positive integer');
    }
    params.entryId = n;
  }
  const focus = q.focus !== undefined ? Number(q.focus) : null;
  if (q.focus !== undefined && (!Number.isSafeInteger(focus) || focus < 1)) {
    return jsonError(res, 400, 'BAD_QUERY', 'focus must be a positive integer seq');
  }
  const period = { ...(params.from !== undefined ? { from: params.from } : {}),
                   ...(params.to !== undefined ? { to: params.to } : {}),
                   ...(params.asOf !== undefined ? { asOf: params.asOf } : {}) };

  const view = ctx.ledger.view();
  const head = ctx.ledger.head();
  const results = [];
  let impactBuilt = false;

  for (const type of types) {
    const cardParams = { ...params };
    // A receipt always needs its own entry id. If the caller did not supply
    // one and did supply a focus, use the focus (a "receipt 3" card for the
    // entry being impacted). This is the only place a receipt auto-fills.
    if (type === 'receipt' && cardParams.entryId === undefined && focus !== null) {
      cardParams.entryId = focus;
    }
    const cacheKey = CardStore.cacheKey({ type, params: cardParams, period, head });
    const cached = ctx.cards.get(cacheKey);
    if (cached) {
      ctx.emit({ type: 'card.hit', source: 'server', ref: { cardKey: cacheKey } });
      results.push({ type, cacheKey, cacheState: 'hit', card: cached });
      continue;
    }
    ctx.emit({ type: 'card.miss', source: 'server', ref: { cardKey: cacheKey } });
    let card;
    try {
      if (focus !== null && IMPACT_BUILDERS[type]) {
        card = computeImpact(IMPACT_BUILDERS[type], view, cardParams, focus);
        impactBuilt = true;
      } else {
        card = buildCard(type, view, cardParams);
      }
    } catch (e) {
      return jsonError(res, 400, 'CARD_BUILD_FAILED', `${type}: ${e.message}`);
    }
    ctx.cards.set(cacheKey, card);
    ctx.emit({ type: 'card.built', source: 'server', ref: { cardKey: cacheKey }, tags: [type] });
    results.push({ type, cacheKey, cacheState: 'miss', card });
  }

  if (impactBuilt) {
    ctx.emit({ type: 'impact.computed', source: 'server', ref: { seq: focus } });
  }
  jsonResponse(res, 200, { head, cards: results });
}
