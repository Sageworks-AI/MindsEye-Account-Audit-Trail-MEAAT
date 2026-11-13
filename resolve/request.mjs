// Request schema and validation. Shape-only; semantic checks (does this card
// type need from/to) live in the card builders, so a shape-valid request can
// still fail later with a clear error from the builder rather than from here.
//
// S4-close: CARD_TYPES comes from bridge/schema.mjs (pure frozen data
// re-exported from core/schema.mjs) instead of the REGISTRY, so resolve does
// not import core/cards/index.mjs and the boundary check passes.
// isValidDate comes from resolve/dates.mjs (no imports) for the same reason.
import { CARD_TYPES } from '../bridge/schema.mjs';
import { isValidDate } from './dates.mjs';

export const MODES = Object.freeze(['read', 'input', 'trail']);
export const MAX_CARDS = 4;

function checkPeriod(period) {
  if (period.from !== undefined && !isValidDate(period.from)) {
    throw new Error(`period.from is not a real calendar date: ${period.from}`);
  }
  if (period.to !== undefined && !isValidDate(period.to)) {
    throw new Error(`period.to is not a real calendar date: ${period.to}`);
  }
  if (period.from !== undefined && period.to !== undefined && period.from > period.to) {
    throw new Error(`period.from (${period.from}) is after period.to (${period.to})`);
  }
  if (period.asOf !== undefined) {
    if (typeof period.asOf === 'string') {
      if (!isValidDate(period.asOf)) {
        throw new Error(`period.asOf is not a real calendar date: ${period.asOf}`);
      }
    } else if (period.asOf && typeof period.asOf === 'object') {
      if (!isValidDate(period.asOf.date)) {
        throw new Error(`period.asOf.date is not a real calendar date: ${period.asOf.date}`);
      }
      if (!Number.isSafeInteger(period.asOf.seq) || period.asOf.seq < 0) {
        throw new Error(`period.asOf.seq must be a non-negative safe integer`);
      }
    } else {
      throw new Error(`period.asOf must be a date string or tick { date, seq }`);
    }
  }
}

export function validateRequest(req) {
  if (!req || typeof req !== 'object' || Array.isArray(req)) {
    throw new Error('request must be a plain object');
  }
  if (!Array.isArray(req.cards)) {
    throw new Error('request.cards must be an array');
  }
  if (req.cards.length > MAX_CARDS) {
    throw new Error(`request.cards must have at most ${MAX_CARDS} entries (got ${req.cards.length})`);
  }
  const mode = req.mode === undefined ? 'read' : req.mode;
  if (!MODES.includes(mode)) {
    throw new Error(`request.mode must be one of ${MODES.join(', ')} (got "${mode}")`);
  }

  const cards = req.cards.map((c, i) => {
    if (!c || typeof c !== 'object' || Array.isArray(c)) {
      throw new Error(`request.cards[${i}] must be a plain object`);
    }
    if (typeof c.type !== 'string' || !CARD_TYPES[c.type]) {
      throw new Error(`request.cards[${i}].type is not a known card type: ${String(c.type)}`);
    }
    if (c.section !== undefined) {
      if (typeof c.section !== 'string' || !c.section) {
        throw new Error(`request.cards[${i}].section must be a non-empty string`);
      }
    }
    if (c.params !== undefined && (typeof c.params !== 'object' || Array.isArray(c.params))) {
      throw new Error(`request.cards[${i}].params must be a plain object`);
    }
    return { type: c.type, params: c.params || {}, section: c.section };
  });

  const period = req.period ? { ...req.period } : {};
  checkPeriod(period);

  const out = { cards, period, mode };
  if (req.compare !== undefined) {
    if (typeof req.compare !== 'object' || Array.isArray(req.compare)) {
      throw new Error('request.compare must be a period object');
    }
    checkPeriod(req.compare);
    out.compare = { ...req.compare };
  }
  if (req.focus !== undefined) {
    if (typeof req.focus !== 'object' || Array.isArray(req.focus)) {
      throw new Error('request.focus must be a plain object');
    }
    if (req.focus.entryId === undefined) {
      throw new Error('request.focus.entryId is required');
    }
    const id = req.focus.entryId;
    if (!Number.isSafeInteger(id) && typeof id !== 'string') {
      throw new Error('request.focus.entryId must be an integer seq or a string id');
    }
    out.focus = { entryId: id };
  }
  if (req.trail !== undefined) {
    if (typeof req.trail !== 'object' || Array.isArray(req.trail)) {
      throw new Error('request.trail must be a plain object');
    }
    if (!Number.isSafeInteger(req.trail.from) || req.trail.from < 1) {
      throw new Error('request.trail.from must be a positive integer seq');
    }
    out.trail = { from: req.trail.from };
  }
  return out;
}
