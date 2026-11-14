// Space section of the report. This is the S5 report addition required by
// Addendum A §REPORT ADDITIONS (6) and (7): for each layout in the report,
// a diagram drawn from solver output with viewport, pane rects, scale
// factors, shape classes, tiers, focal anchor and center point; and
// layouts for n = 1..4 at three viewport sizes proving the laws.
//
// The diagram is drawn directly from solver output. It is a small SVG built
// here rather than through view/ because it is a meta-diagram of the layout
// engine, not a state card. Rules:
//   - pixel rectangles are derived from cpt by the same edge-floor rule as
//     bridge.pxFromCpt, so the diagram matches what the running app shows
//   - the focal pane is shaded with the accent colour; satellites are muted
//   - labels show shapeClass / tier / scale numerator:denominator, truncated
//     with the same text estimator as view/ (imported from view/svg/text.mjs)
import { solve, loadDocuments } from '../space/index.mjs';
import { pxFromCpt } from '../bridge/measure.mjs';
import { textWidth, truncateWithEllipsis } from '../view/svg/text.mjs';

const DOCS = loadDocuments();
const ARCHETYPES = DOCS.archetypes;

// Card type -> archetype id. Same table as bridge/measure.mjs.
const ARCHETYPE_BY_CARD = Object.freeze({
  trial_balance: 'trial_balance',
  balance_sheet: 'balance_sheet_report_form',
  income_statement: 'income_statement',
  cash_flow: 'cash_flow_statement',
  receipt: 'receipt_roll',
});

const VIEWPORTS = Object.freeze([
  Object.freeze({ name: 'phone',    w: 390,  h: 844 }),
  Object.freeze({ name: 'laptop',   w: 1280, h: 720 }),
  Object.freeze({ name: 'desktop',  w: 1920, h: 1080 }),
]);

const SANS = 'Arial, Helvetica, sans-serif';
const MONO = 'Menlo, Consolas, monospace';

function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function buildPaneInputs(cards, opts = {}) {
  const weights = opts.weights || cards.map(() => 1);
  const panes = [];
  for (let i = 0; i < cards.length; i++) {
    const type = cards[i].type;
    const archetypeId = ARCHETYPE_BY_CARD[type];
    panes.push({
      archetypeId,
      isBar: false,
      rowsUpper: opts.rowsUpper || 20,
      weight: weights[i] || 1,
    });
  }
  return panes;
}

function solveForCards(cards, viewportPx, opts = {}) {
  const vpCpt = { w: BigInt(viewportPx.w) * 75n, h: BigInt(viewportPx.h) * 75n };
  const panes = buildPaneInputs(cards, opts);
  const r = solve(vpCpt, panes, {
    archetypes: ARCHETYPES,
    focalIndex: opts.focalIndex ?? 0,
  });
  if (r.error) return { error: r.error, law: r.law };
  return { result: r, panes, viewportCpt: vpCpt };
}

