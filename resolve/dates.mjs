// Calendar-date helpers for the resolver. Deliberately duplicated from
// core/time.mjs: resolve must not import core internals except through the
// schema bridge, and dates are pure functions of their inputs (no journal
// access), so a byte-identical copy with a parity test is simpler than a
// second file-level exemption. Parity is checked in
// test/resolve/dates.test.mjs over seeded dates.
//
// No imports.

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isValidDate(str) {
  if (typeof str !== 'string') return false;
  const m = DATE_RE.exec(str);
  if (!m) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return false;
  // UTC round-trip catches fake dates like 2026-02-31.
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y &&
         dt.getUTCMonth() === mo - 1 &&
         dt.getUTCDate() === d;
}

export function quarterRange(quarter, year) {
  if (!Number.isInteger(quarter) || quarter < 1 || quarter > 4) {
    throw new Error(`quarter must be 1..4, got ${quarter}`);
  }
  if (!Number.isInteger(year) || year < 1 || year > 9999) {
    throw new Error(`year must be 1..9999, got ${year}`);
  }
  const fromMonth = (quarter - 1) * 3 + 1;
  const toMonth = quarter * 3;
  const yyyy = String(year).padStart(4, '0');
  const from = `${yyyy}-${String(fromMonth).padStart(2, '0')}-01`;
  const to = `${yyyy}-${String(toMonth).padStart(2, '0')}-${daysInMonth(year, toMonth)}`;
  return { from, to };
}

function daysInMonth(year, month) {
  // Date.UTC(year, month, 0) is the last day of `month` (1-indexed).
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}
