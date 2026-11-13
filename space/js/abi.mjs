// The same flat int64 ABI as space/cpp/api.cpp, implemented on top of the
// JS twin. This is the oracle for parity: scripts/gen-space-golden.mjs runs
// random inputs through this module and writes text vectors; the native
// C++ test runner replays those vectors and asserts identical output.
// test/space/parity.test.mjs does the same comparison in-process.
//
// Every function takes (scratch, inLen) and writes its output starting at
// scratch[inLen]. It returns the output length, or a negative error code.
// Callers must have written the input into scratch[0..inLen).
import { solve } from './solve.mjs';
import { apportion } from './apportion.mjs';
import { combineClaims } from './claim.mjs';
import { textWidth } from './metrics.mjs';
import { paginate } from './paginate.mjs';
import { anchorOffset } from './anchor.mjs';
import { loadDocuments, loadMetrics } from '../reference/loader.mjs';
import { bakeArchetypes, bakeMetrics, ARCHETYPE_IDS, SHAPE_INDEX } from '../marshal.mjs';

export const VERSION = 1n;
export const SCRATCH_SLOTS = 131072;

export const E_OK = 0;
export const E_BAD_VERSION = -1;
export const E_BAD_ARGUMENT = -2;
export const E_OVERFLOW = -3;
export const E_DIVIDE_BY_ZERO = -4;
export const E_OUTPUT_TOO_SMALL = -5;
export const E_NO_FEASIBLE_LAYOUT = -6;
export const E_PARTITION = -7;
export const E_PAGINATE = -8;
export const E_ARITHMETIC = -9;

// Pre-baked archetype and metrics tables. Loaded once so repeated calls do
// no JSON work and no file I/O; identical to what the wasm build reads from
// params.hpp and metrics.hpp (verify-space hashes those sources).
let archetypesCache = null;
let metricsCache = null;
function archetypes() {
  if (!archetypesCache) archetypesCache = { docs: loadDocuments(), table: bakeArchetypes() };
  return archetypesCache;
}
function metricsTbl() {
  if (!metricsCache) metricsCache = { docs: loadMetrics(), table: bakeMetrics() };
  return metricsCache;
}

// Field offsets in the baked archetype table. Must match params.hpp.
const ARCH_FIELDS = 16; // bodyCpt, leadingCpt, headerCpt, footerCpt, paginates, typicalRows, 4 wPt, 4 hPt

function archGet(idx, field) {
  return archetypes().table[idx * ARCH_FIELDS + field];
}

export function space_version() { return Number(VERSION); }
export function space_scratch_size() { return SCRATCH_SLOTS; }

function checkVersion(scratch) {
  if (scratch[0] !== VERSION) return E_BAD_VERSION;
  return E_OK;
}

// in  = [ V, family, fontSizeCpt, cpLen, cp0 .. cp(cpLen-1) ]
// out = [ V, widthCpt ]
export function space_measure_text(scratch, inLen) {
  if (inLen < 4) return E_BAD_ARGUMENT;
  const v = checkVersion(scratch); if (v !== E_OK) return v;
  const family = Number(scratch[1]);
  const fontSize = scratch[2];
  const cpLen = Number(scratch[3]);
  if (cpLen < 0 || cpLen > 256) return E_BAD_ARGUMENT;
  if (inLen !== 4 + cpLen) return E_BAD_ARGUMENT;
  if (family !== 0 && family !== 1) return E_BAD_ARGUMENT;
  const metrics = metricsTbl().docs;
  const famName = family === 0 ? 'sans' : 'mono';
  let text = '';
  for (let i = 0; i < cpLen; i++) {
    const cp = Number(scratch[4 + i]);
    if (cp < 0 || cp > 0x10FFFF) return E_BAD_ARGUMENT;
    text += String.fromCodePoint(cp);
  }
  let w;
  try { w = textWidth(text, fontSize, metrics, famName); }
  catch (e) { return e && /overflow/i.test(e.message) ? E_OVERFLOW : E_BAD_ARGUMENT; }
  if (inLen + 2 > SCRATCH_SLOTS) return E_OUTPUT_TOO_SMALL;
  scratch[inLen] = VERSION;
  scratch[inLen + 1] = w;
  return 2;
}