// Small SVG diagram of a solved layout. All lengths are px in the outer
// diagram so a phone screenshot and a desktop screenshot share a scale
// relative to their own viewport; the *layout* is exact cpt-derived px.
function diagramSvg(layout, viewportPx) {
  const W = viewportPx.w;
  const H = viewportPx.h;
  const centre = { x: Math.floor(W / 2), y: Math.floor(H / 2) };
  const pad = 8;
  const totalW = W + 2 * pad;
  const totalH = H + 2 * pad + 30; // room for the caption

  const parts = [];
  parts.push(`<rect x="0" y="0" width="${totalW}" height="${totalH}" fill="#f4f4f2" stroke="#d9d9d9"/>`);
  parts.push(`<rect x="${pad}" y="${pad}" width="${W}" height="${H}" fill="#ffffff" stroke="#d9d9d9"/>`);

  for (let i = 0; i < layout.panes.length; i++) {
    const pane = layout.panes[i];
    const px = pxFromCpt(pane.rect);
    const isFocal = i === layout.focalIndex;
    const fill = isFocal ? 'rgba(43,95,168,0.10)' : 'rgba(107,107,107,0.06)';
    const stroke = isFocal ? '#2b5fa8' : '#6b6b6b';
    const sw = isFocal ? 1.5 : 1;
    parts.push(`<rect x="${pad + px.x}" y="${pad + px.y}" width="${px.w}" height="${px.h}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/>`);
    const label = `${pane.shapeClass}/${pane.tier}`;
    const clip = truncateWithEllipsis(label, BigInt(px.w) * 100n, 1000n);
    parts.push(`<text x="${pad + px.x + 4}" y="${pad + px.y + 14}" font-family="${SANS}" font-size="11" fill="#1f1f1f">${esc(clip)}</text>`);
    const scaleLabel = `${pane.scale.num}/${pane.scale.den}`;
    if (px.h > 30) {
      parts.push(`<text x="${pad + px.x + 4}" y="${pad + px.y + 26}" font-family="${MONO}" font-size="9" fill="#6b6b6b">scale ${esc(scaleLabel)}</text>`);
    }
    if (px.h > 44) {
      parts.push(`<text x="${pad + px.x + 4}" y="${pad + px.y + 38}" font-family="${MONO}" font-size="9" fill="#6b6b6b">${px.w}x${px.h}px</text>`);
    }
  }

  // Viewport centre.
  parts.push(`<circle cx="${pad + centre.x}" cy="${pad + centre.y}" r="3" fill="#2b5fa8"/>`);
  parts.push(`<text x="${pad + centre.x + 6}" y="${pad + centre.y + 4}" font-family="${MONO}" font-size="9" fill="#2b5fa8">C</text>`);

  // Focal anchor (default page centre).
  const focal = layout.panes[layout.focalIndex];
  if (focal) {
    const fx = pxFromCpt(focal.rect);
    const ax = pad + fx.x + Math.floor(fx.w / 2);
    const ay = pad + fx.y + Math.floor(fx.h / 2);
    parts.push(`<circle cx="${ax}" cy="${ay}" r="2" fill="#1a6b30"/>`);
    parts.push(`<text x="${ax + 5}" y="${ay + 3}" font-family="${MONO}" font-size="9" fill="#1a6b30">A</text>`);
  }

  const caption = `${viewportPx.name}: ${W}x${H}px · n=${layout.panes.length} · focal=${layout.focalIndex}`;
  parts.push(`<text x="${pad}" y="${pad + H + 18}" font-family="${MONO}" font-size="11" fill="#1f1f1f">${esc(caption)}</text>`);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${totalW}" height="${totalH}" viewBox="0 0 ${totalW} ${totalH}" role="img" aria-label="Layout ${layout.panes.length} panes on ${viewportPx.name}">${parts.join('')}</svg>`;
}

function lawsRow(layout, viewportPx) {
  const violations = [];
  // L1: rects inside viewport and disjoint (checked in cpt).
  const vpW = BigInt(viewportPx.w) * 75n;
  const vpH = BigInt(viewportPx.h) * 75n;
  for (let i = 0; i < layout.panes.length; i++) {
    const r = layout.panes[i].rect;
    if (r.x < 0n || r.y < 0n || r.x + r.w > vpW || r.y + r.h > vpH) violations.push(`L1 pane ${i} outside`);
    for (let j = i + 1; j < layout.panes.length; j++) {
      const s = layout.panes[j].rect;
      const overlap = !(r.x + r.w <= s.x || s.x + s.w <= r.x ||
                        r.y + r.h <= s.y || s.y + s.h <= r.y);
      if (overlap) violations.push(`L1 panes ${i},${j} overlap`);
    }
  }
  // L6: centre inside focal rect.
  const f = layout.panes[layout.focalIndex].rect;
  const cx = vpW / 2n;
  const cy = vpH / 2n;
  if (!(cx >= f.x && cx <= f.x + f.w && cy >= f.y && cy <= f.y + f.h)) violations.push('L6 centre outside focal');
  // L4: every pane effective body >= MIN_BODY (solver already refused otherwise).
  for (let i = 0; i < layout.panes.length; i++) {
    if (layout.panes[i].effectiveBodyCpt < 675n) violations.push(`L4 pane ${i} body too small`);
  }
  return { pass: violations.length === 0, violations };
}

