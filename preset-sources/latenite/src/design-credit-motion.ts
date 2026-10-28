export const DESIGN_CREDIT_TEXT = 'dsgnd by when';
export const CREDIT_STEP = 80;
export const CREDIT_HOLD = 500;
export interface CreditFrame { phase: 'idle' | 'cover' | 'hold' | 'restore'; blocked: boolean[] }

function shuffled(length: number, random: () => number): number[] {
  const order = Array.from({ length }, (_, index) => index);
  for (let index = length - 1; index > 0; index--) {
    const other = Math.floor(random() * (index + 1));
    [order[index], order[other]] = [order[other], order[index]];
  }
  return order;
}

export class DesignCreditMotion {
  private length: number;
  private random: () => number;
  private nextTrigger: number;
  private event: { start: number; cover: number[]; restore: number[] } | null = null;
  constructor(length = DESIGN_CREDIT_TEXT.length, random: () => number = Math.random) {
    this.length = length; this.random = random; this.nextTrigger = 6000 + this.random() * 8000;
  }
  sample(time: number): CreditFrame {
    const elapsed = Math.max(0, time), sweep = (this.length - 1) * CREDIT_STEP, duration = 2 * sweep + CREDIT_HOLD;
    if (elapsed >= this.nextTrigger) {
      this.event = { start: elapsed, cover: shuffled(this.length, this.random), restore: shuffled(this.length, this.random) };
      this.nextTrigger = elapsed + duration + 12000 + this.random() * 16000;
    }
    const blocked = Array<boolean>(this.length).fill(false);
    if (!this.event || elapsed < this.event.start) return { phase: 'idle', blocked };
    const local = elapsed - this.event.start;
    if (local >= duration) { this.event = null; return { phase: 'idle', blocked }; }
    if (local < sweep) {
      for (const index of this.event.cover.slice(0, Math.floor(local / CREDIT_STEP) + 1)) blocked[index] = true;
      return { phase: 'cover', blocked };
    }
    blocked.fill(true);
    if (local < sweep + CREDIT_HOLD) return { phase: 'hold', blocked };
    for (const index of this.event.restore.slice(0, Math.floor((local - sweep - CREDIT_HOLD) / CREDIT_STEP) + 1)) blocked[index] = false;
    return { phase: 'restore', blocked };
  }
}
