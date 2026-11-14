// Attention, levels and fuzz sections of the report. These are the S8
// report additions required by Addendum B §REPORT ADDITIONS (9), (10),
// (11).
//
// Corrections vs the earlier PART 3 output: the previous draft imported
// `conductor/workflows.mjs` and `conductor/fuzz.mjs` as if they were JS
// modules. They are Python files. This version loads the workflow JSON
// directly (they are plain data) and drives a small inline fuzz via the
// JS twin. The full fuzz summary is read from
// `conductor/out/fuzz-summary.json` when it is present.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  makeState, step, frame, loadLevels,
  levelContrastPermille, CONTRAST_FLOOR,
  getBackendStatus,
} from '../attention/index.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const WORKFLOW_DIR = join(ROOT, 'conductor', 'workflows');
const CHOREO_DIR = join(ROOT, 'conductor', 'out', 'choreography');
const FUZZ_SUMMARY_PATH = join(ROOT, 'conductor', 'out', 'fuzz-summary.json');

const KNOWN_KINDS = new Set(['DOC', 'FORM', 'TRAIL']);

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

// Minimal shape validation of a workflow JSON file. The Python loader does
// the full validation; this only rejects a file that could not be replayed.
function loadWorkflowJson(path) {
  const data = JSON.parse(readFileSync(path, 'utf8'));
  if (!data.id || !data.name || !Array.isArray(data.initialRing) || !Array.isArray(data.steps)) {
    throw new Error(`workflow ${path}: missing id, name, initialRing or steps`);
  }
  for (const a of data.initialRing) {
    if (!a.id || !KNOWN_KINDS.has(a.kind)) {
      throw new Error(`workflow ${path}: bad actor ${JSON.stringify(a)}`);
    }
  }
  for (const s of data.steps) {
    if (!s.event || !Array.isArray(s.expectRing)) {
      throw new Error(`workflow ${path}: step missing event or expectRing`);
    }
  }
  return data;
}

// Live replay of a workflow through the JS twin. Deterministic.
function replayWorkflow(workflow) {
  let state = makeState({ actors: workflow.initialRing });
  const steps = [];
  for (const wf of workflow.steps) {
    const res = step(state, wf.event);
    state = res.state;
    const f = frame(state, null);
    const ids = state.ring.map((a) => a.id);
    const levels = ids.map((_, i) => (i === 0 ? 0 : i === 1 ? 1 : 2));
    const idsMatch = ids.length === wf.expectRing.length &&
      ids.every((x, k) => x === wf.expectRing[k]);
    steps.push({
      action: actionLabel(wf.event),
      code: res.code,
      ring: ids,
      levels,
      frameIds: f.map((x) => x.id),
      expectRing: [...wf.expectRing],
      expectCode: wf.expectCode ?? 0,
      matchesExpectation: idsMatch && res.code === (wf.expectCode ?? 0),
    });
  }
  return { id: workflow.id, name: workflow.name, steps };
}

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
      const fillByLevel = ['#2b5fa8', '#7ba8e0', '#d0d0d0'];
      const textByLevel = ['#ffffff', '#1f1f1f', '#1f1f1f'];
      const x = pad + labelW + j * colW;
      parts.push(`<rect x="${x}" y="${y + 2}" width="${colW - 4}" height="${rowH - 4}" fill="${fillByLevel[level]}" stroke="#1f1f1f" stroke-width="0.5"/>`);
      parts.push(`<text x="${x + 4}" y="${y + 14}" font-family="Menlo, Consolas, monospace" font-size="9" fill="${textByLevel[level]}">${esc(s.ring[j])}</text>`);
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="Storyboard ${storyboard.id}">${parts.join('')}</svg>`;
}

export function buildAttentionSection() {
  const workflowFiles = [];
  if (existsSync(WORKFLOW_DIR)) {
    for (const f of readdirSync(WORKFLOW_DIR).sort()) {
      if (/^W\d+\.json$/.test(f)) workflowFiles.push(join(WORKFLOW_DIR, f));
    }
  }

  const storyboards = [];
  const checks = [];
  for (const path of workflowFiles) {
    let wf;
    try { wf = loadWorkflowJson(path); }
    catch (e) {
      checks.push({ source: 'attention:workflows', name: path.split('/').pop() + ' load', pass: false, detail: e.message });
      continue;
    }
    let sb;
    try { sb = replayWorkflow(wf); }
    catch (e) {
      checks.push({ source: 'attention:workflows', name: `${wf.id} replay`, pass: false, detail: e.message });
      continue;
    }
    storyboards.push(sb);
    const ok = sb.steps.every((s) => s.matchesExpectation);
    const firstFail = sb.steps.findIndex((s) => !s.matchesExpectation);
    checks.push({
      source: 'attention:workflows',
      name: `${wf.id} (${wf.name})`,
      pass: ok,
      detail: ok ? '' : `step ${firstFail}: expected [${sb.steps[firstFail].expectRing}], got [${sb.steps[firstFail].ring}]`,
    });
  }

  const committedPresent = existsSync(CHOREO_DIR) &&
    readdirSync(CHOREO_DIR).some((f) => f.endsWith('.json'));
  const status = getBackendStatus();

  const diagrams = storyboards.map((s) => `<div>${storyboardSvg(s)}</div>`).join('\n');

  const html = `
<p class="muted">Ten workflows, replayed live against the JS twin. Each row
is one event; each rectangle is one actor in the ring after the event,
shaded by level (darkest = focus, mid = near, lightest = far). Only an
explicit CLOSE removes an actor; every other event only re-ranks.</p>
<p class="muted">Attention backend: <code>${esc(status.backend)}</code>
(${esc(status.reason)}). Committed choreographies present:
${committedPresent
  ? 'yes'
  : 'no (run <code>npm run conduct</code> with Python 3.10+ to populate <code>conductor/out/</code>)'}.</p>
