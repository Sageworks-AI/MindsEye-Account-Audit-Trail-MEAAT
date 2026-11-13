// Level table: integer appearance values per level per theme, plus timing
// tokens. Validated by T1–T4 at module load; a bad table throws rather than
// silently rendering something illegible. The defaults live in
// attention/dist/levels.json and are loaded here; tests fuzz mutations of
// the table to prove validateLevels() rejects anything that violates a law.
//
// Contrast floors:
//   level 0: 7000 permille (7:1)
//   level 1: 4500 permille (4.5:1)
//   level 2: 3000 permille (3:1); rises to 4500 under prefers-contrast: more
//
// Themes: 'light' (fg dark on white bg) and 'dark' (fg light on dark bg).
// The foreground / background colours are part of the theme, not the level;
// each level blends its foreground toward its background by
// opacity * brightness / 1e6.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { levelContrastPermille } from './contrast.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

export const CONTRAST_FLOOR = Object.freeze({
  light: Object.freeze([7000, 4500, 3000]),
  dark:  Object.freeze([7000, 4500, 3000]),
});

export const CONTRAST_FLOOR_HIGH = Object.freeze({
  light: Object.freeze([7000, 4500, 4500]),
  dark:  Object.freeze([7000, 4500, 4500]),
});

const LEVEL_FIELDS = Object.freeze([
  'opacity', 'brightness', 'saturation', 'blur', 'shadow', 'radius',
]);

function requireInt(v, label, min, max) {
  if (!Number.isInteger(v) || v < min || v > max) {
    throw new Error(`${label}: must be an integer in [${min}, ${max}], got ${v}`);
  }
  return v;
}

function requireThemeLevel(table, theme, level) {
  const row = table[theme] && table[theme][level];
  if (!row || typeof row !== 'object') {
    throw new Error(`levels.${theme}[${level}] missing`);
  }
  for (const k of LEVEL_FIELDS) {
    if (!(k in row)) throw new Error(`levels.${theme}[${level}].${k} missing`);
    requireInt(row[k], `levels.${theme}[${level}].${k}`, 0, 1000);
  }
  if (row.blur !== 0) {
    // We do not currently ship a blur > 0 configuration; a non-zero blur
    // would require a compositor-cost decision. Keep this strict so a future
    // change is deliberate.
    throw new Error(`levels.${theme}[${level}].blur must be 0 (got ${row.blur})`);
  }
  return row;
}

function requireColor(v, label) {
  if (!v || typeof v !== 'object') throw new Error(`${label} missing`);
  for (const k of ['r', 'g', 'b']) {
    if (!Number.isInteger(v[k]) || v[k] < 0 || v[k] > 255) {
      throw new Error(`${label}.${k}: must be integer 0..255, got ${v[k]}`);
    }
  }
  return v;
}

// T1: opacity/brightness/saturation/shadow never increase with level;
//     blur never decreases with level.
// T2: opacity step between adjacent levels >= 100 permille.
// T3: effective contrast per level >= floor (per theme; per
//     prefers-contrast: more, level-2 floor rises to 4500).
// T4: no width / height / position fields (structurally enforced because
//     LEVEL_FIELDS is a closed list; extra fields are rejected).
export function validateLevels(raw, { prefersContrastMore = false } = {}) {
  if (!raw || typeof raw !== 'object') throw new Error('levels: not an object');
  if (raw.version !== 1) throw new Error('levels.version must be 1');
  const themes = ['light', 'dark'];
  const table = {};
  const colors = {};
  for (const theme of themes) {
    const t = raw.themes && raw.themes[theme];
    if (!t || typeof t !== 'object') throw new Error(`levels.themes.${theme} missing`);
    colors[theme] = {
      fg: requireColor(t.fg, `levels.themes.${theme}.fg`),
      bg: requireColor(t.bg, `levels.themes.${theme}.bg`),
    };
    table[theme] = [];
    for (let level = 0; level < 3; level++) {
      const row = requireThemeLevel(t, 'table', level);
      // Reject extra fields (T4 structural check).
      for (const k of Object.keys(row)) {
        if (!LEVEL_FIELDS.includes(k)) {
          throw new Error(`levels.themes.${theme}.table[${level}].${k} not allowed (T4)`);
        }
      }
      table[theme].push(Object.freeze({ ...row }));
    }
  }
  // T1 monotonicity.
  for (const theme of themes) {
    for (let level = 1; level < 3; level++) {
      const prev = table[theme][level - 1];
      const cur  = table[theme][level];
      if (cur.opacity    > prev.opacity)    throw new Error(`T1 ${theme} L${level} opacity > L${level - 1}`);
      if (cur.brightness > prev.brightness) throw new Error(`T1 ${theme} L${level} brightness > L${level - 1}`);
      if (cur.saturation > prev.saturation) throw new Error(`T1 ${theme} L${level} saturation > L${level - 1}`);
      if (cur.shadow     > prev.shadow)     throw new Error(`T1 ${theme} L${level} shadow > L${level - 1}`);
      if (cur.blur       < prev.blur)       throw new Error(`T1 ${theme} L${level} blur < L${level - 1}`);
      if (prev.opacity - cur.opacity < 100) {
        throw new Error(`T2 ${theme} opacity step L${level - 1}→L${level} is ` +
          `${prev.opacity - cur.opacity} < 100`);
      }
    }
  }
  // T3 contrast floors.
  const floors = prefersContrastMore ? CONTRAST_FLOOR_HIGH : CONTRAST_FLOOR;
  for (const theme of themes) {
    for (let level = 0; level < 3; level++) {
      const row = table[theme][level];
      const ratio = levelContrastPermille(colors[theme].fg, colors[theme].bg,
        row.opacity, row.brightness);
      if (ratio < floors[theme][level]) {
        throw new Error(`T3 ${theme} L${level} contrast ${ratio} < floor ${floors[theme][level]}`);
      }
    }
  }
  // Timing tokens.
  const timing = raw.timing;
  if (!timing || typeof timing !== 'object') throw new Error('levels.timing missing');
  const durations = timing.durationMs;
  if (!durations || typeof durations !== 'object') throw new Error('levels.timing.durationMs missing');
  for (const k of ['focus', 'inputBegin', 'inputEnd', 'transfer']) {
    requireInt(durations[k], `levels.timing.durationMs.${k}`, 0, 5000);
  }
  const easing = timing.easing;
  if (!easing || typeof easing !== 'object') throw new Error('levels.timing.easing missing');
  for (const k of ['x1', 'y1', 'x2', 'y2']) {
    requireInt(easing[k], `levels.timing.easing.${k}`, 0, 1000);
  }
  return Object.freeze({
    version: 1,
    themes: Object.freeze({
      light: Object.freeze({ fg: Object.freeze(colors.light.fg), bg: Object.freeze(colors.light.bg),
                             table: Object.freeze(table.light) }),
      dark:  Object.freeze({ fg: Object.freeze(colors.dark.fg),  bg: Object.freeze(colors.dark.bg),
                             table: Object.freeze(table.dark) }),
    }),
    timing: Object.freeze({
      durationMs: Object.freeze({ ...durations }),
      easing: Object.freeze({ ...easing }),
    }),
  });
}

export function loadLevels() {
  const raw = JSON.parse(readFileSync(join(HERE, '..', 'dist', 'levels.json'), 'utf8'));
  return validateLevels(raw);
}
