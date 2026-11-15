// A single page frame. Draws one card (or an error) into its rect, applies
// the attention level via data-att, and forwards clicks to the caller.
//
// The card content is produced by view/svg/*.js (view/svg/slip.mjs and,
// for focus cards, view/svg/impact.mjs). That string is injected with
// dangerouslySetInnerHTML; this is safe because (a) every text node is
// escaped by view/svg/primitives.mjs, and (b) the string comes from our
// own renderers, not from user input. The static scan forbids any other
// use of dangerouslySetInnerHTML in app/.
//
// data-att is the ONLY appearance mechanism on this element. The generated
// attention.css turns data-att="0|1|2" into opacity/brightness/saturate/
// shadow. No inline styles for appearance.
import { useMemo } from 'react';
import { renderCard } from '../../../view/svg/slip.mjs';
import { renderImpact } from '../../../view/svg/impact.mjs';
import { getTheme } from '../../../view/svg/theme.mjs';

const THEMES = {
  light: getTheme('light'),
  dark: getTheme('dark'),
};

function themeNameFromDocument() {
  if (typeof document === 'undefined') return 'light';
  const t = document.documentElement.getAttribute('data-theme');
  return t === 'dark' ? 'dark' : 'light';
}

export function PageFrame({ actorId, level, rect, card, tier, error, onFocus, focused }) {
  const theme = THEMES[themeNameFromDocument()];
  const rectCpt = useMemo(() => ({
    x: BigInt(rect.x) * 75n,
    y: BigInt(rect.y) * 75n,
    w: BigInt(rect.w) * 75n,
    h: BigInt(rect.h) * 75n,
  }), [rect.x, rect.y, rect.w, rect.h]);

  const svg = useMemo(() => {
    if (!card) return null;
    try {
      if (card.impact) {
        return renderImpact(card, rectCpt, tier, theme);
      }
      return renderCard(card, rectCpt, tier, theme);
    } catch (e) {
      return null;
    }
  }, [card, rectCpt, tier, theme]);

  const style = {
    left: `${rect.x}px`,
    top: `${rect.y}px`,
    width: `${rect.w}px`,
    height: `${rect.h}px`,
  };

  return (
    <div
      className="page-frame"
      data-att={String(level)}
      data-actor-id={actorId}
      style={style}
      aria-current={focused ? 'true' : undefined}
      onPointerEnter={() => onFocus && onFocus(actorId, 'pointer')}
      onFocus={() => onFocus && onFocus(actorId, 'keyboard')}
      tabIndex={0}
    >
      {error
        ? <div className="page-error" role="alert">{error}</div>
        : (svg
            ? <div dangerouslySetInnerHTML={{ __html: svg }} />
            : <div className="page-error">loading…</div>)}
    </div>
  );
}
