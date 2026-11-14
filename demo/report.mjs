// Writes out/report.html and out/report.json: the acceptance artifact.
// Exits non-zero if any check fails or if two runs produce different bytes.
// Also exports `setupDemo` and `buildReport` so test/report.test.mjs can
// build twice in-process and byte-compare.
//
// Every section builder returns { html, json, checks, allPassed }. The
// orchestrator concatenates the checks and requires every section (and the
// aggregate checks table) to pass. A failed attention law or fuzz check is
// as fatal as a failed card check — this is why allChecks and allPassed
// include every section, not just the ledger ones.
//
// Setup is deterministic: journal events from the ledger, then synthetic
// cache, space, impact, trail and attention events with timestamps derived
// from a fixed epoch and 1-second spacing. No wall-clock, no randomness.
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { buildDemoLedger, DEMO_PERIOD } from './demo.ledger.mjs';
import { buildReadSection, buildImpactSection, buildTrailSection } from './report-read.mjs';
import { buildSequencerSection, buildChecksSection } from './report-meta.mjs';
import { buildSpaceSection } from './report-space.mjs';
import {
  buildAttentionSection, buildLevelsSection, buildFuzzSection,
} from './report-attn.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const OUT_DIR = join(ROOT, 'out');

// Fixed epoch so synthetic event timestamps are deterministic across runs.
// Q2 2026 keeps the sequencer summary chronologically after the ledger's
// Q1 entries without implying anything about wall-clock time.
const EVENT_BASE_MS = Date.parse('2026-04-01T00:00:00Z');

export function setupDemo() {
  const ledger = buildDemoLedger();
  const events = [];
  const pushEvent = (type, extra) => {
    events.push({
      type,
      ts: new Date(EVENT_BASE_MS + events.length * 1000).toISOString(),
      ...(extra || {}),
    });
  };
  // journal lane: one event per posted entry (reversal carries a tag)
  for (const entry of ledger.entries()) {
    pushEvent('entry.posted', {
      ref: { seq: entry.seq },
      tags: entry.reverses !== undefined ? ['reversal'] : [],
    });
  }
  // cache lane: five cards, each (miss, built, hit). Synthetic but honest
  // about what the report actually builds.
  const cardSpecs = [
    ['balance_sheet',    { asOf: { date: '2026-12-31', seq: Number.MAX_SAFE_INTEGER } }],
    ['income_statement', { from: DEMO_PERIOD.from, to: DEMO_PERIOD.to }],
    ['cash_flow',        { from: DEMO_PERIOD.from, to: DEMO_PERIOD.to }],
    ['receipt',          { entryId: 3 }],
    ['receipt',          { entryId: 4 }],
  ];
  for (const [type, params] of cardSpecs) {
    pushEvent('card.miss',  { ref: { cardKey: type } });
    pushEvent('card.built', { ref: { cardKey: type } });
    pushEvent('card.hit',   { ref: { cardKey: type } });
  }
  // space lane
  pushEvent('space.premeasured', { lane: 'space', tags: ['read-3-card'] });
  pushEvent('space.laid_out',    { lane: 'space' });
  pushEvent('space.reconciled',  { lane: 'space' });
  // check lane
  pushEvent('impact.computed',   { lane: 'check', ref: { seq: 4 } });
  // trail lane
  pushEvent('trail.saved',       { lane: 'trail', ref: { trailId: 'inv1-chain' } });
  // attention lane: a W1-like focus sequence
  for (const ring of [['RC'], ['CF', 'RC'], ['BS', 'CF', 'RC'], ['RC', 'BS', 'CF']]) {
    pushEvent('attention.shifted', { lane: 'attention', tags: [ring.join(',')] });
  }
  return { ledger, events };
}

