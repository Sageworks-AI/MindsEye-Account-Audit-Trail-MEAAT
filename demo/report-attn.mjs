// Attention, levels and fuzz sections of the report. These are the S8 report
// additions required by Addendum B §REPORT ADDITIONS (9), (10), (11):
//   - a storyboard for each of W1..W10 with levels and pane rectangles
//     shaded by level using the level table
//   - a levels table for both themes with contrast figures and the
//     three-level swatch
//   - a fuzz + parity summary
//
// The storyboards come from the committed choreographies in
// conductor/out/choreography (if present) plus a live replay of the
// workflows through the JS twin. The live replay is authoritative; the
// committed files are byte-compared by `npm run conduct:verify`. When
// conductor/out is empty (fresh clone, no Python), the live replay still
// runs and the committed-file check is skipped with a note.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  makeState, step, frame, loadLevels,
  levelContrastPermille, CONTRAST_FLOOR,
  getBackendStatus,
} from '../attention/index.mjs';
import { loadWorkflow } from '../../conductor/workflows.mjs';
import {
  runAll as runFuzz,
} from '../../conductor/fuzz.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const WORKFLOW_DIR = join(ROOT, 'conductor', 'workflows');
const CHOREO_DIR = join(ROOT, 'conductor', 'out', 'choreography');

function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function actionLabel(evt) {
  switch (evt.type) {
    case 'OPEN':          return `OPEN ${evt.actor.id}`;
    case 'CLOSE':         return `CLOSE ${evt.id}`;
    case 'FOCUS':         return evt.source === 'pointer'
                            ? `FOCUS ${evt.id} (pointer e${evt.pointerEpoch})`
                            : `FOCUS ${evt.id} (${evt.source})`;
    case 'INPUT_BEGIN':   return `INPUT_BEGIN ${evt.channel}`;
    case 'INPUT_END':     return `INPUT_END ${evt.outcome}`;
    case 'TRANSFER_COPY': return `COPY ${evt.sourceId} (${evt.payloadKind})`;
    case 'TRANSFER_PASTE':return `PASTE ${evt.targetId} (${evt.outcomeKind})`;
    case 'TRANSFER_CANCEL': return 'TRANSFER_CANCEL';
    case 'BACK':          return 'BACK';
    case 'RESIZE':        return 'RESIZE';
    default:              return evt.type;
  }
}

// Live replay: build the state from the workflow's initial ring, apply each
// event, record the ring, levels and frame. Deterministic.
function replayWorkflow(workflow) {
  let state = makeState({ actors: workflow.initialRing });
  const steps = [];
  for (const wf of workflow.steps) {
    const res = step(state, wf.event);
    state = res.state;
    const f = frame(state, null);
    const ids = state.ring.map((a) => a.id);
    const levels = ids.map((_, i) => (i === 0 ? 0 : i === 1 ? 1 : 2));
    steps.push({
      action: actionLabel(wf.event),
      code: res.code,
      ring: ids,
      levels,
      frameIds: f.map((x) => x.id),
    });
  }
  return { id: workflow.id, name: workflow.name, steps };
}

