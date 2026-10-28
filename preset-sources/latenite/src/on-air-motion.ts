import { easeInOut } from './wordmark-motion.ts';

export const ON_AIR_CYCLE = 8000;
export const ON_AIR_BLINK = 1600;

/** Equal-speed, phase-offset axis sweeps, each easing slowly into and out of its extremes. */
export function sampleOnAir(time: number): { width: number; weight: number; slant: number; recording: boolean } {
  const elapsed = Math.max(0, time);
  const sweep = (phase: number): number => {
    const position = ((elapsed + phase) % ON_AIR_CYCLE) / (ON_AIR_CYCLE / 2);
    return easeInOut(position <= 1 ? position : 2 - position);
  };
  return {
    width: 70 + 65 * sweep(0),
    weight: 150 + 700 * sweep(1100),
    slant: 12 * sweep(2300),
    recording: elapsed % ON_AIR_BLINK < ON_AIR_BLINK / 2,
  };
}
