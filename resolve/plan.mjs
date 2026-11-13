// Takes a validated request plus a viewport and produces, for each card, a
// cache key, a rectangle, and a tier. Space is computed before any data is
// fetched so the screen lays out instantly while cards load.
//
// S4-close: two boundary-driven changes.
//   1. CARD_TYPES comes from bridge/schema.mjs (pure data), not from the
//      registry, so resolve does not import core/cards.
//   2. The cacheKey function is injected by the caller instead of importing
//      store/cardStore.mjs. Production passes CardStore.cacheKey; tests pass
//      a deterministic stub; a future space/WASM plan can pass anything that
//      satisfies the shape. Required: plan returns { error } if it is absent.
import { solve } from './layout.mjs';
import { tierForRect } from './tiers.mjs';
import { CARD_TYPES } from '../bridge/schema.mjs';

export function plan(request, viewport, opts = {}) {
  if (!request || typeof request !== 'object') {
    return { error: 'plan: request required' };
  }
  if (!Array.isArray(request.cards)) {
    return { error: 'plan: request.cards must be an array' };
  }
  const head = opts.head;
  if (!head || !Number.isSafeInteger(head.seq) || typeof head.hash !== 'string') {
    return { error: 'plan: head { seq, hash } required' };
  }
  const cacheKey = opts.cacheKey;
  if (typeof cacheKey !== 'function') {
    return { error: 'plan: opts.cacheKey must be a function ({type,params,period,head}) => string' };
  }

  const solveResult = solve(request.cards, viewport, {
    weights: opts.weights,
    minSize: opts.minSize,
    gutter: opts.gutter,
  });
  if (solveResult.error) return { error: solveResult.error };

  const period = request.period || {};
  const cards = request.cards.map((c, i) => {
    const rect = solveResult.rects[i];
    const typeInfo = CARD_TYPES[c.type];
    const minTier = typeInfo ? typeInfo.minTier : 'summary';
    const tier = tierForRect(rect, { minTier });
    const key = cacheKey({
      type: c.type,
      params: c.params || {},
      period,
      head,
    });
    if (typeof key !== 'string' || !key) {
      return null;
    }
    return {
      type: c.type,
      params: c.params || {},
      section: c.section,
      cacheKey: key,
      rect,
      tier,
    };
  });
  if (cards.some((c) => c === null)) {
    return { error: 'plan: cacheKey function returned a non-string' };
  }

  return {
    head: { seq: head.seq, hash: head.hash },
    viewport: { w: viewport.w, h: viewport.h },
    mode: request.mode || 'read',
    cards,
  };
}
