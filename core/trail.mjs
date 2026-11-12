// Trail model: a saved view over the ledger, never a write to it. Nodes are
// (entry, line) pairs; links are directed edges with a basis. Derivation
// helpers return arrays of proposed links; the caller decides which to accept.
// Reconciliation: signed sum of terminal nodes equals the trail's target.
import { compareTick } from './time.mjs';

const BASES = new Set(['same_entry', 'same_account', 'reversal', 'same_ref', 'manual']);
const KINDS = new Set(['derived', 'drawn']);

export function makeNode(entry, lineIndex) {
  const line = entry.lines[lineIndex];
  if (!line) throw new Error(`no line ${lineIndex} in entry ${entry.seq}`);
  return Object.freeze({
    id: `n_${entry.seq}_${lineIndex}`,
    seq: entry.seq,
    lineIndex,
    account: line.account,
    side: line.debit > 0 ? 'debit' : 'credit',
    amount: line.debit > 0 ? line.debit : line.credit,
    date: entry.date,
  });
}

export function signedAmount(node) {
  return node.side === 'debit' ? node.amount : -node.amount;
}

export function createTrail({ id, name }) {
  if (!id || typeof id !== 'string') throw new Error('trail id required');
  if (!name || typeof name !== 'string') throw new Error('trail name required');
  return Object.freeze({ id, name, nodes: Object.freeze([]), links: Object.freeze([]) });
}

export function addNode(trail, node) {
  if (trail.nodes.some((n) => n.id === node.id)) return trail;
  return Object.freeze({ ...trail, nodes: Object.freeze([...trail.nodes, node]) });
}

export function addLink(trail, link) {
  if (link.from === link.to) return trail;
  if (!BASES.has(link.basis)) throw new Error(`bad basis: ${link.basis}`);
  if (!KINDS.has(link.kind))  throw new Error(`bad kind: ${link.kind}`);
  if (trail.links.some((l) => l.from === link.from && l.to === link.to)) return trail;
  return Object.freeze({ ...trail, links: Object.freeze([...trail.links, link]) });
}

export function setTarget(trail, target) {
  return Object.freeze({ ...trail, target });
}

export function deriveSameEntryLinks(entries) {
  const links = [];
  for (const e of entries) {
    for (let i = 0; i < e.lines.length; i++) {
      for (let j = i + 1; j < e.lines.length; j++) {
        links.push({
          from: `n_${e.seq}_${i}`, to: `n_${e.seq}_${j}`,
          kind: 'derived', basis: 'same_entry',
        });
      }
    }
  }
  return links;
}

export function deriveSameAccountLinks(entries) {
  const byAccount = Object.create(null);
  for (const e of entries) {
    e.lines.forEach((line, i) => {
      (byAccount[line.account] = byAccount[line.account] || [])
        .push({ seq: e.seq, lineIndex: i, date: e.date });
    });
  }
  const links = [];
  for (const code of Object.keys(byAccount)) {
    const list = byAccount[code].sort((a, b) => {
      const c = compareTick(
        { date: a.date, seq: a.seq }, { date: b.date, seq: b.seq });
      return c !== 0 ? c : a.lineIndex - b.lineIndex;
    });
    for (let i = 0; i + 1 < list.length; i++) {
      links.push({
        from: `n_${list[i].seq}_${list[i].lineIndex}`,
        to:   `n_${list[i + 1].seq}_${list[i + 1].lineIndex}`,
        kind: 'derived', basis: 'same_account', note: code,
      });
    }
  }
  return links;
}

export function deriveReversalLinks(entries) {
  const bySeq = new Map(entries.map((e) => [e.seq, e]));
  const links = [];
  for (const e of entries) {
    if (e.reverses === undefined) continue;
    const orig = bySeq.get(e.reverses);
    if (!orig) continue;
    for (let i = 0; i < orig.lines.length; i++) {
      const ol = orig.lines[i];
      for (let j = 0; j < e.lines.length; j++) {
        const rl = e.lines[j];
        if (rl.account === ol.account && rl.debit === ol.credit && rl.credit === ol.debit) {
          links.push({
            from: `n_${orig.seq}_${i}`, to: `n_${e.seq}_${j}`,
            kind: 'derived', basis: 'reversal',
          });
        }
      }
    }
  }
  return links;
}

export function deriveRefLinks(entries) {
  const byRef = Object.create(null);
  for (const e of entries) {
    if (!e.refs) continue;
    for (const k of Object.keys(e.refs)) {
      const key = `${k}=${String(e.refs[k])}`;
      (byRef[key] = byRef[key] || []).push(e);
    }
  }
  const links = [];
  for (const key of Object.keys(byRef)) {
    const list = byRef[key].slice().sort((a, b) => compareTick(
      { date: a.date, seq: a.seq }, { date: b.date, seq: b.seq }));
    for (let i = 0; i + 1 < list.length; i++) {
      const a = list[i];
      const b = list[i + 1];
      if (a.lines.length === 0 || b.lines.length === 0) continue;
      links.push({
        from: `n_${a.seq}_0`, to: `n_${b.seq}_0`,
        kind: 'derived', basis: 'same_ref', note: key,
      });
    }
  }
  return links;
}

export function validateTrail(trail, view) {
  const checks = [];
  const ids = new Set();
  let nodesReal = true;
  for (const node of trail.nodes) {
    if (ids.has(node.id)) {
      checks.push({ name: `trail: duplicate node ${node.id}`, pass: false });
      continue;
    }
    ids.add(node.id);
    try {
      const entry = view.getEntry(node.seq);
      const line = entry.lines[node.lineIndex];
      if (!line) throw new Error('no line at that index');
      if (line.account !== node.account) throw new Error('account mismatch');
      const side = line.debit > 0 ? 'debit' : 'credit';
      if (side !== node.side) throw new Error('side mismatch');
      const amount = line.debit > 0 ? line.debit : line.credit;
      if (amount !== node.amount) throw new Error('amount mismatch');
    } catch (e) {
      nodesReal = false;
      checks.push({
        name: `trail: node ${node.id} references a real line`,
        pass: false, detail: e.message,
      });
    }
  }
  checks.push({ name: 'trail: all nodes reference real entry lines', pass: nodesReal });

  const seen = new Set();
  let noDupLinks = true;
  let allForward = true;
  for (const link of trail.links) {
    if (!ids.has(link.from) || !ids.has(link.to)) { noDupLinks = false; continue; }
    const key = `${link.from}->${link.to}`;
    if (seen.has(key)) noDupLinks = false;
    seen.add(key);
    const a = trail.nodes.find((n) => n.id === link.from);
    const b = trail.nodes.find((n) => n.id === link.to);
    if (a && b && compareTick(
      { date: a.date, seq: a.seq }, { date: b.date, seq: b.seq }) > 0) {
      allForward = false;
    }
  }
  checks.push({ name: 'trail: no duplicate links', pass: noDupLinks });
  checks.push({ name: 'trail: links run forward in (date, seq)', pass: allForward });

  if (trail.target !== undefined) {
    const outgoing = new Set(trail.links.map((l) => l.from));
    let sum = 0;
    for (const node of trail.nodes) if (!outgoing.has(node.id)) sum += signedAmount(node);
    checks.push({
      name: 'trail: terminal sum reconciles to target',
      pass: sum === trail.target,
      detail: `sum=${sum} target=${trail.target}`,
    });
  }

  return { ok: checks.every((c) => c.pass), checks };
}