<div class="grid">${diagrams || '<p class="notice">no workflows found under conductor/workflows</p>'}</div>`;

  const json = {
    backend: status,
    committedChoreographies: committedPresent,
    storyboards: storyboards.map((s) => ({
      id: s.id, name: s.name,
      steps: s.steps.map((x) => ({
        action: x.action, code: x.code, ring: x.ring, levels: x.levels,
        matchesExpectation: x.matchesExpectation,
      })),
    })),
  };

  return { html, json, checks, allPassed: checks.every((c) => c.pass) };
}

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

  const swatches = ['light', 'dark'].map((theme) => {
    const t = levels.themes[theme];
    const squares = t.table.map((r, lvl) => {
      const factor = (r.opacity * r.brightness) / 1e6;
      const blend = (f, b) => Math.floor((b * (1000 - Math.round(factor * 1000)) + f * Math.round(factor * 1000)) / 1000);
      const cr = blend(t.fg.r, t.bg.r);
      const cg = blend(t.fg.g, t.bg.g);
      const cb = blend(t.fg.b, t.bg.b);
      const bg = `rgb(${t.bg.r}, ${t.bg.g}, ${t.bg.b})`;
      return `<rect x="${lvl * 32}" y="0" width="28" height="28" fill="rgb(${cr}, ${cg}, ${cb})" stroke="${bg}" stroke-width="0.5"/>
              <text x="${lvl * 32 + 6}" y="19" font-family="Menlo, Consolas, monospace" font-size="11" fill="${theme === 'light' ? '#ffffff' : '#1f1f1f'}">L${lvl}</text>`;
    }).join('');
    return `<div><p class="muted">${esc(theme)} theme</p>
      <svg xmlns="http://www.w3.org/2000/svg" width="96" height="28" viewBox="0 0 96 28" role="img" aria-label="${esc(theme)} level swatch">${squares}</svg></div>`;
  }).join('');

  const allPassed = checks.every((c) => c.pass);
  const html = `
<p class="muted">Contrast computed from the same integer pipeline the C ABI
uses (sRGB linearisation via a 256-entry LUT, WCAG ratio in permille).
Floors: 7:1, 4.5:1, 3:1 for L0, L1, L2 (prefers-contrast: more raises L2
to 4.5:1, checked in test/attention/laws.test.mjs).</p>
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

function loadCommittedFuzz() {
  if (!existsSync(FUZZ_SUMMARY_PATH)) return null;
  try {
    const data = JSON.parse(readFileSync(FUZZ_SUMMARY_PATH, 'utf8'));
    if (typeof data.walks === 'number' && typeof data.events === 'number' &&
        typeof data.violations === 'number') return data;
    return null;
  } catch { return null; }
}

// Tiny deterministic smoke fuzz: one event per type, no randomness.
// Proves the JS twin can be driven without throwing. Not a substitute for
// the full fuzz in conductor/out; it merely gives the report a signal on a
// fresh clone with no committed outputs.
function inlineSmokeFuzz() {
  const events = [
    { type: 'FOCUS', id: 'B', source: 'command' },
    { type: 'INPUT_BEGIN', channel: 'text' },
    { type: 'FOCUS', id: 'A', source: 'command' },
    { type: 'INPUT_END', outcome: 'cancel' },
    { type: 'TRANSFER_COPY', sourceId: 'A', payloadKind: 'rows' },
    { type: 'TRANSFER_CANCEL' },
    { type: 'FOCUS', id: 'B', source: 'pointer', pointerEpoch: 1 },
    { type: 'OPEN', actor: { id: 'C', kind: 'DOC' } },
    { type: 'CLOSE', id: 'B' },
    { type: 'BACK' },
    { type: 'RESIZE' },
  ];
  let state = makeState({ actors: [{ id: 'A', kind: 'DOC' }, { id: 'B', kind: 'DOC' }] });
  let applied = 0;
  for (const evt of events) {
    try {
      const r = step(state, evt);
      state = r.state;
      applied += 1;
    } catch (e) {
      return { walks: 1, stepsPerWalk: events.length, events: applied, violations: 1, error: e.message };
    }
  }
  return { walks: 1, stepsPerWalk: events.length, events: applied, violations: 0 };
}

export function buildFuzzSection() {
  const status = getBackendStatus();
  const committed = loadCommittedFuzz();
  const summary = committed || inlineSmokeFuzz();
  const source = committed ? 'conductor/out/fuzz-summary.json' : 'inline smoke (no committed summary)';
  const allPassed = summary.violations === 0;
  const checks = [{
    source: 'attention:fuzz',
    name: `fuzz walk (${source})`,
    pass: allPassed,
    detail: allPassed ? `${summary.events} events, 0 violations`
                      : `${summary.violations} violations: ${summary.error || ''}`,
  }];
  const html = `
<p class="muted">Source: <code>${esc(source)}</code>. The full fuzz runs 50
walks x 200 steps at <code>npm run conduct</code> time. A fresh clone
without committed outputs falls back to a small deterministic smoke walk
that exercises each event type once.</p>
<table>
  <thead><tr><th>Backend</th><th>Walks</th><th>Steps / walk</th>
  <th class="numeric">Events</th><th class="numeric">Violations</th></tr></thead>
  <tbody><tr>
    <td>${esc(status.backend)}</td>
    <td>${summary.walks}</td><td>${summary.stepsPerWalk}</td>
    <td class="numeric">${summary.events}</td>
    <td class="numeric ${allPassed ? 'pass' : 'fail'}">${summary.violations}</td>
  </tr></tbody>
</table>`;
  return { html, json: { backend: status, source, summary }, checks, allPassed };
}
