// Integer contrast ratio between two sRGB colours, in permille (so 7000
// means 7.000:1). The linearisation LUT is built once at module load; the
// contrast computation itself is integer-only so a state check or a law test
// cannot introduce a float that drifts across platforms.
//
// The 0.05 offset in the WCAG formula is 50000 in ppm; luminance is
// represented in ppm (parts per million) so a 100-percent channel is 1000000.

const LINEAR_LUT = (() => {
  const lut = new Array(256);
  for (let c = 0; c < 256; c++) {
    const n = c / 255;
    const v = n <= 0.03928 ? n / 12.92 : Math.pow((n + 0.055) / 1.055, 2.4);
    lut[c] = Math.round(v * 1000000);
  }
  return Object.freeze(lut);
})();

function clampChannel(c) {
  if (!Number.isInteger(c)) c = Math.round(c);
  if (c < 0) return 0;
  if (c > 255) return 255;
  return c;
}

// Relative luminance in ppm. Rec. 709 coefficients scaled to integers.
export function luminancePpm(r, g, b) {
  const R = clampChannel(r), G = clampChannel(g), B = clampChannel(b);
  return Math.round((2126 * LINEAR_LUT[R] + 7152 * LINEAR_LUT[G] + 722 * LINEAR_LUT[B]) / 10000);
}

// WCAG contrast ratio, permille. Arguments are relative luminances in ppm.
// Always returns (light + 50000) / (dark + 50000), so the result is >= 1000.
export function contrastPermille(l1Ppm, l2Ppm) {
  const light = Math.max(l1Ppm, l2Ppm);
  const dark  = Math.min(l1Ppm, l2Ppm);
  const num = light + 50000;
  const den = dark + 50000;
  return Math.floor((num * 1000) / den);
}

// Blend a foreground channel toward the background channel by
// `opacityPermille * brightnessPermille / 1_000_000`. Both factors are in
// permille, so the product is in millionths. Integer-only.
export function blendChannel(fg, bg, opacityPermille, brightnessPermille) {
  const factor = opacityPermille * brightnessPermille; // 0 .. 1_000_000
  const f = clampChannel(fg);
  const b = clampChannel(bg);
  return Math.floor((b * (1000000 - factor) + f * factor) / 1000000);
}

// Effective foreground (r, g, b) at a level, given its opacity and
// brightness, on a background (r, g, b). Saturation is preserved for
// non-greyscale themes but does not enter the contrast computation.
export function effectiveFg(fg, bg, opacityPermille, brightnessPermille) {
  return {
    r: blendChannel(fg.r, bg.r, opacityPermille, brightnessPermille),
    g: blendChannel(fg.g, bg.g, opacityPermille, brightnessPermille),
    b: blendChannel(fg.b, bg.b, opacityPermille, brightnessPermille),
  };
}

// Effective fg (blend toward bg by opacity*brightness), then contrast vs bg.
export function levelContrastPermille(fg, bg, opacityPermille, brightnessPermille) {
  const eff = effectiveFg(fg, bg, opacityPermille, brightnessPermille);
  const fgL = luminancePpm(eff.r, eff.g, eff.b);
  const bgL = luminancePpm(bg.r, bg.g, bg.b);
  return contrastPermille(fgL, bgL);
}
