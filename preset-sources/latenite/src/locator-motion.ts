import { easeInOut } from './wordmark-motion.ts';

export const LOCATOR_RADIUS = 12.67213654;
export const LOCATOR_MIN_WIDTH = 1;
export const LOCATOR_MAX_WIDTH = 4;
export const LOCATOR_LINE_LENGTH = 2 * (LOCATOR_RADIUS + LOCATOR_MAX_WIDTH / 2) * Math.SQRT2 * 1.08;
export const LOCATOR_BREATH_PERIOD = 5200;
export const LOCATOR_ROTATION_PERIOD = 13700;
export const LOCATOR_WIPE_DURATION = 1600;
const BASE_SPEED = 5, BOOST_SPEED = 35, PULSE_DURATION = 5100, ROTATION_PHASE = 2300;
const PULSE_START = LOCATOR_ROTATION_PERIOD - PULSE_DURATION;

export interface StrokeWindow { start: number; end: number; phase: 'idle' | 'erase' | 'reveal' }
export interface LocatorFrame { ringWidth: number; angle: number; angularSpeed: number; strokes: [StrokeWindow, StrokeWindow]; wiping: boolean; delay: number }

export function locatorRingWidth(time: number): number {
  return LOCATOR_MIN_WIDTH + (LOCATOR_MAX_WIDTH - LOCATOR_MIN_WIDTH) * (1 - Math.cos(2 * Math.PI * Math.max(0, time) / LOCATOR_BREATH_PERIOD)) / 2;
}

function rotationIntegral(time: number): number {
  const cycles = Math.floor(time / LOCATOR_ROTATION_PERIOD);
  const pulse = Math.max(0, time % LOCATOR_ROTATION_PERIOD - PULSE_START);
  const boost = pulse / 2 - PULSE_DURATION / (4 * Math.PI) * Math.sin(2 * Math.PI * pulse / PULSE_DURATION);
  return BASE_SPEED * time / 1000 + BOOST_SPEED / 1000 * (cycles * PULSE_DURATION / 2 + boost);
}

/** Integrate velocity so a new acceleration pulse cannot reset the rotation angle. */
export function locatorRotation(time: number): { angle: number; angularSpeed: number } {
  const elapsed = Math.max(0, time) + ROTATION_PHASE;
  const pulse = elapsed % LOCATOR_ROTATION_PERIOD - PULSE_START;
  const angularSpeed = BASE_SPEED + (pulse < 0 ? 0 : BOOST_SPEED * (1 - Math.cos(2 * Math.PI * pulse / PULSE_DURATION)) / 2);
  return { angle: rotationIntegral(elapsed) - rotationIntegral(ROTATION_PHASE), angularSpeed };
}

/** A solid interval along A → B: remove from A, then reveal again from A. */
export function locatorStrokeWindow(time: number): StrokeWindow {
  if (time < 0 || time >= LOCATOR_WIPE_DURATION * 2) return { start: 0, end: 1, phase: 'idle' };
  if (time < LOCATOR_WIPE_DURATION) return { start: easeInOut(time / LOCATOR_WIPE_DURATION), end: 1, phase: 'erase' };
  return { start: 0, end: easeInOut((time - LOCATOR_WIPE_DURATION) / LOCATOR_WIPE_DURATION), phase: 'reveal' };
}

export class LocatorMotion {
  private nextWipe: number;
  private wipe: { start: number; delay: number } | null = null;
  private random: () => number;
  constructor(random: () => number = Math.random) {
    this.random = random; this.nextWipe = 8000 + this.random() * 9000;
  }
  sample(time: number): LocatorFrame {
    const elapsed = Math.max(0, time);
    if (elapsed >= this.nextWipe) {
      this.wipe = { start: elapsed, delay: 800 + this.random() * 200 };
      this.nextWipe = elapsed + LOCATOR_WIPE_DURATION * 2 + this.wipe.delay + 16000 + this.random() * 14000;
    }
    if (this.wipe && elapsed >= this.wipe.start + LOCATOR_WIPE_DURATION * 2 + this.wipe.delay) this.wipe = null;
    const strokes: [StrokeWindow, StrokeWindow] = [
      locatorStrokeWindow(this.wipe ? elapsed - this.wipe.start : -1),
      locatorStrokeWindow(this.wipe ? elapsed - this.wipe.start - this.wipe.delay : -1),
    ];
    return { ringWidth: locatorRingWidth(elapsed), ...locatorRotation(elapsed), strokes, wiping: strokes.some(stroke => stroke.phase !== 'idle'), delay: this.wipe?.delay ?? 0 };
  }
}
