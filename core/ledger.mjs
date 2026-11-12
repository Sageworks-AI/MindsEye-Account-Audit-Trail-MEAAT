// Append-only double-entry ledger. Entries are frozen and content-addressed
// (id = SHA-256 of the canonical body including prevHash), so tampering with
// any byte invalidates every later entry. Views filter without mutating;
// overlay appends an unposted draft for Input-mode preview.

import {
  DEFAULT_CURRENCY, addMinor, assertMinor,
} from './money.mjs';
import {
  validateDate, compareTick,
} from './time.mjs';
import { hashEntryBody, GENESIS_HASH } from './hash.mjs';
import { validateAccounts, naturalBalance } from './accounts.mjs';

function validateLine(line, byCode) {
  if (!line || typeof line !== 'object') throw new Error('line must be an object');
  const { account, debit, credit } = line;
  if (typeof account !== 'string' || !byCode[account]) {
    throw new Error(`unknown account: ${String(account)}`);
  }
  const hasD = debit !== undefined && debit !== null;
  const hasC = credit !== undefined && credit !== null;
  if (hasD && hasC) throw new Error(`line on ${account}: exactly one of debit/credit`);
  if (!hasD && !hasC) throw new Error(`line on ${account}: need debit or credit`);
  const amount = hasD ? debit : credit;
  assertMinor(amount, `${account} amount`);
  if (amount < 0) throw new Error(`${account}: negative amount`);
  return { account, debit: hasD ? amount : 0, credit: hasC ? amount : 0 };
}

function validateBody(body, byCode) {
  if (!body || typeof body !== 'object') throw new Error('draft must be an object');
  validateDate(body.date, 'date');
  if (typeof body.memo !== 'string' || !body.memo) throw new Error('memo required');
  if (!Array.isArray(body.lines) || body.lines.length < 2) {
    throw new Error('at least 2 lines required');
  }
  const lines = body.lines.map((l) => validateLine(l, byCode));
  let debits = 0;
  let credits = 0;
  for (const l of lines) {
    debits = addMinor(debits, l.debit, 'debits');
    credits = addMinor(credits, l.credit, 'credits');
  }
  if (debits !== credits) {
    throw new Error(`unbalanced entry: debits=${debits} credits=${credits}`);
  }
  if (debits === 0) throw new Error('entry has zero value');
  if (body.refs !== undefined) {
    if (!body.refs || typeof body.refs !== 'object' || Array.isArray(body.refs)) {
      throw new Error('refs must be a plain object');
    }
    for (const k of Object.keys(body.refs)) {
      const v = body.refs[k];
      if (!k) throw new Error('refs key must be non-empty');
      const t = typeof v;
      if (t !== 'string' && t !== 'number' && t !== 'boolean') {
        throw new Error(`refs.${k}: unsupported value type`);
      }
    }
  }
  return {
    date: body.date, memo: body.memo, lines,
    ...(body.refs !== undefined ? { refs: { ...body.refs } } : {}),
  };
}

function freezeEntry(e) {
  return Object.freeze({
    seq: e.seq, id: e.id, prevHash: e.prevHash,
    date: e.date, memo: e.memo,
    lines: Object.freeze(e.lines.map((l) => Object.freeze({
      account: l.account, debit: l.debit, credit: l.credit,
    }))),
    ...(e.reverses !== undefined ? { reverses: e.reverses } : {}),
    ...(e.refs !== undefined ? { refs: Object.freeze({ ...e.refs }) } : {}),
  });
}

function hashBodyOf(body, { reverses, prevHash, seq }) {
  const hb = {
    seq, prevHash, date: body.date, memo: body.memo,
    lines: body.lines.map((l) => ({ account: l.account, debit: l.debit, credit: l.credit })),
  };
  if (reverses !== undefined) hb.reverses = reverses;
  if (body.refs !== undefined) hb.refs = body.refs;
  return hb;
}

export class Ledger {
  #accounts;
  #currency;
  #entries = [];
  #head = { seq: 0, hash: GENESIS_HASH };
  #byId = new Map();
  #reversedSeqs = new Set();
  #reversalSeqs = new Set();

