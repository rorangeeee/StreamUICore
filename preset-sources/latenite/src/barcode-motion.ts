export const BARCODE_STEP = 35;
export const BARCODE_HOLD = 450;
export const BARCODE_FLASH = 80;
export interface BarcodeFrame { phase: 'idle' | 'erase' | 'hold' | 'reveal'; visible: boolean[]; highlighted: boolean }

/** Two independent occasional events: a left-to-right sweep and a double flash. */
export class BarcodeMotion {
  private nextSweep: number;
  private nextFlash: number;
  private sweepStart = -Infinity;
  private flashStart = -Infinity;
  private length: number;
  private random: () => number;
  constructor(length: number, random: () => number = Math.random) {
    this.length = length; this.random = random;
    this.nextSweep = 6000 + random() * 10000;
    this.nextFlash = 9000 + random() * 11000;
  }
  sample(time: number): BarcodeFrame {
    const elapsed = Math.max(0, time), sweep = this.length * BARCODE_STEP;
    const duration = 2 * sweep + BARCODE_HOLD;
    if (elapsed >= this.nextSweep) {
      this.sweepStart = elapsed;
      this.nextSweep = elapsed + duration + 12000 + this.random() * 16000;
    }
    if (elapsed >= this.nextFlash) {
      this.flashStart = elapsed;
      this.nextFlash = elapsed + 3 * BARCODE_FLASH + 12000 + this.random() * 14000;
    }
    const local = elapsed - this.sweepStart;
    let phase: BarcodeFrame['phase'] = 'idle';
    let visible = Array<boolean>(this.length).fill(true);
    if (local >= 0 && local < sweep) {
      phase = 'erase'; const hidden = Math.floor(local / BARCODE_STEP) + 1;
      visible = visible.map((_, index) => index >= hidden);
    } else if (local >= sweep && local < sweep + BARCODE_HOLD) {
      phase = 'hold'; visible.fill(false);
    } else if (local >= sweep + BARCODE_HOLD && local < duration) {
      phase = 'reveal'; const shown = Math.floor((local - sweep - BARCODE_HOLD) / BARCODE_STEP) + 1;
      visible = visible.map((_, index) => index < shown);
    }
    const flash = elapsed - this.flashStart;
    const highlighted = flash >= 0 && flash < 3 * BARCODE_FLASH && (flash < BARCODE_FLASH || flash >= 2 * BARCODE_FLASH);
    return { phase, visible, highlighted };
  }
}
