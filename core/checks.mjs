// A check is { name, pass, detail? }. Cards carry arrays of checks; ok is
// true only when every check passes. `npm run report` exits non-zero when any
// card's ok is false, so a failing check is a hard signal.

export function makeCheck(name, pass, detail) {
  if (typeof name !== 'string' || !name) throw new Error('check name required');
  const c = { name, pass: pass === true };
  if (detail !== undefined) c.detail = String(detail);
  return Object.freeze(c);
}

export function allPass(checks) {
  if (!Array.isArray(checks)) return false;
  for (const c of checks) if (!c.pass) return false;
  return true;
}
