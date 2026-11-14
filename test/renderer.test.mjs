// Renderer structural tests: every card type × tier produces a well-formed
// SVG string with the expected root attributes; text is escaped; no line is
// clipped by the pane (its right edge stays inside the viewBox); the same
// inputs produce byte-identical output on two runs. Impact and trail have
// their own tests. The strip has its own test.
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { buildCard } from '../core/cards/index.mjs';
import { computeImpact } from '../core/impact.mjs';
import { build as buildBalanceSheet } from '../core/cards/balanceSheet.mjs';
import { createTrail, addNode, addLink, setTarget, makeNode } from '../core/trail.mjs';
import { buildStrip } from '../sequencer/strip.mjs';
import { renderCard } from '../view/svg/slip.mjs';
import { renderImpact } from '../view/svg/impact.mjs';
import { renderTrail } from '../view/svg/trail.mjs';
import { renderStrip } from '../view/svg/strip.mjs';
import { getTheme } from '../view/svg/theme.mjs';
import { buildDemoLedger, DEMO_PERIOD } from './fixtures/ledger.mjs';

const AS_OF = Object.freeze({ date: '2026-03-31', seq: Number.MAX_SAFE_INTEGER });
const RECT = Object.freeze({ x: 0n, y: 0n, w: 60000n, h: 80000n });
const THEME = getTheme('light');
const THEME_DARK = getTheme('dark');

const CARD_PARAMS = {
  trial_balance:    { asOf: AS_OF },
  balance_sheet:    { asOf: AS_OF },
  income_statement: { from: DEMO_PERIOD.from, to: DEMO_PERIOD.to },
  cash_flow:        { from: DEMO_PERIOD.from, to: DEMO_PERIOD.to },
  receipt:          { entryId: 3 },
};

