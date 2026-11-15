// POST /api/verify — recompute the journal hash chain end-to-end and
// report. Unlike the read-only paths, verify is a POST because it should
// be explicit and rate-limited by the client; nothing changes state on
// disk, but the endpoint still emits a `journal.verified` event so the
// audit trail shows when verification was requested and with what result.
import { jsonResponse } from '../errors.mjs';
import { readJsonBody } from '../bodyLimit.mjs';

export async function verify(req, res, ctx) {
  // Body is optional and ignored; consuming it keeps the request from
  // hanging on a keep-alive connection.
  await readJsonBody(req);
  const result = ctx.ledger.verify();
  const head = ctx.ledger.head();
  ctx.emit({
    type: 'journal.verified',
    source: 'server',
    ref: { seq: head.seq },
    tags: result.ok ? ['ok'] : ['fail', result.reason || 'unknown'],
  });
  jsonResponse(res, result.ok ? 200 : 500, {
    ok: result.ok,
    head,
    ...(result.ok ? {} : { firstBroken: result.firstBroken, reason: result.reason }),
  });
}
