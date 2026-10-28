import { easeInOut } from './wordmark-motion.ts';

export const AWAY_TIMING = { line: 640, expand: 680, text: 160, mask: 900 } as const;
export const AWAY_DEFAULTS = { enabled: false, text1: '主播暂离片刻，马上回来。', text2: '', overlayOpacity: .5 };
export const AWAY_GEOMETRY = { bandHeight: 256, glyphHeight: 128, lineHeight: 4, separatorWidth: 320, separatorHeight: 144, gap: 112, speed: 180 } as const;
export type AwayPhase = 'hidden' | 'line-in' | 'expand' | 'visible' | 'collapse' | 'line-out';
interface Geometry { width: number; expand: number; offset: number; text: number }
interface Step { phase: AwayPhase; duration: number; to: Partial<Geometry> }
export interface AwayFrame extends Geometry { mask: number; phase: AwayPhase }
const HIDDEN: Geometry = { width: 0, expand: 0, offset: 0, text: 0 };
const VISIBLE: Geometry = { width: 1, expand: 1, offset: 0, text: 1 };

export function awayMessages(settings: { text1: string; text2: string }): string[] {
  return [settings.text1.trim(), settings.text2.trim()].filter(Boolean);
}

/** Every reversal starts at the current geometry, including a partly drawn line. */
export class AwayMotion {
  enabled = false;
  private geometry = { ...HIDDEN };
  private phase: AwayPhase = 'hidden';
  private steps: Step[] = [];
  private stepFrom = { ...HIDDEN };
  private stepElapsed = 0;
  private mask = 0;
  private maskFrom = 0;
  private maskElapsed = 0;
  private maskDuration = 0;

  get running(): boolean { return this.steps.length > 0 || this.maskElapsed < this.maskDuration; }
  read(): AwayFrame { return { ...this.geometry, mask: this.mask, phase: this.phase }; }

  setEnabled(enabled: boolean, immediate = false): void {
    if (enabled === this.enabled && !immediate) return;
    this.enabled = enabled;
    this.steps = []; this.stepElapsed = 0;
    this.maskFrom = this.mask; this.maskElapsed = 0;
    this.maskDuration = AWAY_TIMING.mask * Math.abs(Number(enabled) - this.mask);
    if (immediate) {
      this.geometry = { ...(enabled ? VISIBLE : HIDDEN) };
      this.mask = Number(enabled); this.maskDuration = 0;
      this.phase = enabled ? 'visible' : 'hidden'; return;
    }
    const g = this.geometry;
    if (enabled) {
      if (g.offset > 0 || g.width < 1) this.steps.push({ phase: 'line-in', duration: AWAY_TIMING.line * Math.max(g.offset, 1 - g.width), to: { width: 1, offset: 0 } });
      if (g.expand < 1) this.steps.push({ phase: 'expand', duration: AWAY_TIMING.expand * (1 - g.expand), to: { expand: 1 } });
      if (g.text < 1) this.steps.push({ phase: 'visible', duration: AWAY_TIMING.text * (1 - g.text), to: { text: 1 } });
    } else {
      if (g.expand > 0 || g.text > 0) this.steps.push({ phase: 'collapse', duration: Math.max(AWAY_TIMING.expand * g.expand, AWAY_TIMING.text * g.text), to: { expand: 0, text: 0 } });
      if (g.width > 0 && g.offset < 1) this.steps.push({ phase: 'line-out', duration: AWAY_TIMING.line * (1 - g.offset), to: { offset: 1 } });
    }
    this.nextStep();
  }

  private nextStep(): void {
    this.stepFrom = { ...this.geometry }; this.stepElapsed = 0;
    this.phase = this.steps[0]?.phase ?? (this.enabled ? 'visible' : 'hidden');
    if (!this.steps.length) this.geometry = { ...(this.enabled ? VISIBLE : HIDDEN) };
  }

  advance(milliseconds: number): AwayFrame {
    let remaining = Number.isFinite(milliseconds) ? Math.max(0, milliseconds) : 0;
    this.maskElapsed = Math.min(this.maskDuration, this.maskElapsed + remaining);
    const mix = this.maskDuration ? easeInOut(this.maskElapsed / this.maskDuration) : 1;
    this.mask = this.maskFrom + (Number(this.enabled) - this.maskFrom) * mix;
    while (this.steps.length && remaining > 0) {
      const step = this.steps[0], elapsed = Math.min(remaining, step.duration - this.stepElapsed);
      this.stepElapsed += elapsed; remaining -= elapsed;
      const progress = easeInOut(this.stepElapsed / step.duration);
      for (const key of Object.keys(step.to) as (keyof Geometry)[]) this.geometry[key] = this.stepFrom[key] + (step.to[key]! - this.stepFrom[key]) * progress;
      if (this.stepElapsed < step.duration) break;
      this.steps.shift(); this.nextStep();
    }
    return this.read();
  }
}
