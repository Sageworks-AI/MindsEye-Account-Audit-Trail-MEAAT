// POST /api/command — body { text, context? }. Runs the deterministic
// grammar in resolve/command.mjs and returns { ok: true, request } or
// { ok: false, error }. NEVER posts an entry: the base rule "the command
// box produces validated requests only" is enforced here by construction,
// not by a check.
//
// A future LLM-backed interpreter plugs in at this same endpoint, replacing
// `interpret()` with the model's output validated by validateRequest()
// (S3). The handler never calls ledger.post.
import { jsonResponse, jsonError } from '../errors.mjs';
import { readJsonBody } from '../bodyLimit.mjs';
import { interpret } from '../../resolve/command.mjs';

export async function postCommand(req, res, ctx) {
  const body = await readJsonBody(req);
  if (!body.ok) return jsonError(res, body.status, body.code, body.message);
  const value = body.value;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return jsonError(res, 400, 'BAD_BODY', 'body must be { text, context? }');
  }
  const { text, context } = value;
  if (typeof text !== 'string') {
    return jsonError(res, 400, 'BAD_BODY', 'text must be a string');
  }
  const result = interpret(text, context || {});
  if (!result.ok) {
    return jsonResponse(res, 200, { ok: false, error: result.error });
  }
  ctx.emit({
    type: 'request.received',
    source: 'server',
    tags: ['command'],
    note: text.length > 120 ? text.slice(0, 117) + '...' : text,
  });
  jsonResponse(res, 200, { ok: true, request: result.request });
}
