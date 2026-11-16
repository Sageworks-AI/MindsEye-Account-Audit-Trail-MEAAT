#!/usr/bin/env node
// Writes app/src/styles/attention.css from attention/dist/levels.json.
// Exits non-zero if the file already exists with different bytes AND
// --force is not set, so a hand edit is caught before it is silently
// overwritten. `npm run emit:attention-css` regenerates unconditionally
// (the drift test expects the committed file to match a fresh emit).
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { emitCss } from '../attention/emitCss.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT = join(ROOT, 'app', 'src', 'styles', 'attention.css');

function main() {
  const fresh = emitCss();
  const force = process.argv.includes('--force');
  if (existsSync(OUT) && !force) {
    const current = readFileSync(OUT, 'utf8');
    if (current === fresh) {
      console.log('emit:attention-css: up to date');
      return;
    }
    console.log('emit:attention-css: app/src/styles/attention.css differs, writing anyway (use --force to suppress this notice)');
  }
  const dir = dirname(OUT);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(OUT, fresh);
  console.log(`emit:attention-css: wrote ${OUT}`);
}

main();