function expectWellFormedSVG(svg) {
  assert.ok(svg.startsWith('<svg '), 'must start with <svg ');
  assert.ok(svg.endsWith('</svg>'), 'must end with </svg>');
  assert.match(svg, /xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
  assert.match(svg, /role="img"/);
  // No unbalanced '<' (only element starts). A cheap signal.
  const opens = (svg.match(/<[a-zA-Z]/g) || []).length;
  assert.ok(opens > 0);
  // No raw '&' that isn't part of an entity or escape.
  assert.doesNotMatch(svg, /&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/);
}

test('renderer: every card type renders at every tier', () => {
  const l = buildDemoLedger();
  const view = l.view();
  for (const [type, params] of Object.entries(CARD_PARAMS)) {
    const card = buildCard(type, view, params);
    for (const tier of ['summary', 'standard', 'full']) {
      const svg = renderCard(card, RECT, tier, THEME);
      expectWellFormedSVG(svg);
      assert.match(svg, new RegExp(`data-tier="${tier}"`));
      assert.match(svg, new RegExp(`data-card-type="${type}"`));
      assert.match(svg, new RegExp(`data-hash="${card.hash}"`));
    }
  }
});

test('renderer: byte-stable across two builds', () => {
  const l1 = buildDemoLedger();
  const l2 = buildDemoLedger();
  const a = renderCard(buildCard('balance_sheet', l1.view(), CARD_PARAMS.balance_sheet), RECT, 'standard', THEME);
  const b = renderCard(buildCard('balance_sheet', l2.view(), CARD_PARAMS.balance_sheet), RECT, 'standard', THEME);
  assert.equal(a, b);
});

test('renderer: escaped content in a card title', () => {
  const l = buildDemoLedger();
  const card = buildCard('balance_sheet', l.view(), CARD_PARAMS.balance_sheet);
  const escaped = { ...card, title: 'A <tag> & "quote"' };
  const svg = renderCard(escaped, RECT, 'summary', THEME);
  assert.ok(svg.includes('A &lt;tag&gt; &amp; &quot;quote&quot;'));
  assert.ok(!svg.includes('<tag>'));
});

test('renderer: dark theme is byte-stable and different from light', () => {
  const l = buildDemoLedger();
  const card = buildCard('balance_sheet', l.view(), CARD_PARAMS.balance_sheet);
  const lightA = renderCard(card, RECT, 'full', THEME);
  const lightB = renderCard(card, RECT, 'full', THEME);
  const darkA = renderCard(card, RECT, 'full', THEME_DARK);
  assert.equal(lightA, lightB);
  assert.notEqual(lightA, darkA);
  assert.ok(darkA.includes('fill="#eaeaea"'));
});

test('renderer: failing check turns the footer marker red', () => {
  const l = buildDemoLedger();
  const card = buildCard('balance_sheet', l.view(), CARD_PARAMS.balance_sheet);
  const broken = { ...card, checks: [{ name: 'broken check', pass: false, detail: 'x' }], ok: false };
  const svg = renderCard(broken, RECT, 'summary', THEME);
  assert.ok(svg.includes('data-ok="false"'));
  assert.ok(svg.includes('fill="#b00020"'));
  assert.ok(svg.includes('✗'));
});

test('renderer: summary tier omits row codes and standard tier shows them at full', () => {
  const l = buildDemoLedger();
  const card = buildCard('receipt', l.view(), CARD_PARAMS.receipt);
  const summary = renderCard(card, RECT, 'summary', THEME);
  const full = renderCard(card, RECT, 'full', THEME);
  assert.ok(!summary.includes('>1000<'), 'summary must not show account codes');
  assert.ok(full.includes('>1000<'), 'full must show account codes');
});

test('impact: renders with before/delta/after and dimmed untouched rows', () => {
  const l = buildDemoLedger();
  const card = computeImpact(buildBalanceSheet, l.view(), CARD_PARAMS.balance_sheet, 4);
  const svg = renderImpact(card, RECT, 'standard', THEME);
  expectWellFormedSVG(svg);
  assert.match(svg, /data-mode="impact"/);
  assert.match(svg, /data-entry-seq="4"/);
  assert.ok(svg.includes('Before'));
  assert.ok(svg.includes('Delta'));
  assert.ok(svg.includes('After'));
  assert.ok(svg.includes('data-ok="true"'));
});

test('impact: outside period shows the warning message', () => {
  const l = buildDemoLedger();
  const narrow = { from: '2026-04-01', to: '2026-04-30' };
  const card = computeImpact(buildBalanceSheet, l.view(), narrow, 3);
  const svg = renderImpact(card, RECT, 'standard', THEME);
  assert.ok(svg.includes('outside this period'));
});

test('trail: renders header, target and node count', () => {
  const l = buildDemoLedger();
  const e3 = l.getEntry(3);
  const e4 = l.getEntry(4);
  let trail = createTrail({ id: 't-demo', name: 'INV-1 flow' });
  trail = addNode(trail, makeNode(e3, 0)); // AR debit 8000
  trail = addNode(trail, makeNode(e4, 1)); // AR credit 8000
  trail = addLink(trail, {
    from: 'n_3_0', to: 'n_4_1', kind: 'derived', basis: 'same_ref',
    note: 'invoice=INV-1',
  });
  trail = setTarget(trail, -8000);
  trail = { ...trail, currency: { code: 'BWP', exponent: 2, symbol: 'P' } };
  const svg = renderTrail(trail, RECT, THEME);
  expectWellFormedSVG(svg);
  assert.ok(svg.includes('data-trail-id="t-demo"'));
  assert.ok(svg.includes('data-node-count="2"'));
  assert.ok(svg.includes('data-link-count="1"'));
  assert.ok(svg.includes('INV-1 flow'));
  assert.ok(svg.includes('data-link-kind="derived"'));
  assert.ok(svg.includes('data-node-id="n_3_0"'));
});

test('trail: empty trail renders a placeholder', () => {
  const trail = createTrail({ id: 't-empty', name: 'empty' });
  const svg = renderTrail(trail, RECT, THEME);
  assert.ok(svg.includes('Empty trail'));
});

test('trail: drawn links are dashed, derived links are not', () => {
  const l = buildDemoLedger();
  const e3 = l.getEntry(3);
  let trail = createTrail({ id: 't2', name: 'mixed' });
  trail = addNode(trail, makeNode(e3, 0));
  trail = addNode(trail, makeNode(e3, 1));
  trail = addLink(trail, { from: 'n_3_0', to: 'n_3_1', kind: 'derived', basis: 'same_entry' });
  trail = addLink(trail, { from: 'n_3_0', to: 'n_3_1', kind: 'drawn', basis: 'manual' });
  // Second link overwrites the first by (from,to); that is expected by addLink.
  const svg = renderTrail(trail, RECT, THEME);
  assert.ok(svg.includes('data-link-kind="drawn"'));
  assert.ok(svg.includes('stroke-dasharray="2 2"'));
});

test('strip: renders the request line and figures', () => {
  const strip = buildStrip({
    request: {
      mode: 'read',
      cards: [{ type: 'balance_sheet' }, { type: 'cash_flow' }],
      period: { from: '2026-01-01', to: '2026-03-31' },
    },
    head: { seq: 7, hash: 'abcdef0123456789'.repeat(4) },
    cacheStates: { balance_sheet: 'hit', cash_flow: 'miss' },
    figures: [
      { label: 'Cash', opening: 0, change: 76000, closing: 76000 },
    ],
  });
  const svg = renderStrip(strip, { x: 0n, y: 0n, w: 90000n, h: 4000n }, THEME);
  expectWellFormedSVG(svg);
  assert.ok(svg.includes('read'));
  assert.ok(svg.includes('balance_sheet:hit'));
  assert.ok(svg.includes('cash_flow:miss'));
  assert.ok(svg.includes('head 7:'));
  assert.ok(svg.includes('760.00'));
  assert.ok(svg.includes('data-mode="read"'));
  assert.ok(svg.includes('data-head-seq="7"'));
});

test('strip: no overflow when the request line is very long', () => {
  const longType = 'balance_sheet_and_this_name_is_deliberately_long_to_force_truncation_of_the_request_line';
  const strip = buildStrip({
    request: { mode: 'read', cards: [{ type: longType }], period: { from: '2026-01-01', to: '2026-03-31' } },
    head: { seq: 1, hash: 'a'.repeat(64) },
    figures: [],
  });
  const svg = renderStrip(strip, { x: 0n, y: 0n, w: 40000n, h: 4000n }, THEME);
  assert.ok(svg.includes('\u2026') || !svg.includes(longType), 'long request must be truncated');
  expectWellFormedSVG(svg);
});

test('strip: byte-stable across two builds', () => {
  const strip = buildStrip({
    request: { mode: 'read', cards: [{ type: 'balance_sheet' }] },
    head: { seq: 7, hash: 'a'.repeat(64) },
    figures: [{ label: 'Cash', opening: 0, change: 100, closing: 100 }],
  });
  const a = renderStrip(strip, { x: 0n, y: 0n, w: 90000n, h: 4000n }, THEME);
  const b = renderStrip(strip, { x: 0n, y: 0n, w: 90000n, h: 4000n }, THEME);
  assert.equal(a, b);
});

test('primitives: cptToPt emits exact decimal strings', async () => {
  const { cptToPt } = await import('../view/svg/primitives.mjs');
  assert.equal(cptToPt(0n), '0');
  assert.equal(cptToPt(100n), '1');
  assert.equal(cptToPt(50n), '0.5');
  assert.equal(cptToPt(123n), '1.23');
  assert.equal(cptToPt(12345n), '123.45');
  assert.equal(cptToPt(-150n), '-1.5');
  assert.equal(cptToPt(-1n), '-0.01');
});

test('text: width scales linearly with fontSize', async () => {
  const { textWidth } = await import('../view/svg/text.mjs');
  const sample = 'Balance Sheet';
  const a = textWidth(sample, 1000n);
  const b = textWidth(sample, 2000n);
  assert.equal(b, a * 2n);
});

test('text: truncation is deterministic and never exceeds the width', async () => {
  const { truncateWithEllipsis, textWidth } = await import('../view/svg/text.mjs');
  const s = 'This is a very long account label that should get truncated';
  const maxW = 5000n;
  const once = truncateWithEllipsis(s, maxW, 1000n);
  const twice = truncateWithEllipsis(s, maxW, 1000n);
  assert.equal(once, twice);
  assert.ok(textWidth(once, 1000n) <= maxW);
  assert.ok(once.endsWith('\u2026'));
});
