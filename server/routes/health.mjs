// GET /api/health — liveness plus a snapshot of the current data layers.
// The client uses this to detect that the server is up and to display the
// current head sequence and event count in the status strip. Deliberately
// small; no dependency on any other route.
import { jsonResponse } from '../errors.mjs';

export function health(req, res, ctx) {
  const head = ctx.ledger.head();
  jsonResponse(res, 200, {
    ok: true,
    name: 'meaat',
    version: '0.0.0',
    head,
    journalSize: ctx.ledger.size,
    accounts: ctx.ledger.accounts.list.length,
    eventCount: ctx.events.count,
    dataDir: ctx.dataDir,
  });
}
