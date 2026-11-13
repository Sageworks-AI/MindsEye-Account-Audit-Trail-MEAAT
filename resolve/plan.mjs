// Thin adapter over bridge/measure.mjs. Keeps the S4-close signature:
//   plan(request, viewport, { head, cacheKey, weights, minSize, gutter })
// - cacheKey is REQUIRED (function type); caller passes CardStore.cacheKey
//   in production, a deterministic stub in tests. Required so resolve does
//   not import store/cardStore.mjs.
// - viewport is in CSS px; bridge does the cpt conversion, the space solve,
//   and the px round-trip.
// - Returns { head, viewport, mode, cards: [{cacheKey, rect, tier, ...}],
//   focalIndex, drafts }, or { error }.
import { premeasure, pxFromCpt, draftPremeasured } from '../bridge/measure.mjs';

const PT_PER_PX = 75n;

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
  if (!viewport || !Number.isSafeInteger(viewport.w) || !Number.isSafeInteger(viewport.h) ||
      viewport.w <= 0 || viewport.h <= 0) {
    return { error: 'plan: viewport must be { w, h } positive integers' };
  }

  const viewportCpt = {
    w: BigInt(viewport.w) * PT_PER_PX,
    h: BigInt(viewport.h) * PT_PER_PX,
  };
  const gutterCpt = opts.gutter !== undefined
    ? BigInt(opts.gutter) * PT_PER_PX
    : undefined;

  const result = premeasure(request, opts.chartOfAccounts || null, viewportCpt, {
    weights: opts.weights,
    gutter: gutterCpt,
    focalIndex: opts.focalIndex,
  });
  if (result.error) return { error: result.error };

  const period = request.period || {};
  const cards = [];
  for (let i = 0; i < request.cards.length; i++) {
    const c = request.cards[i];
    const p = result.cards[i];
    if (!p) return { error: `plan: premeasure did not return a frame for card ${i}` };
    const key = cacheKey({ type: c.type, params: c.params || {}, period, head });
    if (typeof key !== 'string' || !key) {
      return { error: 'plan: cacheKey function returned a non-string' };
    }
    cards.push({
      type: c.type,
      params: c.params || {},
      section: c.section,
      cacheKey: key,
      rect: pxFromCpt(p.frameCpt),
      tier: p.tier,
      shapeClass: p.shapeClass,
      scale: p.scale,
      predictedRows: p.predictedRows,
      pagination: p.pagination,
    });
  }

  return {
    head: { seq: head.seq, hash: head.hash },
    viewport: { w: viewport.w, h: viewport.h },
    mode: request.mode || 'read',
    cards,
    focalIndex: result.focalIndex,
    drafts: [draftPremeasured(result)],
  };
}
