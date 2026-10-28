export const DETECTION_CLASSES = ['LATENITE', 'NOISE', 'NULL', 'ERROR'] as const;
export interface DetectionFrame {
  label: string;
  confidence: number;
}
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

/** Only label contents change; all panel and label geometry stays fixed. */
export class DetectionMotion {
  readonly label: string;
  readonly baseline: number;
  private random: () => number;
  private phase: number;
  private nextShock: number;
  private nextLabel: number;
  private shock: { start: number; duration: number; offset: number } | null = null;
  private slip: { end: number; label: string } | null = null;
  private noise = 0;
  private lastQuantum = -1;

  constructor(label: string, baseline: number, phase = 0, random: () => number = Math.random) {
    this.label = label; this.baseline = baseline; this.phase = phase; this.random = random;
    this.nextShock = phase + this.range(5000, 11000);
    this.nextLabel = phase + this.range(4500, 10000);
  }
  private range(min: number, max: number): number { return min + (max - min) * this.random(); }
  sample(time: number): DetectionFrame {
    if (time >= this.nextShock) {
      const duration = this.range(1000, 1600);
      const target = clamp(this.baseline + (this.random() < .5 ? -1 : 1) * this.range(.22, .4), .04, .99);
      this.shock = { start: time, duration, offset: target - this.baseline };
      this.nextShock = time + duration + this.range(12000, 26000);
    }
    let excursion = 0;
    if (this.shock) {
      const progress = clamp((time - this.shock.start - 180) / (this.shock.duration - 180), 0, 1);
      excursion = this.shock.offset * (1 - progress * progress * (3 - 2 * progress));
      if (progress === 1) this.shock = null;
    }
    const quantum = Math.floor(time / 160);
    if (quantum !== this.lastQuantum) {
      this.noise = clamp(this.noise * .7 + this.range(-.012, .012), -.02, .02);
      this.lastQuantum = quantum;
    }
    const wave = Math.sin((time + this.phase) / 510) * .009 + Math.sin((time + this.phase) / 1270) * .006;
    const confidence = clamp(this.baseline + clamp(this.noise + wave, -.03, .03) + excursion, .02, .99);

    if (time >= this.nextLabel) {
      const duration = this.range(350, 950);
      this.slip = { end: time + duration, label: DETECTION_CLASSES[Math.floor(this.random() * DETECTION_CLASSES.length)] };
      this.nextLabel = time + duration + this.range(10000, 22000);
    }
    if (this.slip && time >= this.slip.end) this.slip = null;
    return { label: this.slip?.label ?? this.label, confidence };
  }
}
