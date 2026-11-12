// Loader validation for reference data. Rejecting bad archetypes is what
// keeps the reference corpus honest: a malformed archetype cannot silently
// produce a layout that violates L3/L4 later.
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import {
  loadDocuments, loadMetrics, validateDocuments, validateMetrics,
} from '../../space/index.mjs';

const DOCS = loadDocuments();
const METRICS = loadMetrics();

test('reference: documents.json loads with all required archetypes', () => {
  const required = [
    'balance_sheet_report_form', 'balance_sheet_t_form',
    'income_statement', 'cash_flow_statement', 'trial_balance',
    'journal_voucher', 'receipt_roll', 'small_business_flowchart',
    'sequence_strip',
  ];
  for (const id of required) {
    assert.ok(DOCS.archetypes[id], `missing archetype: ${id}`);
  }
});

test('reference: every archetype has all four shape classes', () => {
  for (const [id, arch] of Object.entries(DOCS.archetypes)) {
    if (id === 'sequence_strip') {
      assert.ok(arch.shapeDimensions.STRIP, `${id} needs STRIP`);
      continue;
    }
    for (const shape of ['FULL', 'HALF', 'QUARTER', 'STRIP']) {
      assert.ok(arch.shapeDimensions[shape], `${id} missing ${shape}`);
    }
  }
});

test('reference: archetypes are frozen', () => {
  assert.ok(Object.isFrozen(DOCS.archetypes));
  assert.ok(Object.isFrozen(DOCS.archetypes.balance_sheet_report_form));
});

test('reference: metrics has tabular digits in both families', () => {
  for (const family of ['sans', 'mono']) {
    const widths = new Set(['0','1','2','3','4','5','6','7','8','9'].map(
      (d) => METRICS[family].charWidths[d]));
    assert.equal(widths.size, 1, `${family}: digits must be equal width`);
  }
});

test('reference: validateDocuments rejects a missing archetype id', () => {
  const bad = JSON.parse(JSON.stringify({
    version: 1, archetypes: {
      x: {
        paper: 'A4', orientation: 'portrait',
        marginsPt: { top: 57, right: 57, bottom: 57, left: 57 },
        typeScalePt: { caption: 8, body: 10, label: 10, heading: 13, title: 14 },
        leadingPt: 12,
        columns: { labelSharePermille: 500, amountColumns: 1, minAmountWidthPt: 60 },
        typicalRows: 20, maxRows: 30, headerPt: 60, footerPt: 30,
        paginates: true, carryForward: 'subtotal',
        shapeDimensions: { FULL: { wPt: 595, hPt: 842 } },
      },
    },
  }));
  assert.throws(() => validateDocuments(bad), /id must match key/);
});

test('reference: validateDocuments rejects margins larger than the page', () => {
  const bad = JSON.parse(JSON.stringify(DOCS));
  // The validator expects a version: 1 wrapper on the raw object; our
  // frozen archetypes are already validated, so re-validate with mutated
  // margins via the raw json.
  bad.version = 1;
  bad.archetypes.balance_sheet_report_form.marginsPt.top = 500;
  bad.archetypes.balance_sheet_report_form.marginsPt.bottom = 500;
  assert.throws(() => validateDocuments(bad), /margins exceed .* height/);
});

test('reference: validateDocuments rejects non-integer body size', () => {
  const bad = JSON.parse(JSON.stringify(DOCS));
  bad.version = 1;
  bad.archetypes.income_statement.typeScalePt.body = 10.5;
  assert.throws(() => validateDocuments(bad), /must be an integer/);
});

test('reference: validateMetrics rejects unequal digit widths', () => {
  const bad = JSON.parse(JSON.stringify(METRICS));
  bad.version = 1;
  bad.sans.charWidths['0'] = 500;
  bad.sans.charWidths['1'] = 501;
  assert.throws(() => validateMetrics(bad), /tabular/);
});

test('reference: validateMetrics rejects unknown family digit mismatch', () => {
  const bad = JSON.parse(JSON.stringify(METRICS));
  bad.version = 1;
  bad.mono.charWidths['0'] = 100;
  bad.mono.charWidths['9'] = 200;
  assert.throws(() => validateMetrics(bad), /tabular/);
});