export function buildReport({ ledger, events }) {
  const view = ledger.view();
  const period = { ...DEMO_PERIOD };
  const asOf = { date: '2026-12-31', seq: Number.MAX_SAFE_INTEGER };
  const head = ledger.head();

  const read = buildReadSection({ ledger, view, period, asOf, head });
  const impact = buildImpactSection({ ledger, view, period, asOf, head });
  const trail = buildTrailSection({ ledger, view, head });
  const space = buildSpaceSection();
  const attn = buildAttentionSection();
  const levels = buildLevelsSection();
  const fuzz = buildFuzzSection();
  const sequencer = buildSequencerSection({ events });

  const allChecks = [
    ...read.checks,
    ...impact.checks,
    ...trail.checks,
    ...space.checks,
    ...attn.checks,
    ...levels.checks,
    ...fuzz.checks,
  ];
  const checks = buildChecksSection({ items: allChecks });

  const allPassed =
    read.allPassed && impact.allPassed && trail.allPassed &&
    space.allPassed && attn.allPassed && levels.allPassed &&
    fuzz.allPassed && checks.allPassed;

  const json = {
    version: 1,
    head,
    currency: { ...ledger.currency },
    period,
    sections: {
      read: read.json,
      impact: impact.json,
      trail: trail.json,
      sequencer: sequencer.json,
      checks: checks.json,
      space: space.json,
      attention: attn.json,
      levels: levels.json,
      fuzz: fuzz.json,
    },
    allPassed,
  };

  const html = htmlDocument({
    head, allPassed,
    sections: [
      { id: 'read',      title: 'Read mode', html: read.html },
      { id: 'impact',    title: 'Impact', html: impact.html },
      { id: 'trail',     title: 'Trail', html: trail.html },
      { id: 'sequencer', title: 'Sequencer', html: sequencer.html },
      { id: 'checks',    title: 'Checks', html: checks.html },
      { id: 'space',     title: 'Space', html: space.html },
      { id: 'attention', title: 'Attention', html: attn.html },
      { id: 'levels',    title: 'Levels', html: levels.html },
      { id: 'fuzz',      title: 'Fuzz', html: fuzz.html },
    ],
  });

  return { html, json, exitCode: allPassed ? 0 : 1 };
}

export function writeReport({ html, json }) {
  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(join(OUT_DIR, 'report.html'), html, 'utf8');
  writeFileSync(join(OUT_DIR, 'report.json'), JSON.stringify(json, null, 2) + '\n', 'utf8');
}

const CSS = `
  :root {
    color-scheme: light dark;
    --bg: #f4f4f2; --paper: #ffffff; --fg: #1f1f1f; --muted: #6b6b6b;
    --rule: #d9d9d9; --accent: #2b5fa8; --ok: #1a6b30; --fail: #b00020;
  }
  @media (prefers-color-scheme: dark) {
    :root { --bg: #1a1a1a; --paper: #232323; --fg: #eaeaea; --muted: #9a9a9a;
            --rule: #3a3a3a; --accent: #7ba8e0; --ok: #6bd08a; --fail: #ff6b80; }
  }
  * { box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; background: var(--bg); color: var(--fg);
         margin: 0; padding: 24px; line-height: 1.5; }
  main { max-width: 1400px; margin: 0 auto; }
  h1 { font-size: 24px; margin: 0 0 8px; }
  h2 { font-size: 18px; margin: 0 0 16px; }
  h3 { font-size: 15px; margin: 16px 0 8px; }
  header { margin-bottom: 24px; }
  section { background: var(--paper); border: 1px solid var(--rule); border-radius: 8px;
            padding: 24px; margin-bottom: 24px; }
  .muted { color: var(--muted); }
  .pass { color: var(--ok); }
  .fail { color: var(--fail); }
  .grid { display: grid; gap: 12px; }
  .grid-3 { grid-template-columns: 1fr; }
  @media (min-width: 1100px) { .grid-3 { grid-template-columns: repeat(3, 1fr); } }
  .card { background: var(--bg); border: 1px solid var(--rule); border-radius: 6px; overflow: hidden; }
  .card svg { display: block; width: 100%; height: auto; }
  table { border-collapse: collapse; width: 100%; font-size: 14px; }
  th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid var(--rule); }
  th { font-weight: 600; background: var(--bg); }
  td.numeric, th.numeric { text-align: right; font-family: Menlo, Consolas, monospace; }
  pre { background: var(--bg); padding: 12px; border-radius: 6px; overflow-x: auto;
        font-family: Menlo, Consolas, monospace; font-size: 12px; }
  .notice { color: var(--muted); font-style: italic; }
`.trim();

function esc(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function htmlDocument({ head, allPassed, sections }) {
  const statusBadge = allPassed
    ? '<span class="pass">all checks pass</span>'
    : '<span class="fail">some checks fail</span>';
  const sectionHtml = sections.map((s) =>
    `<section id="${esc(s.id)}"><h2>${esc(s.title)}</h2>${s.html}</section>`).join('\n');
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>MEAAT report</title>
  <style>${CSS}</style>
</head>
<body>
<main>
  <header>
    <h1>Mind's Eye Account Audit Trail &mdash; Report</h1>
    <p class="muted">head seq ${head.seq} &middot; hash ${esc(head.hash.slice(0, 12))}&hellip; &middot; ${statusBadge}</p>
  </header>
${sectionHtml}
</main>
</body>
</html>
`;
}

const isMain = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isMain) {
  const { ledger, events } = setupDemo();
  const result = buildReport({ ledger, events });
  writeReport(result);
  const status = result.exitCode === 0 ? 'all checks pass' : 'SOME CHECKS FAIL';
  console.log(`report: wrote out/report.html and out/report.json (${status})`);
  process.exit(result.exitCode);
}