function buildSingleDiagram(cards, viewportPx, { focalIndex = 0, weights } = {}) {
  const solved = solveForCards(cards, viewportPx, { focalIndex, weights });
  if (solved.error) {
    return {
      html: `<p class="fail">${esc(solved.error)}</p>`,
      json: { error: solved.error, law: solved.law || null, viewport: viewportPx },
      checks: [{ source: 'space:solve', name: `layout on ${viewportPx.name}`, pass: false, detail: solved.error }],
    };
  }
  const laws = lawsRow(solved.result, viewportPx);
  const svg = diagramSvg(solved.result, viewportPx);
  const util = utilPermille(solved.result, solved.viewportCpt);
  return {
    html: `<div class="card" style="max-width:${viewportPx.w + 16}px">${svg}</div>
<p class="muted">Utilisation ${util.num}/${util.den} permille.
${laws.violations.length === 0 ? 'All laws pass.' : 'Violations: ' + esc(laws.violations.join('; '))}</p>`,
    json: {
      viewport: viewportPx,
      panes: solved.result.panes.map((p) => ({
        originalIndex: p.originalIndex,
        rect: { x: p.rect.x.toString(), y: p.rect.y.toString(), w: p.rect.w.toString(), h: p.rect.h.toString() },
        shapeClass: p.shapeClass, tier: p.tier,
        scale: { num: p.scale.num.toString(), den: p.scale.den.toString() },
        effectiveBodyCpt: p.effectiveBodyCpt.toString(),
      })),
      focalIndex: solved.result.focalIndex,
      utilisationPermille: util,
      laws,
    },
    checks: [{ source: 'space:solve', name: `laws on ${viewportPx.name} (n=${solved.result.panes.length})`, pass: laws.pass, detail: laws.violations.join('; ') }],
  };
}

function utilPermille(layout, viewportCpt) {
  let usedNum = 0n;
  for (const p of layout.panes) usedNum += p.rect.w * p.rect.h;
  const total = viewportCpt.w * viewportCpt.h;
  // Integer util permille. Floor; deterministic.
  const permille = (usedNum * 1000n) / total;
  return { num: permille.toString(), den: '1000' };
}

export function buildSpaceSection() {
  // ---- (6) The layouts used by the report itself ----
  // Read section: three cards, 60/40.
  const readCards = [
    { type: 'balance_sheet' }, { type: 'income_statement' }, { type: 'cash_flow' },
  ];
  const readLayout = buildSingleDiagram(readCards, { name: 'laptop', w: 1280, h: 900 });

  // ---- (7) Layouts for n = 1..4 at three viewports ----
  const grid = [];
  const checks = [...readLayout.checks];
  for (const vp of VIEWPORTS) {
    for (let n = 1; n <= 4; n++) {
      const cards = ['balance_sheet', 'income_statement', 'cash_flow', 'trial_balance'].slice(0, n).map((t) => ({ type: t }));
      const built = buildSingleDiagram(cards, vp);
      grid.push(built);
      checks.push(...built.checks);
    }
  }
  // Read layout check goes in once.
  checks.unshift(...readLayout.checks);

  const allPassed = checks.every((c) => c.pass);
  const gridHtml = VIEWPORTS.map((vp) => {
    const cells = grid.filter((_, i) => Math.floor(i / 4) === VIEWPORTS.indexOf(vp));
    return `<h3>${esc(vp.name)} (${vp.w}x${vp.h})</h3><div class="grid grid-3">${cells.map((c) => `<div>${c.html}</div>`).join('')}</div>`;
  }).join('\n');

  const html = `
<p class="muted">Rectangles, shape classes, tiers and scale factors as solved
by <code>space/</code> at the moment the report ran. Blue rectangles are the
focal pane; the small circle <code>C</code> is the viewport centre; the small
circle <code>A</code> is the focal pane's anchor (default: page centre).
Utilisation is used-area / viewport-area in permille.</p>
<h3>Report read section</h3>
${readLayout.html}
<h3>n = 1..4 at three viewports</h3>
${gridHtml}`;

  const json = {
    read: readLayout.json,
    grid: grid.map((c) => c.json),
    allPassed,
  };

  return { html, json, checks, allPassed };
}
