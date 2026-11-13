// Turns documents.json and metrics.json into flat int64 tables for the C
// ABI. The C++ side never parses JSON; the JS side never bakes constants
// twice. scripts/verify-space.mjs hashes this file together with the C++
// sources so a JSON edit that is not followed by a C++ rebuild is caught.
//
// Layouts are documented in space/ABI.md. Everything is BigInt so the caller
// can write directly into a BigInt64Array bound to the wasm memory.
import { loadDocuments, loadMetrics } from './reference/loader.mjs';

// Stable indices. Changing this array is a breaking ABI change: params.hpp
// and space/ABI.md must be updated together.
export const ARCHETYPE_IDS = Object.freeze([
  'balance_sheet_report_form',
  'balance_sheet_t_form',
  'income_statement',
  'cash_flow_statement',
  'trial_balance',
  'journal_voucher',
  'receipt_roll',
  'small_business_flowchart',
  'sequence_strip',
]);

export const SHAPE_INDEX = Object.freeze({
  FULL: 0, HALF: 1, QUARTER: 2, STRIP: 3,
});

// Cpt conversion: 1 pt = 100 cpt. All flat tables use cpt.
const PT_TO_CPT = 100n;

// Bakes the fields params.hpp needs: bodyCpt, leadingCpt, headerCpt,
// footerCpt, paginates, typicalRows, and 8 shape values (4 widths + 4
// heights in FULL,HALF,QUARTER,STRIP order, -1 for missing).
export function bakeArchetypes(docs = loadDocuments()) {
  const table = [];
  for (const id of ARCHETYPE_IDS) {
    const a = docs.archetypes[id];
    if (!a) throw new Error(`marshal: archetype ${id} missing from documents.json`);
    table.push(BigInt(a.typeScalePt.body) * PT_TO_CPT);
    table.push(BigInt(a.leadingPt) * PT_TO_CPT);
    table.push(BigInt(a.headerPt) * PT_TO_CPT);
    table.push(BigInt(a.footerPt) * PT_TO_CPT);
    table.push(a.paginates ? 1n : 0n);
    table.push(BigInt(a.typicalRows));
    // shapes: FULL, HALF, QUARTER, STRIP
    for (const shape of ['FULL', 'HALF', 'QUARTER', 'STRIP']) {
      const dims = a.shapeDimensions[shape];
      table.push(dims ? BigInt(dims.wPt) * PT_TO_CPT : -1n);
    }
    for (const shape of ['FULL', 'HALF', 'QUARTER', 'STRIP']) {
      const dims = a.shapeDimensions[shape];
      table.push(dims ? BigInt(dims.hPt) * PT_TO_CPT : -1n);
    }
  }
  return table;
}

// Bakes the advance tables. ASCII 0x20..0x7E; missing glyphs fall back. The
// family order and fallbacks are the fields metrics.hpp indexes by.
export function bakeMetrics(metrics = loadMetrics()) {
  const table = [];
  for (const family of ['sans', 'mono']) {
    const f = metrics[family];
    for (let cp = 0x20; cp <= 0x7E; cp++) {
      const ch = String.fromCharCode(cp);
      const w = f.charWidths[ch];
      table.push(BigInt(typeof w === 'number' ? w : f.fallback));
    }
    table.push(BigInt(f.fallback));
  }
  return table;
}

// A stable, deterministic fingerprint over both tables. Callers can embed
// this in a manifest or compare it between the JS twin and the wasm load to
// detect a mismatch early.
export function tablesFingerprint(docs = loadDocuments(), metrics = loadMetrics()) {
  const parts = [];
  for (const v of bakeArchetypes(docs)) parts.push(v.toString());
  for (const v of bakeMetrics(metrics)) parts.push(v.toString());
  return parts.join(',');
}
