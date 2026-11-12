// Chart of accounts validation. Accounts are plain frozen data; nothing here
// mutates the input. Types are the five that exist in a plain double-entry
// chart. Cash accounts must be assets. `cf` is the direct-method cash-flow
// class, required only on accounts that participate in cash flow.

const TYPES = new Set(['asset', 'liability', 'equity', 'revenue', 'expense']);
const CF_CLASSES = new Set(['operating', 'investing', 'financing']);
const NATURAL = {
  asset: 'debit', liability: 'credit', equity: 'credit',
  revenue: 'credit', expense: 'debit',
};

export function naturalSide(type) {
  const s = NATURAL[type];
  if (!s) throw new Error(`unknown account type: ${type}`);
  return s;
}

// Natural-signed balance. Debit-normal accounts (asset, expense) show
// debit-credit; credit-normal accounts show credit-debit. This is what every
// card uses so a negative amount is unambiguous (contra) and totals add up.
export function naturalBalance(type, debit, credit) {
  return naturalSide(type) === 'debit' ? debit - credit : credit - debit;
}

export function validateAccounts(input) {
  if (!Array.isArray(input) || input.length === 0) {
    throw new Error('accounts must be a non-empty array');
  }
  const seen = new Set();
  const list = [];
  for (const acct of input) {
    if (!acct || typeof acct !== 'object') {
      throw new Error('account entry must be an object');
    }
    const { code, name, type, cash, cf } = acct;
    if (typeof code !== 'string' || !code) throw new Error(`bad account code: ${String(code)}`);
    if (seen.has(code)) throw new Error(`duplicate account code: ${code}`);
    seen.add(code);
    if (typeof name !== 'string' || !name) throw new Error(`account ${code}: name required`);
    if (!TYPES.has(type)) throw new Error(`account ${code}: bad type "${type}"`);
    if (cash !== undefined && typeof cash !== 'boolean') {
      throw new Error(`account ${code}: cash must be boolean`);
    }
    if (cash === true && type !== 'asset') {
      throw new Error(`account ${code}: cash accounts must be assets`);
    }
    if (cf !== undefined && !CF_CLASSES.has(cf)) {
      throw new Error(`account ${code}: bad cf class "${cf}"`);
    }
    list.push(Object.freeze({
      code, name, type,
      cash: cash === true,
      cf: cf || undefined,
    }));
  }
  list.sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));
  const byCode = Object.create(null);
  for (const a of list) byCode[a.code] = a;
  return Object.freeze({ list: Object.freeze(list), byCode: Object.freeze(byCode) });
}