// in  = [ V, total, n, w0 .. wn-1 ]
// out = [ V, n, p0 .. pn-1 ]
export function space_apportion(scratch, inLen) {
  if (inLen < 3) return E_BAD_ARGUMENT;
  const v = checkVersion(scratch); if (v !== E_OK) return v;
  const total = scratch[1];
  const n = Number(scratch[2]);
  if (n < 1 || n > 32) return E_BAD_ARGUMENT;
  if (inLen !== 3 + n) return E_BAD_ARGUMENT;
  if (inLen + 2 + n > SCRATCH_SLOTS) return E_OUTPUT_TOO_SMALL;
  const weights = [];
  for (let i = 0; i < n; i++) weights.push(scratch[3 + i]);
  let parts;
  try { parts = apportion(total, weights); }
  catch (e) { return E_BAD_ARGUMENT; }
  scratch[inLen] = VERSION;
  scratch[inLen + 1] = BigInt(n);
  for (let i = 0; i < n; i++) scratch[inLen + 2 + i] = parts[i];
  return 2 + n;
}

// in  = [ V, op, a_7fields, a_shapes, b_7fields, b_shapes ]   (19 slots)
// out = [ V, minW,prefW,maxW,minH,prefH,maxH, rows, shapes ]  (9 slots)
export function space_claim_combine(scratch, inLen) {
  if (inLen !== 19) return E_BAD_ARGUMENT;
  const v = checkVersion(scratch); if (v !== E_OK) return v;
  const op = Number(scratch[1]);
  if (op < 0 || op > 2) return E_BAD_ARGUMENT;
  const a = {
    minW: scratch[2], prefW: scratch[3], maxW: scratch[4],
    minH: scratch[5], prefH: scratch[6], maxH: scratch[7],
    rowsUpperBound: Number(scratch[8]),
    allowedShapeClasses: shapeMaskToClasses(Number(scratch[9])),
  };
  const b = {
    minW: scratch[10], prefW: scratch[11], maxW: scratch[12],
    minH: scratch[13], prefH: scratch[14], maxH: scratch[15],
    rowsUpperBound: Number(scratch[16]),
    allowedShapeClasses: shapeMaskToClasses(Number(scratch[17])),
  };
  const opName = ['stack', 'sideBySide', 'overlay'][op];
  let c;
  try { c = combineClaims(opName, a, b); }
  catch (e) { return E_BAD_ARGUMENT; }
  if (inLen + 9 > SCRATCH_SLOTS) return E_OUTPUT_TOO_SMALL;
  scratch[inLen] = VERSION;
  scratch[inLen + 1] = c.minW;
  scratch[inLen + 2] = c.prefW;
  scratch[inLen + 3] = c.maxW;
  scratch[inLen + 4] = c.minH;
  scratch[inLen + 5] = c.prefH;
  scratch[inLen + 6] = c.maxH;
  scratch[inLen + 7] = BigInt(c.rowsUpperBound);
  scratch[inLen + 8] = BigInt(classesToShapeMask(c.allowedShapeClasses));
  return 9;
}