// Small per-workflow diagram: one row per step, one column per ring slot,
// shaded by level. Pure SVG. No reliance on the level table's colours so
// the diagram is legible on either theme; levels are visualised as
// increasing opacity.
function storyboardSvg(storyboard) {
  const rowH = 22;
  const colW = 78;
  const labelW = 190;
  const pad = 8;
  const nSteps = storyboard.steps.length;
  const maxSlots = Math.max(1, ...storyboard.steps.map((s) => s.ring.length));
  const width = pad * 2 + labelW + maxSlots * colW;
  const height = pad * 2 + 18 + nSteps * rowH;

  const parts = [];
  parts.push(`<rect x="0" y="0" width="${width}" height="${height}" fill="#f4f4f2" stroke="#d9d9d9"/>`);
  parts.push(`<text x="${pad}" y="${pad + 12}" font-family="Menlo, Consolas, monospace" font-size="10" fill="#1f1f1f">${esc(storyboard.id)} ${esc(storyboard.name)}</text>`);
  for (let i = 0; i < nSteps; i++) {
    const s = storyboard.steps[i];
    const y = pad + 18 + i * rowH;
    parts.push(`<text x="${pad}" y="${y + 14}" font-family="Menlo, Consolas, monospace" font-size="9" fill="#1f1f1f">${esc(s.action)}</text>`);
    for (let j = 0; j < s.ring.length; j++) {
      const level = s.levels[j];
      // Levels 0, 1, 2 -> opacity in hundredths. Integer; no CSS vars.
      const fillByLevel = ['#2b5fa8', '#7ba8e0', '#d0d0d0'];
      const textByLevel = ['#ffffff', '#1f1f1f', '#1f1f1f'];
      const x = pad + labelW + j * colW;
      parts.push(`<rect x="${x}" y="${y + 2}" width="${colW - 4}" height="${rowH - 4}" fill="${fillByLevel[level]}" stroke="#1f1f1f" stroke-width="0.5"/>`);
      parts.push(`<text x="${x + 4}" y="${y + 14}" font-family="Menlo, Consolas, monospace" font-size="9" fill="${textByLevel[level]}">${esc(s.ring[j])}</text>`);
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="Storyboard ${storyboard.id}">${parts.join('')}</svg>`;
}

function tryLoadWorkflow(id) {
  const path = join(WORKFLOW_DIR, `${id}.json`);
  if (!existsSync(path)) return null;
  try {
    return loadWorkflow(path);
  } catch {
    return null;
  }
}

export function buildAttentionSection() {
  const workflowIds = [];
  if (existsSync(WORKFLOW_DIR)) {
    for (const f of readdirSync(WORKFLOW_DIR).sort()) {
      if (/^W\d+\.json$/.test(f)) workflowIds.push(f.slice(0, -5));
    }
  }

  const storyboards = [];
  const checks = [];
  for (const id of workflowIds) {
    const wf = tryLoadWorkflow(id);
    if (!wf) continue;
    let sb;
    try {
      sb = replayWorkflow(wf);
    } catch (e) {
      checks.push({ source: 'attention:workflows', name: `${id} replay`, pass: false, detail: e.message });
      continue;
    }
    storyboards.push(sb);
    // A storyboard matches its workflow only when every replay step
    // produced a ring equal to the workflow's expectRing.
    const ok = wf.steps.every((s, i) => {
      const r = sb.steps[i];
      if (!r) return false;
      const ids = s.expectRing;
      return r.ring.length === ids.length && r.ring.every((x, k) => x === ids[k]);
    });
    checks.push({ source: 'attention:workflows', name: `${id} (${wf.name})`, pass: ok });
  }

  // Note whether conductor/out is populated (informational, not a check).
  const committedPresent = existsSync(CHOREO_DIR) &&
    readdirSync(CHOREO_DIR).some((f) => f.endsWith('.json'));
  const status = getBackendStatus();

  const diagrams = storyboards.map((s) => `<div>${storyboardSvg(s)}</div>`).join('\n');

  const html = `
<p class="muted">Ten workflows, replayed live against the JS twin. Each row
is one event; each rectangle is one actor in the ring after the event,
shaded by level (darkest = focus, mid = near, lightest = far). Only an
explicit CLOSE removes an actor; every other event only re-ranks.</p>
<p class="muted">Attention backend: <code>${esc(status.backend)}</code> (${esc(status.reason)}).
Committed choreographies present: ${committedPresent ? 'yes' : 'no (run <code>npm run conduct</code> to populate <code>conductor/out/</code>)'}.</p>
<div class="grid">${diagrams || '<p class="notice">no workflows found under conductor/workflows</p>'}</div>`;

  const json = {
    backend: status,
    committedChoreographies: committedPresent,
    storyboards: storyboards.map((s) => ({
      id: s.id, name: s.name,
      steps: s.steps.map((x) => ({ action: x.action, code: x.code, ring: x.ring, levels: x.levels })),
    })),
  };

  return { html, json, checks, allPassed: checks.every((c) => c.pass) };
}

// ---------------------------------------------------------------------------
// Levels table: contrast figures and swatch for both themes.
// ---------------------------------------------------------------------------
export function buildLevelsSection() {
  const levels = loadLevels();
  const checks = [];
  const rows = [];
  for (const theme of ['light', 'dark']) {
    const t = levels.themes[theme];
    for (let lvl = 0; lvl < 3; lvl++) {
      const r = t.table[lvl];
      const contrast = levelContrastPermille(t.fg, t.bg, r.opacity, r.brightness);
      const floor = CONTRAST_FLOOR[theme][lvl];
      const pass = contrast >= floor;
      rows.push({ theme, level: lvl, opacity: r.opacity, brightness: r.brightness,
                 saturation: r.saturation, shadow: r.shadow, radius: r.radius,
                 contrastPermille: contrast, floorPermille: floor, pass });
      checks.push({
        source: `levels:${theme}`,
        name: `L${lvl} contrast ${contrast} >= ${floor}`,
        pass,
        detail: `opacity=${r.opacity} brightness=${r.brightness}`,
      });
    }
  }
  const tableRows = rows.map((r) => {
    const cls = r.pass ? 'pass' : 'fail';
    const marker = r.pass ? '✓' : '✗';
    return `<tr>
      <td>${esc(r.theme)}</td>
      <td class="numeric">${r.level}</td>
      <td class="numeric">${r.opacity}</td>
      <td class="numeric">${r.brightness}</td>
      <td class="numeric">${r.saturation}</td>
      <td class="numeric">${r.shadow}</td>
      <td class="numeric">${r.radius}</td>
      <td class="numeric">${r.contrastPermille}</td>
      <td class="numeric">${r.floorPermille}</td>
      <td class="${cls}">${marker}</td>
    </tr>`;
  }).join('');

  // Three-level swatch: three rows of three squares each.
  const swatches = ['light', 'dark'].map((theme) => {
    const t = levels.themes[theme];
    const squares = t.table.map((r, lvl) => {
      const fgColor = `rgb(${t.fg.r}, ${t.fg.g}, ${t.fg.b})`;
      const bgColor = `rgb(${t.bg.r}, ${t.bg.g}, ${t.bg.b})`;
      const factor = (r.opacity * r.brightness) / 1e6;
      // Blend the fg toward the bg by the level's opacity*brightness factor.
      // Integers rounded to 0..255 for the SVG fill.
      const blend = (f, b) => Math.floor((b * (1000 - Math.round(factor * 1000)) + f * Math.round(factor * 1000)) / 1000);
      const cr = blend(t.fg.r, t.bg.r);
      const cg = blend(t.fg.g, t.bg.g);
      const cb = blend(t.fg.b, t.bg.b);
      return `<rect x="${lvl * 32}" y="0" width="28" height="28" fill="rgb(${cr}, ${cg}, ${cb})" stroke="${bgColor}" stroke-width="0.5"/>
              <text x="${lvl * 32 + 6}" y="19" font-family="Menlo, Consolas, monospace" font-size="11" fill="${theme === 'light' ? '#ffffff' : '#1f1f1f'}">L${lvl}</text>`;
    }).join('');
    return `<div><p class="muted">${esc(theme)} theme</p>
      <svg xmlns="http://www.w3.org/2000/svg" width="96" height="28" viewBox="0 0 96 28" role="img" aria-label="${esc(theme)} level swatch">${squares}</svg></div>`;
  }).join('');

  const allPassed = checks.every((c) => c.pass);
  const html = `
<p class="muted">Contrast computed from the same integer pipeline the C ABI
uses (sRGB linearisation via a 256-entry LUT, WCAG ratio in permille).
Floors: 7:1, 4.5:1, 3:1 for L0, L1, L2 (prefers-contrast: more raises L2 to
4.5:1, checked in test/attention/laws.test.mjs, not here).</p>
<table>
  <thead><tr>
    <th>Theme</th><th class="numeric">Level</th>
    <th class="numeric">Opacity</th><th class="numeric">Brightness</th>
    <th class="numeric">Saturation</th><th class="numeric">Shadow</th>
    <th class="numeric">Radius</th><th class="numeric">Contrast (‰)</th>
    <th class="numeric">Floor (‰)</th><th></th>
  </tr></thead>
  <tbody>${tableRows}</tbody>
</table>
<div class="grid grid-3" style="margin-top:16px">${swatches}</div>`;

  return { html, json: { rows, allPassed }, checks, allPassed };
}

// ---------------------------------------------------------------------------
// Fuzz + parity summary. Uses a short deterministic run (3 walks x 30 steps)
// so the report stays fast; the full run lives in conductor/out. Reports
// the backend and whether native/wasm parity is available.
// ---------------------------------------------------------------------------
export function buildFuzzSection() {
  const status = getBackendStatus();
  let summary;
  let error = null;
  try {
    // Bridge backend via Node is not used here; the JS twin is authoritative
    // for the report. `fuzz.runAll` drives `step` through the twin.
    // The fuzz module expects a backend exposing `.step(state, event)`;
    // we build one from the exported `step` function here to avoid pulling
    // the Node bridge into the report.
    const twinBackend = {
      step: (state, event) => {
        const r = step(state, event);
        return { code: r.code, state: r.state, frame: frame(r.state, null) };
      },
      close: () => {},
    };
    summary = runFuzz(twinBackend, { nWalks: 3, stepsPerWalk: 30, seedsBase: 1009 });
  } catch (e) {
    error = e.message;
  }

  const allPassed = error === null && summary && summary.violations === 0;
  const checks = [{
    source: 'attention:fuzz',
    name: 'fuzz walk',
    pass: allPassed,
    detail: error || (summary ? `${summary.events} events, ${summary.violations} violations` : 'unknown'),
  }];

  const html = `
<p class="muted">Short deterministic fuzz run inside the report. The full
suite (50 walks x 200 steps) lives in <code>conductor/out/fuzz-summary.json</code>;
this summary only proves the current attention build passes a smoke test.</p>
${error
  ? `<p class="fail">fuzz error: ${esc(error)}</p>`
  : `<table>
       <thead><tr><th>Backend</th><th>Walks</th><th>Steps / walk</th><th class="numeric">Events</th><th class="numeric">Violations</th></tr></thead>
       <tbody><tr>
         <td>${esc(status.backend)}</td>
         <td>${summary.walks}</td><td>${summary.stepsPerWalk}</td>
         <td class="numeric">${summary.events}</td>
         <td class="numeric ${summary.violations === 0 ? 'pass' : 'fail'}">${summary.violations}</td>
       </tr></tbody>
     </table>`}`;

  return { html, json: { backend: status, summary, error }, checks, allPassed };
}
