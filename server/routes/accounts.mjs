// GET /api/accounts — the chart of accounts as plain frozen data. The
// client uses this for card name resolution and for the entry form's
// account picker.
import { jsonResponse } from '../errors.mjs';

export function accounts(req, res, ctx) {
  jsonResponse(res, 200, { accounts: ctx.ledger.accounts.list });
}