// in  = [ V, archetypeIdx, shapeClass, rows ]
// out = [ V, nPages, perPage, from0,to0, ... ]
export function space_paginate(scratch, inLen) {
  if (inLen !== 4) return E_BAD_ARGUMENT;
  const v = checkVersion(scratch); if (v !== E_OK) return v;
  const archIdx = Number(scratch[1]);
  const shapeClass = Number(scratch[2]);
  const rows = Number(scratch[3]);
  if (archIdx < 0 || archIdx >= ARCHETYPE_IDS.length) return E_BAD_ARGUMENT;
  if (shapeClass < 0 || shapeClass > 3) return E_BAD_ARGUMENT;
  if (rows < 0) return E_BAD_ARGUMENT;
  const shapeName = ['FULL', 'HALF', 'QUARTER', 'STRIP'][shapeClass];
  const archetype = archetypes().docs.archetypes[ARCHETYPE_IDS[archIdx]];
  const hCpt = archGet(archIdx, 6 + 4 + shapeClass); // 0-based shapeH field
  if (hCpt <= 0n) return E_BAD_ARGUMENT;
  const leadingCpt = archGet(archIdx, 1);
  const headerCpt = archGet(archIdx, 2);
  const footerCpt = archGet(archIdx, 3);
  const paginates = archGet(archIdx, 4) === 1n;
  // Twin paginate() takes pt-level archetype; convert cpt back for the call.
  const archetypeInPt = {
    ...archetype,
    leadingPt: Number(leadingCpt / 100n),
    headerPt: Number(headerCpt / 100n),
    footerPt: Number(footerCpt / 100n),
    paginates,
    shapeDimensions: {
      ...archetype.shapeDimensions,
      [shapeName]: { wPt: Number(archGet(archIdx, 6 + shapeClass) / 100n), hPt: Number(hCpt / 100n) },
    },
  };
  const r = paginate({ rows, shapeClass: shapeName, archetype: archetypeInPt });
  if (r.error) return E_PAGINATE;
  const outLen = 3 + r.pages.length * 2;
  if (inLen + outLen > SCRATCH_SLOTS) return E_OUTPUT_TOO_SMALL;
  scratch[inLen] = VERSION;
  scratch[inLen + 1] = BigInt(r.pages.length);
  scratch[inLen + 2] = BigInt(r.perPage);
  for (let i = 0; i < r.pages.length; i++) {
    scratch[inLen + 3 + i * 2] = BigInt(r.pages[i].from);
    scratch[inLen + 3 + i * 2 + 1] = BigInt(r.pages[i].to);
  }
  return outLen;
}

// in  = [ V, oX,oY,oW,oH, oNum,oDen, aPageX,aPageY,
//            nX,nY,nW,nH, nNum,nDen, tolCpt, vpW, vpH ]
// out = [ V, offX, offY ]
export function space_anchor(scratch, inLen) {
  if (inLen !== 18) return E_BAD_ARGUMENT;
  const v = checkVersion(scratch); if (v !== E_OK) return v;
  const oldRect = { x: scratch[1], y: scratch[2], w: scratch[3], h: scratch[4] };
  const oldScale = { num: scratch[5], den: scratch[6] };
  const apx = scratch[7], apy = scratch[8];
  const newRect = { x: scratch[9], y: scratch[10], w: scratch[11], h: scratch[12] };
  const newScale = { num: scratch[13], den: scratch[14] };
  const tol = scratch[15];
  if (oldScale.den <= 0n || newScale.den <= 0n || tol < 0n) return E_BAD_ARGUMENT;
  let r;
  try { r = anchorOffset(oldRect, oldScale, apx, apy, newRect, newScale, tol); }
  catch (e) { return E_OVERFLOW; }
  if (inLen + 3 > SCRATCH_SLOTS) return E_OUTPUT_TOO_SMALL;
  scratch[inLen] = VERSION;
  scratch[inLen + 1] = r.offX;
  scratch[inLen + 2] = r.offY;
  return 3;
}

