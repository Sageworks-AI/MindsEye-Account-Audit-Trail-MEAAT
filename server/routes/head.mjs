// GET /api/head — just the journal head. Cheap enough that the client can
// poll it before every request to detect a stale cache.
import { jsonResponse } from '../errors.mjs';

export function head(req, res, ctx) {
  jsonResponse(res, 200, ctx.ledger.head());
}
