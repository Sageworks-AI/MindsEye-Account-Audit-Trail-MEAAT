// Takes a validated request plus a viewport and produces, for each card, a
// cache key, a rectangle, and a tier. Space is computed before any data is
// fetched so the screen lays out instantly while cards load. Addendum A moves
// the mathematics into space/; this file will remain a thin adapter with the
// same exports.
import { solve } from './layout.mjs';
import { tierForRect } from './tiers.mjs';
import { CardStore } from '../store/cardStore.mjs';
import { REGISTRY } from '../core/cards/index.mjs';

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

  const solveResult = solve(request.cards, viewport, {
    weights: opts.weights,
    minSize: opts.minSize,
    gutter: opts.gutter,
  });
  if (solveResult.error) return { error: solveResult.error };

  const period = request.period || {};
  const cards = request.cards.map((c, i) => {
    const rect = solveResult.rects[i];
    const registry = REGISTRY[c.type];
    const minTier = registry ? registry.minTier : 'summary';
    const tier = tierForRect(rect, { minTier });
    const cacheKey = CardStore.cacheKey({
      type: c.type,
      params: c.params || {},
      period,
      head,
    });
    return {
      type: c.type,
      params: c.params || {},
      section: c.section,
      cacheKey,
      rect,
      tier,
    };
  });

  return {
    head: { seq: head.seq, hash: head.hash },
    viewport: { w: viewport.w, h: viewport.h },
    mode: request.mode || 'read',
    cards,
  };
}
