import { easeInOut } from './wordmark-motion.ts';

export const GLOW_RISE = 900, GLOW_HOLD = 160, GLOW_FALL = 1200;
export const GLOW_BLINK_OFF = 50, GLOW_BLINK_ON = 60, GLOW_BLINK_COUNT = 2;
export const GLOW_BLINK_START = GLOW_RISE + GLOW_HOLD;
export const GLOW_BLINK_END = GLOW_BLINK_START + (GLOW_BLINK_OFF + GLOW_BLINK_ON) * GLOW_BLINK_COUNT;
export const GLOW_DURATION = GLOW_BLINK_END + GLOW_FALL;

function strengthAt(time: number): number {
  const elapsed = Math.max(0, time);
  if (elapsed < GLOW_RISE) return easeInOut(elapsed / GLOW_RISE);
  if (elapsed < GLOW_BLINK_START) return 1;
  if (elapsed < GLOW_BLINK_END) return (elapsed - GLOW_BLINK_START) % (GLOW_BLINK_OFF + GLOW_BLINK_ON) < GLOW_BLINK_OFF ? 0 : 1;
  return elapsed < GLOW_DURATION ? 1 - easeInOut((elapsed - GLOW_BLINK_END) / GLOW_FALL) : 0;
}

function layers(strength: number): { text: number; purple: number; green: number } {
  // The two halo layers add inside an isolated plus-lighter group. Their total
  // alpha is g and their hue weights are (1-g) purple, g green at every pixel.
  return { text: strength, purple: strength * (1 - strength), green: strength * strength };
}

/** The same envelope drives the text tint and both cached halo layers. */
export function marqueeGlowFrame(time: number): { text: number; purple: number; green: number } {
  return layers(strengthAt(time));
}

export function marqueeGlowKeyframes(channel: 'text' | 'purple' | 'green'): Keyframe[] {
  const frames: Keyframe[] = [];
  const frame = (time: number, strength = strengthAt(time)) => frames.push({ offset: time / GLOW_DURATION, opacity: layers(strength)[channel] });
  for (let time = 0; time < GLOW_RISE; time += 32) frame(time);
  frame(GLOW_RISE);
  for (let blink = 0; blink < GLOW_BLINK_COUNT; blink++) {
    const off = GLOW_BLINK_START + blink * (GLOW_BLINK_OFF + GLOW_BLINK_ON);
    const on = off + GLOW_BLINK_OFF;
    // Duplicate offsets make the four edges instantaneous; no linear ramp is
    // inserted between purple/off and green/on during either flash.
    frame(off, 1); frame(off, 0);
    frame(on, 0); frame(on, 1);
  }
  for (let time = GLOW_BLINK_END; time < GLOW_DURATION; time += 32) frame(time);
  frame(GLOW_DURATION);
  return frames;
}
