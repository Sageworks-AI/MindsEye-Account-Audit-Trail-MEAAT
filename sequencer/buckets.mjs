// Time-bucket aggregation for the Sequencer timeline: counts per lane per
// bucket, bucket size minute / hour / day. All work is on Date.parse outputs
// (ms since epoch), so runs are deterministic given the same event list.
// `sinceMs` and `nowMs` are supplied by the caller so tests are stable.

const SIZE_MS = { minute: 60_000, hour: 3_600_000, day: 86_400_000 };

export function aggregate(events, { bucket = 'hour', sinceMs, nowMs } = {}) {
  const size = SIZE_MS[bucket];
  if (!size) throw new Error(`unknown bucket: ${bucket}`);
  const end = nowMs ?? Date.now();
  const start = sinceMs ?? (end - size * 23);

  const bucketStart = Math.floor(start / size) * size;
  const buckets = new Map();
  for (let t = bucketStart; t <= end; t += size) {
    buckets.set(t, { ts: t, counts: {} });
  }
  for (const evt of events) {
    const t = Date.parse(evt.ts);
    if (Number.isNaN(t)) continue;
    if (t < start || t > end) continue;
    const key = Math.floor(t / size) * size;
    const b = buckets.get(key);
    if (!b) continue;
    b.counts[evt.lane] = (b.counts[evt.lane] || 0) + 1;
  }
  return {
    bucket,
    sizeMs: size,
    sinceMs: bucketStart,
    nowMs: end,
    rows: [...buckets.values()].sort((a, b) => a.ts - b.ts),
  };
}

export function totalsByLane(events) {
  const out = {};
  for (const evt of events) out[evt.lane] = (out[evt.lane] || 0) + 1;
  return out;
}
