// Deterministic command grammar. interpret(text, context) returns either
// { ok: true, request } or { ok: false, error }. The context supplies
// { period, activeYear, cards } — all optional. Every numeric literal in a
// command that names an entry is a seq, not an id; string ids come from the
// client, not from the grammar. A future LLM interpreter plugs in at the
// same interface and its output is still validated by validateRequest(), so
// it can only propose a request, never post an entry.
//
// S4-close: quarterRange comes from resolve/dates.mjs (no imports) instead
// of core/time.mjs, so command.mjs imports only the bridge schema route and
// its own siblings.
import { validateRequest } from './request.mjs';
import { quarterRange } from './dates.mjs';

const CARD_ALIASES = Object.freeze([
  { type: 'balance_sheet',    forms: ['balance sheet', 'bs'] },
  { type: 'income_statement', forms: ['income statement', 'income', 'is', 'p&l', 'profit and loss'] },
  { type: 'cash_flow',        forms: ['cash flow', 'cf', 'cashflow'] },
  { type: 'trial_balance',    forms: ['trial balance', 'tb'] },
  { type: 'receipt',          forms: ['receipt'] },
]);

function matchCardName(name) {
  const n = name.trim().toLowerCase();
  for (const a of CARD_ALIASES) if (a.forms.includes(n)) return a.type;
  return null;
}

function finish(req, { periodRequired }) {
  if (periodRequired && (!req.period || (!req.period.from && !req.period.to && !req.period.asOf))) {
    return { ok: false, error: 'no active period in context and command did not specify one' };
  }
  try {
    return { ok: true, request: validateRequest(req) };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

function stripPeriod(text) {
  const forMatch = /\s+for\s+(\d{4}-\d{2}-\d{2})\s+to\s+(\d{4}-\d{2}-\d{2})\s*$/i.exec(text);
  if (forMatch) {
    return {
      body: text.slice(0, forMatch.index).trim(),
      period: { from: forMatch[1], to: forMatch[2] },
    };
  }
  const asAtMatch = /\s+as\s+(?:at|of)\s+(\d{4}-\d{2}-\d{2})\s*$/i.exec(text);
  if (asAtMatch) {
    const d = asAtMatch[1];
    return { body: text.slice(0, asAtMatch.index).trim(), period: { asOf: d, from: d, to: d } };
  }
  return { body: text, period: null };
}

export function interpret(text, context = {}) {
  if (typeof text !== 'string') return { ok: false, error: 'command must be a string' };
  const trimmed = text.trim();
  if (!trimmed) return { ok: false, error: 'empty command' };
  const t = trimmed.toLowerCase();

  const modeMatch = /^mode\s+(read|input|trail)$/i.exec(t);
  if (modeMatch) {
    return finish({
      period: context.period || {},
      cards: context.cards || [],
      mode: modeMatch[1],
    }, { periodRequired: false });
  }

  const trailMatch = /^trail\s+from\s+(\d+)$/i.exec(t);
  if (trailMatch) {
    return finish({
      period: context.period || {},
      cards: [],
      mode: 'trail',
      trail: { from: Number(trailMatch[1]) },
    }, { periodRequired: false });
  }

  const receiptMatch = /^receipt\s+(\d+)$/i.exec(t);
  if (receiptMatch) {
    return finish({
      period: context.period || {},
      cards: [{ type: 'receipt', params: { entryId: Number(receiptMatch[1]) } }],
      mode: 'read',
    }, { periodRequired: false });
  }

  const compareMatch = /^compare\s+q([1-4])\s+(?:with|and)\s+q([1-4])$/i.exec(t);
  if (compareMatch) {
    const year = context.activeYear ||
      (context.period && context.period.from && Number(context.period.from.slice(0, 4))) ||
      null;
    if (!year) {
      return { ok: false, error: 'compare needs an active year (context.activeYear or context.period.from)' };
    }
    const q1 = Number(compareMatch[1]);
    const q2 = Number(compareMatch[2]);
    return finish({
      period: quarterRange(q1, year),
      compare: quarterRange(q2, year),
      cards: context.cards || [],
      mode: 'read',
    }, { periodRequired: false });
  }

  const { body: stripped, period: periodFromCmd } = stripPeriod(trimmed);
  const body = stripped.toLowerCase();

  const impactMatch = /^show\s+impact\s+of\s+(\d+)\s+on\s+(.+)$/i.exec(body);
  if (impactMatch) {
    const cardType = matchCardName(impactMatch[2]);
    if (!cardType) return { ok: false, error: `unknown card: "${impactMatch[2]}"` };
    return finish({
      period: periodFromCmd || context.period || {},
      cards: [{ type: cardType, params: {} }],
      focus: { entryId: Number(impactMatch[1]) },
      mode: 'read',
    }, { periodRequired: true });
  }

  let cardsPart = body;
  if (cardsPart.startsWith('open ')) cardsPart = cardsPart.slice(5).trim();
  if (!cardsPart) return { ok: false, error: 'no card named in command' };

  const segments = cardsPart.split(/\s+and\s+|,\s*|;\s*/).map((s) => s.trim()).filter(Boolean);
  const cards = [];
  for (const seg of segments) {
    const rMatch = /^receipt\s+(\d+)$/.exec(seg);
    if (rMatch) {
      cards.push({ type: 'receipt', params: { entryId: Number(rMatch[1]) } });
      continue;
    }
    const type = matchCardName(seg);
    if (!type) return { ok: false, error: `unknown card: "${seg}"` };
    cards.push({ type, params: {} });
  }

  const periodRequired = cards.some((c) => c.type !== 'receipt');
  return finish({
    period: periodFromCmd || context.period || {},
    cards,
    mode: 'read',
  }, { periodRequired });
}
