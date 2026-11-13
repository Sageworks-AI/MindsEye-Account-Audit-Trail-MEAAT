// Event shape, type list, and validation. Events are frozen objects whose
// only required field is `type`; other fields depend on the type. Shape
// validation happens here so the state machine can assume well-formed
// events and focus on law enforcement.

export const EVENT_TYPES = Object.freeze([
  'OPEN',
  'CLOSE',
  'FOCUS',
  'INPUT_BEGIN',
  'INPUT_END',
  'TRANSFER_COPY',
  'TRANSFER_PASTE',
  'TRANSFER_CANCEL',
  'BACK',
  'RESIZE',
]);

export const FOCUS_SOURCES = Object.freeze(['pointer', 'keyboard', 'command', 'programmatic']);
export const INPUT_CHANNELS = Object.freeze(['text', 'voice', 'document']);
export const INPUT_OUTCOMES = Object.freeze(['commit', 'cancel']);

// Payload kinds from the transfer matrix (Addendum B). Not all are used in
// S7; the list is here so validation is identical when S13 exercises them.
export const TRANSFER_PAYLOAD_KINDS = Object.freeze([
  'entry', 'rows', 'row', 'period', 'node',
]);
export const TRANSFER_OUTCOME_KINDS = Object.freeze([
  'impact', 'draft-entry', 'draft-lines', 'trail-edit', 'period-change',
]);

function requireString(v, label) {
  if (typeof v !== 'string' || !v) throw new Error(`${label} must be a non-empty string`);
  return v;
}

function requireEnum(v, label, allowed) {
  if (!allowed.includes(v)) {
    throw new Error(`${label} must be one of ${allowed.join(', ')} (got "${v}")`);
  }
  return v;
}

function requireInt(v, label) {
  if (!Number.isSafeInteger(v) || v < 0) {
    throw new Error(`${label} must be a non-negative safe integer`);
  }
  return v;
}

export function makeEvent(spec) {
  if (!spec || typeof spec !== 'object') throw new Error('event must be an object');
  const type = spec.type;
  if (!EVENT_TYPES.includes(type)) throw new Error(`unknown event type: ${type}`);

  switch (type) {
    case 'OPEN': {
      const actor = spec.actor;
      if (!actor || typeof actor !== 'object') throw new Error('OPEN.actor required');
      requireString(actor.id, 'OPEN.actor.id');
      requireEnum(actor.kind, 'OPEN.actor.kind', ['DOC', 'FORM', 'TRAIL']);
      // BAR cannot be opened by OPEN; it is added only by INPUT_BEGIN.
      return Object.freeze({ type, actor: Object.freeze({ id: actor.id, kind: actor.kind }) });
    }
    case 'CLOSE': {
      const id = requireString(spec.id, 'CLOSE.id');
      return Object.freeze({ type, id });
    }
    case 'FOCUS': {
      const id = requireString(spec.id, 'FOCUS.id');
      const source = requireEnum(spec.source, 'FOCUS.source', FOCUS_SOURCES);
      if (source === 'pointer') {
        const pe = spec.pointerEpoch;
        requireInt(pe, 'FOCUS.pointerEpoch');
        return Object.freeze({ type, id, source, pointerEpoch: pe });
      }
      return Object.freeze({ type, id, source });
    }
    case 'INPUT_BEGIN': {
      const channel = spec.channel !== undefined
        ? requireEnum(spec.channel, 'INPUT_BEGIN.channel', INPUT_CHANNELS)
        : 'text';
      return Object.freeze({ type, channel });
    }
    case 'INPUT_END': {
      const outcome = requireEnum(spec.outcome, 'INPUT_END.outcome', INPUT_OUTCOMES);
      return Object.freeze({ type, outcome });
    }
    case 'TRANSFER_COPY': {
      const sourceId = requireString(spec.sourceId, 'TRANSFER_COPY.sourceId');
      const payloadKind = requireEnum(spec.payloadKind, 'TRANSFER_COPY.payloadKind',
        TRANSFER_PAYLOAD_KINDS);
      return Object.freeze({ type, sourceId, payloadKind });
    }
    case 'TRANSFER_PASTE': {
      const targetId = requireString(spec.targetId, 'TRANSFER_PASTE.targetId');
      const outcomeKind = requireEnum(spec.outcomeKind, 'TRANSFER_PASTE.outcomeKind',
        TRANSFER_OUTCOME_KINDS);
      return Object.freeze({ type, targetId, outcomeKind });
    }
    case 'TRANSFER_CANCEL':
    case 'BACK':
    case 'RESIZE':
      return Object.freeze({ type });
  }
  throw new Error(`unhandled event type: ${type}`);
}
