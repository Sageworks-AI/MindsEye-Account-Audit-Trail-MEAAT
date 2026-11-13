// Anchor invariance (Law L6, second half). Given the focal pane's old rect
// and scale, the anchor's page coordinates, the focal pane's new rect and
// scale, and a tolerance in cpt, return the view offset (added to the new
// rect's origin) that keeps the anchor's screen position within tolerance
// of where it was, or — when that is impossible — puts the anchor at the
// closest boundary point of the new rect to the old screen position.
//
// Exact mirror of space/cpp/anchor.hpp; parity is enforced by golden
// vectors and by test/space/parity.test.mjs. BigInt only.
import { add, sub, mul, check } from './fixed.mjs';
import { applyRational } from './rational.mjs';

export function anchorOffset(oldRect, oldScale, anchorPageX, anchorPageY,
                             newRect, newScale, toleranceCpt) {
  if (typeof toleranceCpt !== 'bigint' || toleranceCpt < 0n) {
    throw new Error('anchorOffset: toleranceCpt must be a non-negative BigInt');
  }
  // Old screen position without any offset.
  const axOld = applyRational(anchorPageX, oldScale);
  const ayOld = applyRational(anchorPageY, oldScale);
  const oldSX = add(oldRect.x, axOld, 'oldSX');
  const oldSY = add(oldRect.y, ayOld, 'oldSY');
  // New screen position without any offset.
  const axNew = applyRational(anchorPageX, newScale);
  const ayNew = applyRational(anchorPageY, newScale);
  const baseSX = add(newRect.x, axNew, 'baseSX');
  const baseSY = add(newRect.y, ayNew, 'baseSY');
  // Desired offset restores the old screen position exactly.
  const dx = sub(oldSX, baseSX, 'dx');
  const dy = sub(oldSY, baseSY, 'dy');
  // Within tolerance? Then use the desired offset unchanged.
  const d2 = add(mul(dx, dx, 'dx2'), mul(dy, dy, 'dy2'), 'd2');
  const tol2 = mul(toleranceCpt, toleranceCpt, 'tol2');
  if (d2 <= tol2) return { offX: dx, offY: dy };
  // Outside tolerance: clamp so the anchor lands at the closest point of
  // the new rect to the old screen position.
  const newX2 = add(newRect.x, newRect.w, 'newX2');
  const newY2 = add(newRect.y, newRect.h, 'newY2');
  let targetX = oldSX, targetY = oldSY;
  if (targetX < newRect.x) targetX = newRect.x;
  if (targetX > newX2)     targetX = newX2;
  if (targetY < newRect.y) targetY = newRect.y;
  if (targetY > newY2)     targetY = newY2;
  return {
    offX: sub(targetX, baseSX, 'offX'),
    offY: sub(targetY, baseSY, 'offY'),
  };
}
