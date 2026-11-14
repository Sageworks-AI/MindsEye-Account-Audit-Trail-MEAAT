// Sequencer summary and checks table for the report. Both take plain data
// (event list, check list) so they run without a backend and are byte-stable
// given the same inputs.
//
// The sequencer summary shows event counts per lane; the checks table is the
// canonical list of every check from every card, impact computation, trail,
// space solver run, and (when present) attention law run. A failing check
// here is what makes `npm run report` exit non-zero.
import { totalsByLane } from '../sequencer/buckets.mjs';

function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

const LANE_ORDER = ['journal', 'request', 'cache', 'trail', 'check', 'space', 'attention'];

export function buildSequencerSection({ events }) {
  if (!Array.isArray(events)) return { html: '', json: {}, checks: [], allPassed: true };
  const totals = totalsByLane(events);
  const hits = events.filter((e) => e.type === 'card.hit').length;
  const misses = events.filter((e) => e.type === 'card.miss').length;
  const total = hits + misses;
  const ratio = total === 0 ? 'n/a' : `${Math.round((hits / total) * 1000) / 10}%`;

  const rows = LANE_ORDER.map((lane) => {
    const n = totals[lane] || 0;
    return `<tr><td>${esc(lane)}</td><td class="numeric">${n}</td></tr>`;
  }).join('');

  const html = `
<p class="muted">Events by lane. The Sequencer is advisory only; nothing
financial is read back from these counts.</p>
<table>
  <thead><tr><th>Lane</th><th class="numeric">Count</th></tr></thead>
  <tbody>${rows}
    <tr><td><strong>Total</strong></td><td class="numeric"><strong>${events.length}</strong></td></tr>
  </tbody>
</table>
<p class="muted">Card cache: <strong>${hits}</strong> hits,
<strong>${misses}</strong> misses (${esc(ratio)}).</p>`;

  const json = {
    total: events.length,
    byLane: { ...totals },
    cache: { hits, misses, total, hitRatioPermille: total === 0 ? null : Math.round((hits / total) * 1000) },
  };

  return { html, json, checks: [], allPassed: true };
}

export function buildChecksSection({ items }) {
  if (!Array.isArray(items)) items = [];
  const allPassed = items.every((i) => i.pass);
  const failing = items.filter((i) => !i.pass).length;

  const rows = items.map((item) => {
    const cls = item.pass ? 'pass' : 'fail';
    const marker = item.pass ? '✓' : '✗';
    const detail = item.detail === undefined ? '' : esc(item.detail);
    return `<tr><td>${esc(item.source)}</td><td>${esc(item.name)}</td><td class="${cls}">${marker}</td><td class="muted">${detail}</td></tr>`;
  }).join('');

  const summary = allPassed
    ? `<p class="pass"><strong>${items.length} checks pass.</strong></p>`
    : `<p class="fail"><strong>${failing} of ${items.length} checks fail.</strong></p>`;

  const html = `${summary}
<table>
  <thead><tr><th>Source</th><th>Check</th><th></th><th>Detail</th></tr></thead>
  <tbody>${rows || '<tr><td colspan="4" class="muted">no checks</td></tr>'}</tbody>
</table>`;

  return {
    html,
    json: { total: items.length, failing, allPassed, items: items.map((i) => ({ ...i })) },
    checks: [{ source: 'report:checks', name: 'all checks pass', pass: allPassed, detail: `${failing} failing` }],
    allPassed,
  };
}
