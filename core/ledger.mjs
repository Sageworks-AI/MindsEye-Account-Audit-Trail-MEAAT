 // Append-only double-entry ledger. Entries are frozen and content-addressed
// (id = SHA-256 of the canonical body including prevHash), so tampering with
// any byte invalidates every later entry. Views filter without mutating;
// overlay appends an unposted draft for Input-mode preview.
//
// Corrected from the earlier PART 1 output: reverse() previously produced
// mirror lines that carried BOTH debit and credit fields (one being 0),
// which validateLine() rejects with "exactly one of debit/credit". The
// mirror now carries exactly the non-zero field; validateLine normalises the
// zero-field back in for the frozen entry.

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
    // Each mirrored line carries exactly the non-zero side. validateBody
    // normalises back to {debit, credit: 0} for the frozen entry, so the
    // stored shape matches a forward post exactly.
    const mirrored = original.lines.map((l) =>
      l.debit > 0
        ? { account: l.account, credit: l.debit }
        : { account: l.account, debit: l
