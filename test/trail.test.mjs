// Trail model: derivation proposes plausible links between lines; validation
// checks nodes reference real lines, no duplicate nodes, no duplicate links,
// forward time order, and reconciliation against a target. A failing check
// returns ok:false; the caller decides whether to accept.
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import {
  makeNode, createTrail, addNode, addLink, setTarget,
  deriveSameEntryLinks, deriveSameAccountLinks, deriveReversalLinks,
  deriveRefLinks, validateTrail, signedAmount,
} from '../core/trail.mjs';
import { buildDemoLedger } from './fixtures/ledger.mjs';

test('trail: makeNode extracts side and amount from an entry line', () => {
  const l = buildDemoLedger();
  const e3 = l.getEntry(3);
  const n = makeNode(e3, 0);
  assert.equal(n.seq, 3);
  assert.equal(n.lineIndex, 0);
  assert.equal(n.account, '1100');
  assert.equal(n.side, 'debit');
  assert.equal(n.amount, 8000);
  assert.equal(n.date, '2026-02-15');
});

test('trail: addNode is idempotent for the same (entry, line)', () => {
  const l = buildDemoLedger();
  const e3 = l.getEntry(3);
  const n = makeNode(e3, 0);
  let t = createTrail({ id: 't1', name: 'test' });
  t = addNode(t, n);
  t = addNode(t, n);
  assert.equal(t.nodes.length, 1);
});

test('trail: deriveSameEntryLinks proposes links between lines of one entry', () => {
  const l = buildDemoLedger();
  const links = deriveSameEntryLinks(l.entries());
  // Entry 3 has 2 lines -> 1 pair.
  const e3Links = links.filter((x) => x.from.startsWith('n_3_'));
  assert.equal(e3Links.length, 1);
  assert.equal(e3Links[0].basis, 'same_entry');
});

test('trail: deriveSameAccountLinks chains same-account lines in time order', () => {
  const l = buildDemoLedger();
  const links = deriveSameAccountLinks(l.entries());
  const cashLinks = links.filter((x) => x.note === '1000');
  assert.ok(cashLinks.length >= 2);
  // Forward in time: each link's "from" node seq must be less than or equal to "to".
  for (const link of cashLinks) {
    const fromSeq = Number(link.from.split('_')[1]);
    const toSeq = Number(link.to.split('_')[1]);
    assert.ok(fromSeq <= toSeq, `link ${link.from} -> ${link.to}`);
  }
});

test('trail: deriveReversalLinks connects reversal to original', () => {
  const l = buildDemoLedger();
  const links = deriveReversalLinks(l.entries());
  // Entry 7 reverses entry 6 (loan drawdown). Two lines -> two links.
  assert.equal(links.length, 2);
  for (const link of links) {
    assert.equal(link.basis, 'reversal');
    assert.ok(link.from.startsWith('n_6_'));
    assert.ok(link.to.startsWith('n_7_'));
  }
});

test('trail: deriveRefLinks connects entries sharing a refs value', () => {
  const l = buildDemoLedger();
  const links = deriveRefLinks(l.entries());
  // INV-1 on entries 3 and 4 -> one link.
  const inv = links.filter((x) => x.note && x.note.startsWith('invoice=INV-1'));
  assert.equal(inv.length, 1);
  assert.equal(inv[0].basis, 'same_ref');
  assert.ok(inv[0].from.startsWith('n_3_'));
  assert.ok(inv[0].to.startsWith('n_4_'));
});

test('trail: reconciliation passes when terminal sum matches target', () => {
  const l = buildDemoLedger();
  const e3 = l.getEntry(3);
  const e4 = l.getEntry(4);
  let t = createTrail({ id: 't2', name: 'INV-1' });
  t = addNode(t, makeNode(e3, 0)); // AR debit 8000
  t = addNode(t, makeNode(e4, 1)); // AR credit 8000
  t = addLink(t, {
    from: 'n_3_0', to: 'n_4_1',
    kind: 'derived', basis: 'same_ref', note: 'invoice=INV-1',
  });
  // Terminal is n_4_1 (AR credit 8000, signed = -8000). Target = -8000.
  t = setTarget(t, -8000);
  const result = validateTrail(t, l.view());
  assert.equal(result.ok, true, JSON.stringify(result.checks));
});

test('trail: reconciliation fails when terminal sum differs from target', () => {
  const l = buildDemoLedger();
  const e3 = l.getEntry(3);
  const e4 = l.getEntry(4);
  let t = createTrail({ id: 't3', name: 'bad' });
  t = addNode(t, makeNode(e3, 0));
  t = addNode(t, makeNode(e4, 1));
  t = addLink(t, {
    from: 'n_3_0', to: 'n_4_1',
    kind: 'derived', basis: 'same_ref',
  });
  t = setTarget(t, -1); // wrong target
  const result = validateTrail(t, l.view());
  assert.equal(result.ok, false);
  assert.ok(result.checks.some((c) => !c.pass && /terminal sum/.test(c.name)));
});

test('trail: node referencing a nonexistent line is caught', () => {
  const l = buildDemoLedger();
  let t = createTrail({ id: 't4', name: 'phantom' });
  t = addNode(t, Object.freeze({
    id: 'n_999_0', seq: 999, lineIndex: 0,
    account: '1000', side: 'debit', amount: 1, date: '2026-01-01',
  }));
  const result = validateTrail(t, l.view());
  assert.equal(result.ok, false);
  assert.ok(result.checks.some((c) => !c.pass && /real line/.test(c.name)));
});

test('trail: link with backward time order warns', () => {
  const l = buildDemoLedger();
  const e3 = l.getEntry(3);
  const e4 = l.getEntry(4);
  let t = createTrail({ id: 't5', name: 'backward' });
  t = addNode(t, makeNode(e3, 0));
  t = addNode(t, makeNode(e4, 1));
  t = addLink(t, {
    from: 'n_4_1', to: 'n_3_0', // later -> earlier
    kind: 'manual', basis: 'manual',
  });
  const result = validateTrail(t, l.view());
  assert.equal(result.ok, false);
  assert.ok(result.checks.some((c) => !c.pass && /forward/.test(c.name)));
});

test('trail: signedAmount is positive on debit, negative on credit', () => {
  const l = buildDemoLedger();
  const e3 = l.getEntry(3);
  assert.equal(signedAmount(makeNode(e3, 0)), 8000);   // debit
  assert.equal(signedAmount(makeNode(e3, 1)), -8000);  // credit
});
