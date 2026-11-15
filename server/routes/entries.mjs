// POST /api/entries        — append a new entry.
// POST /api/entries/:seq/reverse — append a reversal.
//
// Both call Ledger.post/reverse first (which validates the entry, checks
// the chart, enforces MAX_ENTRY_LINES, requires real calendar dates, and
// rejects ambiguous debit/credit) then append to the on-disk journal.
// If the journal append fails after the in-memory ledger accepted the
// entry, we return 500 JOURNAL_WRITE_FAILED rather than pretending success;
// the client must reload and see that the head has moved.
import { jsonResponse, jsonError } from '../errors.mjs';
import { readJsonBody } from '../bodyLimit.mjs';

export async function postEntry(req, res, ctx) {
  const body = await readJsonBody(req);
  if (!body.ok) return jsonError(res, body.status, body.code, body.message);
  const draft = body.value;
  if (!draft || typeof draft !== 'object' || Array.isArray(draft)) {
    return jsonError(res, 400, 'BAD_ENTRY', 'body must be a JSON object');
  }
  if (draft.reverses !== undefined) {
    return jsonError(res, 400, 'BAD_ENTRY',
      'use POST /api/entries/:seq/reverse to post a reversal');
  }
  let entry;
  try {
    entry = ctx.ledger.post(draft);
  } catch (e) {
    return jsonError(res, 400, 'BAD_ENTRY', e.message);
  }
  try {
    ctx.journal.append(entry);
  } catch (e) {
    return jsonError(res, 500, 'JOURNAL_WRITE_FAILED', e.message);
  }
  ctx.emit({
    type: 'entry.posted',
    source: 'server',
    ref: { seq: entry.seq },
    tags: entry.reverses !== undefined ? ['reversal'] : [],
  });
  jsonResponse(res, 201, { entry });
}

export async function postReverse(req, res, ctx) {
  const seq = Number(req.params.seq);
  if (!Number.isSafeInteger(seq) || seq < 1) {
    return jsonError(res, 400, 'BAD_SEQ',
      `seq must be a positive integer, got ${JSON.stringify(req.params.seq)}`);
  }
  const body = await readJsonBody(req);
  if (!body.ok) return jsonError(res, body.status, body.code, body.message);
  const value = body.value;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return jsonError(res, 400, 'BAD_BODY', 'body must be { date, memo }');
  }
  const { date, memo } = value;
  let entry;
  try {
    entry = ctx.ledger.reverse(seq, { date, memo });
  } catch (e) {
    return jsonError(res, 400, 'BAD_REVERSAL', e.message);
  }
  try {
    ctx.journal.append(entry);
  } catch (e) {
    return jsonError(res, 500, 'JOURNAL_WRITE_FAILED', e.message);
  }
  ctx.emit({
    type: 'entry.reversed',
    source: 'server',
    ref: { seq },
    tags: [`reversal_of_${seq}`],
  });
  jsonResponse(res, 201, { entry });
}
