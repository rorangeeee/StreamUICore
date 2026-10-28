export const WORDMARKS = ['LATENITE', 'NOIZBOIZ', 'HOPEFINDERS', 'BASSKARYOTES'] as const;

export const WORDMARK_TIMING = { hold: 1800, transition: 1600 } as const;
export const WORDMARK_MAX_GLYPH_STRETCH = 9;
export const WORDMARK_MAX_BLUR = 48;
export const WORDMARK_MIN_SPACING = .75;
export const TITLE_MIN_SPACING = .55;
export const WORDMARK_HIGHLIGHT_WIDTH_RATIO = .8;
export const WORDMARK_STEP = Object.values(WORDMARK_TIMING).reduce((sum, duration) => sum + duration, 0);
export const WORDMARK_CYCLE = WORDMARK_STEP * WORDMARKS.length;
export const TITLE_STEP = WORDMARK_STEP * 2.5;
export const TITLE_TIMING = { hold: TITLE_STEP - WORDMARK_TIMING.transition, transition: WORDMARK_TIMING.transition } as const;
export type WordmarkPhase = 'hold' | 'stretch' | 'shrink';

/** CSS cubic-bezier(.7, 0, .3, 1): one speed peak at the word switch. */
export function easeInOut(progress: number): number {
  const t = Math.max(0, Math.min(1, progress));
  if (t === 0 || t === .5 || t === 1) return t;
  let low = 0;
  let high = 1;
  for (let i = 0; i < 50; i++) {
    const u = (low + high) / 2;
    const v = 1 - u;
    const x = 3 * v * v * u * .7 + 3 * v * u * u * .3 + u * u * u;
    if (x < t) low = u;
    else high = u;
  }
  const u = (low + high) / 2;
  return 3 * (1 - u) * u * u + u * u * u;
}

export function sampleWordmark(time: number, wordCount: number = WORDMARKS.length, minimumSpacing = WORDMARK_MIN_SPACING, timing: { readonly hold: number; readonly transition: number } = WORDMARK_TIMING): { from: number; to: number; phase: WordmarkPhase; progress: number; light: number; glyphScaleX: number; blurX: number; spacingScale: number } {
  const elapsed = Math.max(0, time);
  const count = Math.max(1, Math.floor(wordCount));
  const step = timing.hold + timing.transition;
  const from = Math.floor(elapsed / step) % count;
  const to = (from + 1) % count;
  const transitionTime = elapsed % step - timing.hold;
  const progress = easeInOut(transitionTime / timing.transition);
  const phase = transitionTime < 0 ? 'hold' : transitionTime < timing.transition / 2 ? 'stretch' : 'shrink';
  // Fold one eased progress at its midpoint; neither side restarts the easing.
  const amount = 1 - Math.abs(2 * progress - 1);
  const glyphScaleX = 1 + (WORDMARK_MAX_GLYPH_STRETCH - 1) * amount;
  const blurX = WORDMARK_MAX_BLUR * amount;
  const spacingScale = 1 - (1 - minimumSpacing) * amount;
  const lightStartWidth = WORDMARK_MAX_GLYPH_STRETCH * WORDMARK_HIGHLIGHT_WIDTH_RATIO;
  const light = Math.max(0, Math.min(1, (glyphScaleX - lightStartWidth) / (WORDMARK_MAX_GLYPH_STRETCH - lightStartWidth)));
  return { from, to, phase, progress, light, glyphScaleX, blurX, spacingScale };
}

export function hexRgb(color: string): [number, number, number] {
  const hex = color.replace(/^#/, '');
  const full = hex.length === 3 ? [...hex].map((digit) => digit + digit).join('') : hex;
  if (!/^[\da-f]{6}$/i.test(full)) throw new Error(`Expected a hex color, received ${color}`);
  return [0, 2, 4].map((index) => Number.parseInt(full.slice(index, index + 2), 16)) as [number, number, number];
}

export function inverseRgb(color: readonly number[]): [number, number, number] {
  return color.map((channel) => 255 - channel) as [number, number, number];
}

export function mixRgb(from: readonly number[], to: readonly number[], progress: number): string {
  return `rgb(${from.map((channel, index) => Math.round(channel + (to[index] - channel) * progress)).join(', ')})`;
}
