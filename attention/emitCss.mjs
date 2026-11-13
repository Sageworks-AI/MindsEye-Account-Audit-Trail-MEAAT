// Deterministic CSS emitter. attention/dist/levels.json is the source of
// truth; this module produces app/src/styles/attention.css byte-for-byte
// the same every run. Nothing here depends on the environment or clock.
//
// The output must remain a plain text file that a browser can load. Values
// are converted to CSS units: opacity/brightness/saturation are permille ->
// unitless (880 -> 0.88); blur is in cpt (1/100 pt) and CSS wants px
// (75 cpt per px); shadow/radius are also cpt. The generated file carries a
// header comment with the SHA-256 of the levels JSON so drift is visible.
import { loadLevels } from './js/levels.mjs';
import { createHash } from 'node:crypto';

const CPT_PER_PX = 75;
const CPT_PER_100 = 100;

function hashLevels(levels) {
  // Stable stringify: sort object keys at every level. Levels is already
  // frozen and canonical, but hashing the pretty-printed form makes the
  // header human-readable.
  return createHash('sha256').update(stableStringify(levels)).digest('hex');
}

function stableStringify(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(stableStringify).join(',') + ']';
  const keys = Object.keys(v).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + stableStringify(v[k])).join(',') + '}';
}

function permilleToNumber(p) { return (p / 1000).toString(); }
function cptToPx(c) { return (c / CPT_PER_PX).toString(); }
function cptToPx100(c) { return (c / CPT_PER_100).toString(); }

export function emitCss({ levels } = {}) {
  const L = levels || loadLevels();
  const sha = hashLevels(L);
  const lines = [];
  lines.push('/* attention.css — generated from attention/dist/levels.json.');
  lines.push(` * levels.json sha256: ${sha}`);
  lines.push(' * Do not edit by hand. Run `npm run emit:attention-css` to regenerate. */');
  lines.push('');
  lines.push('@property --att-opacity    { syntax: "<number>"; inherits: true; initial-value: 1; }');
  lines.push('@property --att-brightness { syntax: "<number>"; inherits: true; initial-value: 1; }');
  lines.push('@property --att-saturation { syntax: "<number>"; inherits: true; initial-value: 1; }');
  lines.push('@property --att-blur       { syntax: "<length>"; inherits: true; initial-value: 0px; }');
  lines.push('@property --att-shadow     { syntax: "<length>"; inherits: true; initial-value: 0px; }');
  lines.push('@property --att-radius     { syntax: "<length>"; inherits: true; initial-value: 0px; }');
  lines.push('');
  for (const theme of ['light', 'dark']) {
    const t = L.themes[theme];
    for (let lvl = 0; lvl < 3; lvl++) {
      const r = t.table[lvl];
      lines.push(`:root[data-theme="${theme}"] [data-att="${lvl}"] {`);
      lines.push(`  --att-opacity: ${permilleToNumber(r.opacity)};`);
      lines.push(`  --att-brightness: ${permilleToNumber(r.brightness)};`);
      lines.push(`  --att-saturation: ${permilleToNumber(r.saturation)};`);
      lines.push(`  --att-blur: ${cptToPx(r.blur)}px;`);
      lines.push(`  --att-shadow: ${cptToPx100(r.shadow)}px;`);
      lines.push(`  --att-radius: ${cptToPx100(r.radius)}px;`);
      lines.push('  opacity: var(--att-opacity);');
      lines.push('  filter: brightness(var(--att-brightness)) saturate(var(--att-saturation)) blur(var(--att-blur));');
      lines.push('  border-radius: var(--att-radius);');
      lines.push('}');
    }
  }
  const d = L.timing.durationMs;
  const e = L.timing.easing;
  const easing = `cubic-bezier(${(e.x1/1000)}, ${(e.y1/1000)}, ${(e.x2/1000)}, ${(e.y2/1000)})`;
  lines.push('');
  lines.push('[data-att] {');
  lines.push(`  transition: opacity ${d.focus}ms ${easing}, filter ${d.focus}ms ${easing};`);
  lines.push('}');
  lines.push('');
  lines.push('@media (prefers-reduced-motion: reduce) {');
  lines.push('  [data-att] { transition: none !important; }');
  lines.push('}');
  lines.push('');
  lines.push('@media (prefers-contrast: more) {');
  lines.push('  :root[data-theme] [data-att="2"] { --att-opacity: 0.88; filter: brightness(0.94) saturate(0.9); }');
  lines.push('}');
  lines.push('');
  lines.push('@media (forced-colors: active) {');
  lines.push('  [data-att] { filter: none !important; opacity: 1 !important; }');
  lines.push('  [data-att="2"] { outline: 1px dashed currentColor; }');
  lines.push('}');
  lines.push('');
  return lines.join('\n');
}
