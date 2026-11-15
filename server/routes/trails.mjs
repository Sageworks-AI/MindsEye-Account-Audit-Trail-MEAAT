// GET  /api/trails           — list trail ids.
// GET  /api/trails/:id       — read a trail.
// PUT  /api/trails           — save a trail (id in the body).
//
// A trail is a saved view, never a write to the journal. The handler
// validates that `nodes` reference real entry lines and that links are well
// formed via core/trail.validateTrail before writing; a trail that fails
// its own checks is stored only if the caller sets `allowFailing: true`
// (default rejects) so a broken trail never silently enters the store.
import { jsonResponse, jsonError } from '../errors.mjs';
import { readJsonBody } from '../bodyLimit.mjs';
import { validateTrail } from '../../core/trail.mjs';

export function listTrails(req, res, ctx) {
  jsonResponse(res, 200, { trails: ctx.trails.list() });
}

export function getTrail(req, res, ctx) {
  const id = req.params.id;
  if (!ctx.trails.exists(id)) {
    return jsonError(res, 404, 'NOT_FOUND', `no trail ${id}`);
  }
  try {
    jsonResponse(res, 200, { trail: ctx.trails.read(id) });
  } catch (e) {
    jsonError(res, 500, 'READ_FAILED', e.message);
  }
}

export async function putTrail(req, res, ctx) {
  const body = await readJsonBody(req);
  if (!body.ok) return jsonError(res, body.status, body.code, body.message);
  const trail = body.value;
  if (!trail || typeof trail !== 'object' || Array.isArray(trail)) {
    return jsonError(res, 400, 'BAD_BODY', 'body must be a trail object');
  }
  if (typeof trail.id !== 'string' || !trail.id) {
    return jsonError(res, 400, 'BAD_BODY', 'trail.id required');
  }
  if (typeof trail.name !== 'string' || !trail.name) {
    return jsonError(res, 400, 'BAD_BODY', 'trail.name required');
  }
  if (!Array.isArray(trail.nodes) || !Array.isArray(trail.links)) {
    return jsonError(res, 400, 'BAD_BODY', 'trail.nodes and trail.links must be arrays');
  }
  let validation;
  try {
    validation = validateTrail(trail, ctx.ledger.view());
  } catch (e) {
    return jsonError(res, 400, 'BAD_TRAIL', e.message);
  }
  if (!validation.ok && trail.allowFailing !== true) {
    const reasons = validation.checks.filter((c) => !c.pass)
      .map((c) => c.name + (c.detail ? `: ${c.detail}` : '')).join('; ');
    return jsonError(res, 400, 'BAD_TRAIL', `trail fails its checks: ${reasons}`);
  }
  try {
    ctx.trails.write(trail);
  } catch (e) {
    return jsonError(res, 500, 'WRITE_FAILED', e.message);
  }
  ctx.emit({
    type: 'trail.saved',
    source: 'server',
    ref: { trailId: trail.id },
    tags: [String(trail.nodes.length), String(trail.links.length)],
  });
  jsonResponse(res, 200, { trail: { id: trail.id }, validation });
}
