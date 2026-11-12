// Lane assignment by event type. Lanes are the BinFlow idea: a small fixed
// set of channels that aggregate cleanly. Addendum A adds "space"; Addendum
// B adds "attention". Any type without an explicit entry falls to a
// prefix-based rule; unknown types are rejected so a typo cannot silently
// create a new lane.

const EXPLICIT = {
  'entry.posted': 'journal',
  'entry.reversed': 'journal',
  'journal.verified': 'journal',

  'request.received': 'request',
  'card.opened': 'request',
  'card.closed': 'request',
  'mode.changed': 'request',
  'period.changed': 'request',
  'draft.previewed': 'request',

  'card.hit': 'cache',
  'card.miss': 'cache',
  'card.built': 'cache',

  'impact.computed': 'check',
  'check.failed': 'check',

  'trail.node.added': 'trail',
  'trail.link.added': 'trail',
  'trail.saved': 'trail',
};

export const LANES = Object.freeze([
  'journal', 'request', 'cache', 'trail', 'check', 'space', 'attention',
]);

export function laneFor(type) {
  if (type.startsWith('space.')) return 'space';
  if (type.startsWith('attention.')) return 'attention';
  const lane = EXPLICIT[type];
  if (!lane) throw new Error(`no lane for event type: ${type}`);
  return lane;
}
