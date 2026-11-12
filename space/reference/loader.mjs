// Loads and validates documents.json and metrics.json. Rejects missing
// fields, non-integers, and margins larger than the page. Values are
// reference defaults, not legal standards (see space/README.md). Returned
// objects are frozen so callers cannot mutate shared state.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));

const PAPER_DIMS = Object.freeze({
  A3: { wPt: 842, hPt: 1191 },
  A4: { wPt: 595, hPt: 842 },
  A5: { wPt: 420, hPt: 595 },
  'US-Letter': { wPt: 612, hPt: 792 },
  '80mm-roll': { wPt: 227, hPt: null }, // variable length
  '58mm-roll': { wPt: 164, hPt: null },
  screen: { wPt: null, hPt: null },
});

const SHAPE_CLASSES = new Set(['FULL', 'HALF', 'QUARTER', 'STRIP']);
const ORIENTATIONS = new Set(['portrait', 'landscape']);

function req(obj, key, label) {
  if (!obj || typeof obj !== 'object') throw new Error(`${label}: not an object`);
  if (!(key in obj)) throw new Error(`${label}: missing field "${key}"`);
  return obj[key];
}

function reqInt(obj, key, label, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const v = req(obj, key, label);
  if (!Number.isInteger(v) || v < min || v > max) {
    throw new Error(`${label}.${key}: must be an integer in [${min}, ${max}], got ${v}`);
  }
  return v;
}

function reqObj(obj, key, label) {
  const v = req(obj, key, label);
  if (!v || typeof v !== 'object' || Array.isArray(v)) {
    throw new Error(`${label}.${key}: must be a plain object`);
  }
  return v;
}

export function validateDocuments(raw) {
  if (!raw || typeof raw !== 'object') throw new Error('documents: not an object');
  if (reqInt(raw, 'version', 'documents', { min: 1 }) !== 1) {
    throw new Error('documents.version must be 1');
  }
  const arches = reqObj(raw, 'archetypes', 'documents');
  const out = {};
  for (const id of Object.keys(arches)) {
    const a = arches[id];
    const label = `documents.archetypes.${id}`;
    if (req(a, 'id', label) !== id) throw new Error(`${label}.id must match key`);
    const paper = req(a, 'paper', label);
    if (!(paper in PAPER_DIMS)) throw new Error(`${label}.paper unknown: ${paper}`);
    const orientation = req(a, 'orientation', label);
    if (!ORIENTATIONS.has(orientation)) throw new Error(`${label}.orientation invalid`);
    const margins = reqObj(a, 'marginsPt', label);
    const m = {
      top: reqInt(margins, 'top', `${label}.marginsPt`),
      right: reqInt(margins, 'right', `${label}.marginsPt`),
      bottom: reqInt(margins, 'bottom', `${label}.marginsPt`),
      left: reqInt(margins, 'left', `${label}.marginsPt`),
    };
    const ts = reqObj(a, 'typeScalePt', label);
    const typeScale = {
      caption: reqInt(ts, 'caption', `${label}.typeScalePt`),
      body:    reqInt(ts, 'body',    `${label}.typeScalePt`),
      label:   reqInt(ts, 'label',   `${label}.typeScalePt`),
      heading: reqInt(ts, 'heading', `${label}.typeScalePt`),
      title:   reqInt(ts, 'title',   `${label}.typeScalePt`),
    };
    const cols = reqObj(a, 'columns', label);
    const columns = {
      labelSharePermille: reqInt(cols, 'labelSharePermille', `${label}.columns`, { min: 0, max: 1000 }),
      amountColumns:      reqInt(cols, 'amountColumns',      `${label}.columns`, { min: 0, max: 4 }),
      minAmountWidthPt:   reqInt(cols, 'minAmountWidthPt',   `${label}.columns`),
    };
    const shapeDims = reqObj(a, 'shapeDimensions', label);
    const shapeDimensions = {};
    for (const shape of Object.keys(shapeDims)) {
      if (!SHAPE_CLASSES.has(shape)) throw new Error(`${label}.shapeDimensions: unknown class ${shape}`);
      const d = shapeDims[shape];
      shapeDimensions[shape] = {
        wPt: reqInt(d, 'wPt', `${label}.shapeDimensions.${shape}`, { min: 1 }),
        hPt: reqInt(d, 'hPt', `${label}.shapeDimensions.${shape}`, { min: 1 }),
      };
    }
    // Reject if margins exceed the smallest declared shape page — the page
    // would have no drawing area.
    for (const [shape, dims] of Object.entries(shapeDimensions)) {
      if (m.top + m.bottom >= dims.hPt) {
        throw new Error(`${label}: margins exceed ${shape} height`);
      }
      if (m.left + m.right >= dims.wPt) {
        throw new Error(`${label}: margins exceed ${shape} width`);
      }
    }
    out[id] = Object.freeze({
      id, paper, orientation, marginsPt: m, typeScalePt: typeScale,
      leadingPt: reqInt(a, 'leadingPt', label),
      columns,
      typicalRows: reqInt(a, 'typicalRows', label),
      maxRows:     reqInt(a, 'maxRows', label, { min: 1 }),
      headerPt:    reqInt(a, 'headerPt', label),
      footerPt:    reqInt(a, 'footerPt', label),
      paginates:   req(a, 'paginates', label) === true,
      carryForward: (() => {
        const v = req(a, 'carryForward', label);
        if (v !== 'subtotal' && v !== 'none') throw new Error(`${label}.carryForward invalid`);
        return v;
      })(),
      shapeDimensions: Object.freeze(shapeDimensions),
    });
  }
  return Object.freeze({ version: 1, archetypes: Object.freeze(out) });
}

export function validateMetrics(raw) {
  if (!raw || typeof raw !== 'object') throw new Error('metrics: not an object');
  if (reqInt(raw, 'version', 'metrics', { min: 1 }) !== 1) throw new Error('metrics.version must be 1');
  const out = {};
  for (const key of ['sans', 'mono']) {
    const s = reqObj(raw, key, 'metrics');
    const widths = reqObj(s, 'charWidths', `metrics.${key}`);
    const charWidths = Object.freeze({ ...widths });
    for (const ch of Object.keys(charWidths)) {
      const v = charWidths[ch];
      if (!Number.isInteger(v) || v < 0 || v > 4000) {
        throw new Error(`metrics.${key}.charWidths["${ch}"]: must be a non-negative integer <= 4000`);
      }
    }
    // Verify tabular digits are all equal width.
    const digitWidths = new Set(['0','1','2','3','4','5','6','7','8','9'].map((d) => charWidths[d]));
    if (digitWidths.size > 1) {
      throw new Error(`metrics.${key}: digits must be tabular (equal width)`);
    }
    out[key] = Object.freeze({
      charWidths,
      fallback: reqInt(s, 'fallback', `metrics.${key}`, { min: 1, max: 4000 }),
    });
  }
  return Object.freeze({ version: 1, ...out });
}

export function loadDocuments() {
  const raw = JSON.parse(readFileSync(join(HERE, 'documents.json'), 'utf8'));
  return validateDocuments(raw);
}

export function loadMetrics() {
  const raw = JSON.parse(readFileSync(join(HERE, 'metrics.json'), 'utf8'));
  return validateMetrics(raw);
}

export { PAPER_DIMS, SHAPE_CLASSES };