// in  = [ V, vpW, vpH, nPanes, per pane: archetypeIdx, isBar, rowsUpper, weight,
//         (optional tail) gutter, focalOrigIdx ]
// out = [ V, nGeomPanes, focalOrigIdx, per geom pane: origIdx, x,y,w,h, shapeClass,
//         tier, sNum,sDen, effectiveBodyCpt, nPages, nPages*[from,to] ]
export function space_solve(scratch, inLen) {
  if (inLen < 4) return E_BAD_ARGUMENT;
  const v = checkVersion(scratch); if (v !== E_OK) return v;
  const vpW = scratch[1], vpH = scratch[2];
  const nPanes = Number(scratch[3]);
  if (nPanes < 0 || nPanes > 8) return E_BAD_ARGUMENT;
  const baseLen = 4 + nPanes * 4;
  let gutter = 600n;
  let focalOrig = 0;
  if (inLen === baseLen + 2) { gutter = scratch[baseLen]; focalOrig = Number(scratch[baseLen + 1]); }
  else if (inLen !== baseLen) return E_BAD_ARGUMENT;

  const panes = [];
  for (let i = 0; i < nPanes; i++) {
    const aIdx = Number(scratch[4 + i * 4]);
    const isBar = Number(scratch[4 + i * 4 + 1]);
    const rows = Number(scratch[4 + i * 4 + 2]);
    const weight = Number(scratch[4 + i * 4 + 3]);
    if (aIdx < 0 || aIdx >= ARCHETYPE_IDS.length) return E_BAD_ARGUMENT;
    if (isBar !== 0 && isBar !== 1) return E_BAD_ARGUMENT;
    if (rows < 0) return E_BAD_ARGUMENT;
    if (weight < 0) return E_BAD_ARGUMENT;
    panes.push({ archetypeId: ARCHETYPE_IDS[aIdx], isBar: isBar === 1, rowsUpper: rows, weight });
  }

  // Build the archetype objects the twin expects (in cpt BigInt form).
  const archetypesForSolve = {};
  for (let idx = 0; idx < ARCHETYPE_IDS.length; idx++) {
    archetypesForSolve[ARCHETYPE_IDS[idx]] = twinArchetypeFromBaked(idx);
  }
  let result;
  try { result = solve({ w: vpW, h: vpH }, panes, {
    archetypes: archetypesForSolve, gutter, focalIndex: focalOrig,
  }); }
  catch (e) { return E_BAD_ARGUMENT; }
  if (result.error) return mapSolveError(result);

  const focalIdxOut = result.focalIndex;
  let outLen = 3;
  for (const p of result.panes) outLen += 11 + p.pagination.length * 2;
  if (inLen + outLen > SCRATCH_SLOTS) return E_OUTPUT_TOO_SMALL;
  scratch[inLen] = VERSION;
  scratch[inLen + 1] = BigInt(result.panes.length);
  scratch[inLen + 2] = BigInt(focalIdxOut);
  let p = inLen + 3;
  for (const pane of result.panes) {
    scratch[p++] = BigInt(pane.originalIndex);
    scratch[p++] = pane.rect.x; scratch[p++] = pane.rect.y;
    scratch[p++] = pane.rect.w; scratch[p++] = pane.rect.h;
    scratch[p++] = BigInt(SHAPE_INDEX[pane.shapeClass]);
    scratch[p++] = BigInt(pane.tier === 'summary' ? 0 : pane.tier === 'standard' ? 1 : 2);
    scratch[p++] = pane.scale.num; scratch[p++] = pane.scale.den;
    scratch[p++] = pane.effectiveBodyCpt;
    scratch[p++] = BigInt(pane.pagination.length);
    for (const pg of pane.pagination) {
      scratch[p++] = BigInt(pg.from);
      scratch[p++] = BigInt(pg.to);
    }
  }
  return outLen;
}

function mapSolveError(result) {
  const msg = result.error || '';
  if (/L1|L6|partition/i.test(msg)) return E_PARTITION;
  if (/L4|MIN_BODY|too small/i.test(msg)) return E_NO_FEASIBLE_LAYOUT;
  if (/L11|paginate/i.test(msg)) return E_PAGINATE;
  if (/unknown archetype|must be|unknown/i.test(msg)) return E_BAD_ARGUMENT;
  return E_BAD_ARGUMENT;
}

function twinArchetypeFromBaked(idx) {
  const dims = {};
  const shapeNames = ['FULL', 'HALF', 'QUARTER', 'STRIP'];
  for (let s = 0; s < 4; s++) {
    const wCpt = archGet(idx, 6 + s);
    const hCpt = archGet(idx, 6 + 4 + s);
    if (wCpt <= 0n || hCpt <= 0n) continue;
    dims[shapeNames[s]] = { wPt: Number(wCpt / 100n), hPt: Number(hCpt / 100n) };
  }
  return {
    id: ARCHETYPE_IDS[idx],
    typeScalePt: { body: Number(archGet(idx, 0) / 100n) },
    leadingPt: Number(archGet(idx, 1) / 100n),
    headerPt: Number(archGet(idx, 2) / 100n),
    footerPt: Number(archGet(idx, 3) / 100n),
    paginates: archGet(idx, 4) === 1n,
    typicalRows: Number(archGet(idx, 5)),
    shapeDimensions: dims,
  };
}

function shapeMaskToClasses(mask) {
  const out = [];
  if (mask & 1) out.push('FULL');
  if (mask & 2) out.push('HALF');
  if (mask & 4) out.push('QUARTER');
  if (mask & 8) out.push('STRIP');
  return out;
}
function classesToShapeMask(classes) {
  let m = 0;
  for (const c of classes) m |= (c === 'FULL' ? 1 : c === 'HALF' ? 2 : c === 'QUARTER' ? 4 : 8);
  return m;
}
