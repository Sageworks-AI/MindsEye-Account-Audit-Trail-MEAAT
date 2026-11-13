// The committed app/src/styles/attention.css must equal a fresh emit from
// attention/dist/levels.json. A drift means someone edited the CSS by hand
// (forbidden by rule 15) or changed levels.json without re-running
// `npm run emit:attention-css`.
//
// A static scan also rejects any hand-written `opacity`, `filter`,
// `brightness`, `saturate`, `blur` or `shadow` in app/src/ (other than the
// generated CSS and tokens.css).
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';
import { emitCss } from '../../attention/emitCss.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const CSS_PATH = join(ROOT, 'app', 'src', 'styles', 'attention.css');
const TOKENS_PATH = join(ROOT, 'app', 'src', 'styles', 'tokens.css');

test('css-drift: committed attention.css equals a fresh emit', () => {
  assert.ok(existsSync(CSS_PATH),
    `missing ${CSS_PATH}; run \`npm run emit:attention-css\``);
  const current = readFileSync(CSS_PATH, 'utf8');
  const fresh = emitCss();
  assert.equal(current, fresh,
    'app/src/styles/attention.css is out of date; run `npm run emit:attention-css`');
});

test('css-drift: app/src has no hand-written appearance values outside generated CSS', () => {
  const violations = [];
  function walk(dir) {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      const st = statSync(full);
      if (st.isDirectory()) { walk(full); continue; }
      if (!full.endsWith('.css')) continue;
      if (full === CSS_PATH) continue;   // generated
      if (full === TOKENS_PATH) continue; // tokens.css is allowed
      const text = readFileSync(full, 'utf8');
      for (const m of text.matchAll(/(?<!var\()\b(opacity|brightness|saturate|blur|filter|shadow)\s*:/g)) {
        violations.push(`${relative(ROOT, full)}: "${m[1]}"`);
      }
    }
  }
  const srcDir = join(ROOT, 'app', 'src');
  if (existsSync(srcDir)) walk(srcDir);
  assert.deepEqual(violations, [],
    `hand-written appearance values outside attention.css: ${violations.join(', ')}`);
});
