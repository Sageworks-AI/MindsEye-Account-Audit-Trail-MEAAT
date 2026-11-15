// POST /api/plan — body { request, viewport, opts? }. Returns the layout
// plan from resolve/plan.mjs with the current head and CardStore.cacheKey
// injected. The client uses this to draw the empty page frames before any
// card data has been fetched (Space layer's premeasure), then fills them
// with the cards it receives from /api/cards.
import { jsonResponse, jsonError } from '../errors.mjs';
import { readJsonBody } from '../bodyLimit.mjs';
import { plan } from '../../resolve/plan.mjs';
import { CardStore } from '../../store/cardStore.mjs';

export async function postPlan(req, res, ctx) {
  const body = await readJsonBody(req);
  if (!body.ok) return jsonError(res, body.status, body.code, body.message);
  const value = body.value;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return jsonError(res, 400, 'BAD_BODY', 'body must be { request, viewport }');
  }
  const { request, viewport, opts } = value;
  if (!request || !viewport) {
    return jsonError(res, 400, 'BAD_BODY', 'request and viewport are required');
  }
  let result;
  try {
    result = plan(request, viewport, {
      head: ctx.ledger.head(),
      cacheKey: CardStore.cacheKey,
      ...(opts || {}),
    });
  } catch (e) {
    return jsonError(res, 400, 'PLAN_FAILED', e.message);
  }
  if (result.error) {
    return jsonError(res, 400, 'PLAN_FAILED', result.error);
  }
  ctx.emit({ type: 'request.received', source: 'server', tags: ['plan'] });
  jsonResponse(res, 200, { plan: result });
}
