// GET /api/events?since=N&limit=K       — tail events from the log.
// GET /api/events/stats?bucket=…&minutes=…
//                                       — aggregated counts per lane.
//
// `since` is exclusive (return events with id > since). Default limit 200,
// max 2000. `bucket` is minute / hour / day; `minutes` is the size of the
// window ending now (default 60). Stats read from the log so no in-memory
// state is required.
import { jsonResponse, jsonError } from '../errors.mjs';
import { aggregate, totalsByLane } from '../../sequencer/buckets.mjs';

const MAX_LIMIT = 2000;
const BUCKET_SIZES = new Set(['minute', 'hour', 'day']);

export function events(req, res, ctx) {
  const since = req.query.since !== undefined ? Number(req.query.since) : 0;
  if (!Number.isSafeInteger(since) || since < 0) {
    return jsonError(res, 400, 'BAD_QUERY', 'since must be a non-negative integer');
  }
  const limit = req.query.limit !== undefined ? Number(req.query.limit) : 200;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
    return jsonError(res, 400, 'BAD_QUERY', `limit must be 1..${MAX_LIMIT}`);
  }
  const all = ctx.events.readAll();
  const slice = all.filter((e) => e.id > since).slice(0, limit);
  jsonResponse(res, 200, {
    events: slice,
    next: slice.length > 0 ? slice[slice.length - 1].id : since,
    total: all.length,
  });
}

export function eventsStats(req, res, ctx) {
  const bucket = req.query.bucket || 'hour';
  if (!BUCKET_SIZES.has(bucket)) {
    return jsonError(res, 400, 'BAD_QUERY',
      `bucket must be one of minute, hour, day (got ${bucket})`);
  }
  const minutes = req.query.minutes !== undefined ? Number(req.query.minutes) : 60;
  if (!Number.isSafeInteger(minutes) || minutes < 1 || minutes > 60 * 24 * 30) {
    return jsonError(res, 400, 'BAD_QUERY', 'minutes must be 1..43200');
  }
  const all = ctx.events.readAll();
  // Fixed nowMs so two calls in the same process within the same second
  // return the same buckets; the caller does not pass a wall clock.
  const nowMs = Date.now();
  const sinceMs = nowMs - minutes * 60_000;
  const agg = aggregate(all, { bucket, sinceMs, nowMs });
  const totals = totalsByLane(all);
  jsonResponse(res, 200, { bucket, sinceMs, nowMs, rows: agg.rows, totals });
}
