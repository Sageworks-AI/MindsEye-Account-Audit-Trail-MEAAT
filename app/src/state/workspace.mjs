// Pure workspace state and actions. No React, no DOM, no fetch. Used by
// App.jsx through a small reducer-style hook (useWorkspace) but testable on
// its own.
//
// The workspace tracks:
//   mode:       'read' | 'input' | 'trail'
//   request:    the current request (validated by resolve/request.mjs's shape)
//   cardMap:    actorId -> { type, params }  (what the ring's DOC actors map to)
//   period:     { from, to, asOf? } — shared across all cards
//   focus:      entryId | null (impact view)
//   entryId:    entryId | null (receipt view)
//   compare:    { from, to } | null
//   viewport:   { w, h } (pixels; updated on window resize)
//   requestId:  increments on every state change that should re-fetch
//
// Every action returns a new state; nothing mutates. The App component
// dispatches actions and, when requestId changes, effects call the API.
import { validateRequest } from '../../resolve/request.mjs';

export const MODES = Object.freeze(['read', 'input', 'trail']);

export function createInitialState({ today } = {}) {
  // today default: the demo period, so a fresh clone shows cards instead of
  // an empty screen. The user can scrub.
  const ymd = today || '2026-03-31';
  const [y] = ymd.split('-');
  const from = `${y}-01-01`;
  const to = ymd;
  return Object.freeze({
    mode: 'read',
    request: Object.freeze({
      cards: [
        { type: 'balance_sheet', params: {} },
        { type: 'cash_flow', params: {} },
      ],
      period: { from, to },
      mode: 'read',
    }),
    cardMap: Object.freeze({
      'card:balance_sheet': { type: 'balance_sheet', params: {} },
      'card:cash_flow':     { type: 'cash_flow', params: {} },
    }),
    period: Object.freeze({ from, to }),
    focus: null,
    entryId: null,
    compare: null,
    viewport: { w: 1280, h: 720 },
    requestId: 1,
  });
}

function next(state, patch) {
  return Object.freeze({ ...state, ...patch, requestId: state.requestId + 1 });
}

export function setPeriod(state, period) {
  const cards = state.request.cards.map((c) => ({ type: c.type, params: c.params, section: c.section }));
  const next_ = {
    ...state.request,
    period,
  };
  try { validateRequest(next_); }
  catch (e) { return { error: e.message, state }; }
  return { state: next(state, {
    period: Object.freeze({ ...period }),
    request: Object.freeze(next_),
  }) };
}

export function setMode(state, mode) {
  if (!MODES.includes(mode)) return { error: `unknown mode ${mode}`, state };
  const request = { ...state.request, mode };
  try { validateRequest(request); }
  catch (e) { return { error: e.message, state }; }
  return { state: next(state, { mode, request: Object.freeze(request) }) };
}

// Replace the request wholesale (used by the command box, which produces a
// fully-formed request from resolve/command.mjs). `cardMap` is rebuilt from
// the request, using `card:<type>` as the actor id (deterministic; the same
// request produces the same actor ids).
export function applyRequest(state, request) {
  try { validateRequest(request); }
  catch (e) { return { error: e.message, state }; }
  const cardMap = {};
  const cardSpecs = [];
  for (const c of request.cards) {
    const actorId = `card:${c.type}`;
    cardMap[actorId] = { type: c.type, params: c.params || {} };
    cardSpecs.push({ type: c.type, params: c.params || {}, section: c.section });
  }
  return {
    state: next(state, {
      mode: request.mode || state.mode,
      request: Object.freeze({ ...request, cards: Object.freeze(cardSpecs) }),
      cardMap: Object.freeze(cardMap),
      period: Object.freeze({ ...(request.period || state.period) }),
      focus: request.focus ? Object.freeze({ entryId: request.focus.entryId }) : null,
      entryId: request.cards.find((c) => c.type === 'receipt')?.params?.entryId ?? null,
      compare: request.compare ? Object.freeze({ ...request.compare }) : null,
    }),
  };
}

// Focus for impact: sets (or clears) `state.focus.entryId`. The card query
// for impact adds `focus=N`.
export function setFocus(state, entryId) {
  const focus = entryId === null || entryId === undefined ? null : Object.freeze({ entryId });
  return { state: next(state, { focus }) };
}

export function setEntryId(state, entryId) {
  const n = entryId === null || entryId === undefined ? null : Number(entryId);
  if (n !== null && (!Number.isSafeInteger(n) || n < 1)) {
    return { error: `entryId must be a positive integer, got ${entryId}`, state };
  }
  return { state: next(state, { entryId: n }) };
}

export function setViewport(state, viewport) {
  if (!viewport || !Number.isSafeInteger(viewport.w) || !Number.isSafeInteger(viewport.h) ||
      viewport.w <= 0 || viewport.h <= 0) {
    return { error: 'viewport must be { w, h } positive integers', state };
  }
  // Only bump requestId when the size actually changed (a window resize with
  // the same dimensions should not re-fetch).
  if (state.viewport.w === viewport.w && state.viewport.h === viewport.h) {
    return { state };
  }
  return { state: next(state, { viewport: { w: viewport.w, h: viewport.h } }) };
}

// The request the client sends to /api/cards, /api/strip, /api/plan. This is
// the single source of truth for what to fetch; every fetch happens from
// App.jsx's useEffect keyed on requestId.
export function currentCardQuery(state) {
  const out = {
    types: state.request.cards.map((c) => c.type).join(','),
    from: state.period.from,
    to: state.period.to,
  };
  if (state.focus && state.focus.entryId !== null) out.focus = String(state.focus.entryId);
  const receiptSpec = state.request.cards.find((c) => c.type === 'receipt');
  if (receiptSpec && receiptSpec.params && Number.isSafeInteger(receiptSpec.params.entryId)) {
    out.entryId = String(receiptSpec.params.entryId);
  }
  return out;
}

export function currentStripQuery(state) {
  const base = currentCardQuery(state);
  return { ...base, mode: state.mode };
}

// The event context the command box passes to /api/command. `activeYear` is
// derived from the current period; `period` and `cards` are the current
// state so `trail from N`, `mode input`, and `compare Q1 with Q2` all
// behave the way the grammar expects.
export function commandContext(state) {
  const year = Number(state.period.from.slice(0, 4));
  return {
    period: { ...state.period },
    activeYear: Number.isFinite(year) && year > 0 ? year : undefined,
    cards: state.request.cards.map((c) => ({ type: c.type, params: c.params })),
  };
}