  constructor({ accounts, currency = DEFAULT_CURRENCY } = {}) {
    this.#accounts = validateAccounts(accounts);
    this.#currency = Object.freeze({ ...currency });
  }

  get accounts() { return this.#accounts; }
  get currency() { return this.#currency; }
  get size() { return this.#entries.length; }

  head() { return { seq: this.#head.seq, hash: this.#head.hash }; }

  getEntry(seq) {
    const e = this.#entries[seq - 1];
    if (!e) throw new Error(`no entry with seq ${seq}`);
    return e;
  }

  byId(id) {
    const e = this.#byId.get(id);
    if (!e) throw new Error(`no entry with id ${id}`);
    return e;
  }

  // Resolve a user-supplied reference: integer = seq, non-empty string = id.
  resolveRef(ref) {
    if (Number.isSafeInteger(ref) && ref >= 1) return this.getEntry(ref);
    if (typeof ref === 'string' && ref.length > 0) return this.byId(ref);
    throw new Error(`cannot resolve entry reference: ${String(ref)}`);
  }

  tickOf(seq) {
    const e = this.getEntry(seq);
    return Object.freeze({ date: e.date, seq: e.seq });
  }

  entries() { return Object.freeze(this.#entries.slice()); }

  post(draft) {
    if (draft && draft.reverses !== undefined) {
      throw new Error('use reverse() to post a reversal');
    }
    const body = validateBody(draft, this.#accounts.byCode);
    return this.#append(body, undefined);
  }

  reverse(seq, { date, memo } = {}) {
    if (!Number.isSafeInteger(seq) || seq < 1) throw new Error('seq must be a positive integer');
    if (this.#reversedSeqs.has(seq)) throw new Error(`entry ${seq} already reversed`);
    if (this.#reversalSeqs.has(seq)) throw new Error(`cannot reverse a reversal (entry ${seq})`);
    const original = this.getEntry(seq);
    if (typeof memo !== 'string' || !memo) throw new Error('reversal memo required');
    validateDate(date, 'reversal date');
    if (date < original.date) throw new Error('reversal date cannot precede the original');
    const mirrored = original.lines.map((l) => ({
      account: l.account, debit: l.credit, credit: l.debit,
    }));
    const body = validateBody({ date, memo, lines: mirrored }, this.#accounts.byCode);
    const entry = this.#append(body, seq);
    this.#reversedSeqs.add(seq);
    this.#reversalSeqs.add(entry.seq);
    return entry;
  }

  #append(body, reversesSeq) {
    const seq = this.#entries.length + 1;
    const prevHash = this.#head.hash;
    const hb = hashBodyOf(body, { reverses: reversesSeq, prevHash, seq });
    const id = hashEntryBody(hb);
    const entry = freezeEntry({
      seq, id, prevHash, date: body.date, memo: body.memo,
      lines: body.lines, reverses: reversesSeq, refs: body.refs,
    });
    this.#entries.push(entry);
    this.#byId.set(id, entry);
    this.#head = { seq, hash: id };
    return entry;
  }

  verify() {
    let prevHash = GENESIS_HASH;
    for (let i = 0; i < this.#entries.length; i++) {
      const e = this.#entries[i];
      const expectedSeq = i + 1;
      if (e.seq !== expectedSeq) {
        return { ok: false, firstBroken: e.seq, reason: `seq mismatch (expected ${expectedSeq})` };
      }
      if (e.prevHash !== prevHash) {
        return { ok: false, firstBroken: e.seq, reason: 'prevHash mismatch' };
      }
      const hb = {
        seq: e.seq, prevHash: e.prevHash, date: e.date, memo: e.memo,
        lines: e.lines.map((l) => ({ account: l.account, debit: l.debit, credit: l.credit })),
      };
      if (e.reverses !== undefined) hb.reverses = e.reverses;
      if (e.refs !== undefined) hb.refs = e.refs;
      if (hashEntryBody(hb) !== e.id) {
        return { ok: false, firstBroken: e.seq, reason: 'id mismatch (tampered)' };
      }
      prevHash = e.id;
    }
    return { ok: true, head: { seq: this.#head.seq, hash: this.#head.hash } };
  }

  view(opts = {}) { return new LedgerView(this, opts); }
}

// Read-only filter view. asOfSeq bounds by seq; excludeSeq drops one seq;
// overlay appends an unposted draft with a synthetic seq beyond the current
// head. Views never mutate the parent; each derived view is independent.
export class LedgerView {
  #parent;
  #asOfSeq;
  #excludeSeq;
  #overlay;
  #cached;

  constructor(parent, { asOfSeq, excludeSeq, overlay } = {}) {
    this.#parent = parent;
    if (asOfSeq !== undefined && (!Number.isSafeInteger(asOfSeq) || asOfSeq < 0)) {
      throw new Error('asOfSeq must be a non-negative integer');
    }
    if (excludeSeq !== undefined && (!Number.isSafeInteger(excludeSeq) || excludeSeq < 1)) {
      throw new Error('excludeSeq must be a positive integer');
    }
    this.#asOfSeq = asOfSeq;
    this.#excludeSeq = excludeSeq;
    this.#overlay = overlay || null;
  }

  get accounts() { return this.#parent.accounts; }
  get currency() { return this.#parent.currency; }
  head() { return this.#parent.head(); }

  entries() {
    if (this.#cached) return this.#cached;
    const out = [];
    for (const e of this.#parent.entries()) {
      if (this.#asOfSeq !== undefined && e.seq > this.#asOfSeq) break;
      if (this.#excludeSeq !== undefined && e.seq === this.#excludeSeq) continue;
      out.push(e);
    }
    if (this.#overlay) {
      const syntheticSeq = (this.#asOfSeq ?? out.length) + 1;
      const lines = (this.#overlay.lines || []).map((l) => Object.freeze({
        account: l.account,
        debit: typeof l.debit === 'number' ? l.debit : 0,
        credit: typeof l.credit === 'number' ? l.credit : 0,
      }));
      out.push(Object.freeze({
        ...this.#overlay, seq: syntheticSeq,
        lines: Object.freeze(lines),
      }));
    }
    this.#cached = Object.freeze(out);
    return this.#cached;
  }

  getEntry(seq) {
    const e = this.entries().find((x) => x.seq === seq);
    if (!e) throw new Error(`no entry with seq ${seq} in view`);
    return e;
  }

  // View composition. Only one excludeSeq is supported; impact only needs one.
  exclude(seq) {
    if (this.#excludeSeq !== undefined && this.#excludeSeq !== seq) {
      throw new Error(`view already excludes ${this.#excludeSeq}`);
    }
    return new LedgerView(this.#parent, {
      asOfSeq: this.#asOfSeq, excludeSeq: seq, overlay: this.#overlay,
    });
  }

  // Scan-based filters; entry order is not assumed (backdated posts are legal).
  entriesInRange(fromTick, toTick) {
    const out = [];
    for (const e of this.entries()) {
      const t = { date: e.date, seq: e.seq };
      if (compareTick(t, fromTick) < 0) continue;
      if (compareTick(t, toTick) > 0) continue;
      out.push(e);
    }
    return out;
  }

  entriesUpTo(tick) {
    const out = [];
    for (const e of this.entries()) {
      if (compareTick({ date: e.date, seq: e.seq }, tick) <= 0) out.push(e);
    }
    return out;
  }

  balancesAt(tick) {
    return this.#sumEntries(this.entriesUpTo(tick));
  }

  rangeByAccount(fromTick, toTick) {
    return this.#sumEntries(this.entriesInRange(fromTick, toTick));
  }

  #sumEntries(entries) {
    const byAccount = Object.create(null);
    for (const e of entries) {
      for (const l of e.lines) {
        const acct = this.accounts.byCode[l.account];
        if (!acct) throw new Error(`unknown account on entry ${e.seq}: ${l.account}`);
        const b = byAccount[l.account] || { debit: 0, credit: 0, balance: 0 };
        b.debit = addMinor(b.debit, l.debit);
        b.credit = addMinor(b.credit, l.credit);
        b.balance = naturalBalance(acct.type, b.debit, b.credit);
        byAccount[l.account] = b;
      }
    }
    return byAccount;
  }
}
