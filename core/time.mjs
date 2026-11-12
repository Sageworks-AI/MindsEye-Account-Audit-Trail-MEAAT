// Real-calendar date validation and Tick ordering. Ticks are { date, seq };
// dates alone cannot order two entries on the same day, so seq breaks ties.
// Never trust a JS Date constructed from user input: regex then UTC round-trip.

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isValidDate(str) {
  if (typeof str !== 'string') return false;
  const m = DATE_RE.exec(str);
  if (!m) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y &&
         dt.getUTCMonth() === mo - 1 &&
         dt.getUTCDate() === d;
}

export function validateDate(str, label = 'date') {
  if (!isValidDate(str)) {
    throw new Error(`${label} is not a real calendar date in YYYY-MM-DD form: ${str}`);
  }
  return str;
}

export function makeTick(date, seq) {
  validateDate(date);
  if (!Number.isSafeInteger(seq) || seq < 1) {
    throw new Error(`seq must be a positive safe integer, got ${String(seq)}`);
  }
  return Object.freeze({ date, seq });
}

export function compareTick(a, b) {
  if (a.date < b.date) return -1;
  if (a.date > b.date) return 1;
  if (a.seq < b.seq) return -1;
  if (a.seq > b.seq) return 1;
  return 0;
}

export function tickEQ(a, b) { return compareTick(a, b) === 0; }
export function tickLT(a, b) { return compareTick(a, b) < 0; }
export function tickLE(a, b) { return compareTick(a, b) <= 0; }

// Sentinels for "before any entry on this date" and "after any entry on this
// date". seq 0 and MAX_SAFE_INTEGER are outside the ledger's real range so
// they act as pure bounds; they never appear in a stored entry.
export function startOfDay(date) {
  validateDate(date);
  return Object.freeze({ date, seq: 0 });
}

export function endOfDay(date) {
  validateDate(date);
  return Object.freeze({ date, seq: Number.MAX_SAFE_INTEGER });
}

export function addDays(date, n) {
  validateDate(date);
  if (!Number.isSafeInteger(n)) throw new Error('n must be an integer');
  const m = DATE_RE.exec(date);
  const dt = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + n));
  const yyyy = String(dt.getUTCFullYear()).padStart(4, '0');
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

export function prevDay(date) { return addDays(date, -1); }

// Calendar-quarter helper used by command.mjs (S3). "Q1 of Y" = Y-01-01..Y-03-31.
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
