import { DetectionMotion } from './detection-motion.ts';
import type { DetectionFrame } from './detection-motion.ts';

interface Detector {
  label: SVGTextElement;
  confidence: SVGTextElement;
  motion: DetectionMotion;
}

/** Classification text and confidence fluctuate inside stationary labels. */
export class DetectionOverlays {
  private detectors: Detector[];
  private timer: ReturnType<typeof setInterval> | null = null;
  private elapsed = 0;
  private previousTime = 0;
  private reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  private sync = () => {
    this.stop();
    if (!document.hidden && !this.reducedMotion.matches) this.start();
  };
  constructor(workspace: HTMLElement) {
    this.detectors = Array.from(workspace.querySelectorAll<HTMLElement>('.detection-chrome')).map((chrome, index) => {
      const label = chrome.querySelector<SVGTextElement>('[data-detection-class]')!;
      const confidence = chrome.querySelector<SVGTextElement>('[data-detection-confidence]')!;
      return { label, confidence, motion: new DetectionMotion(label.textContent!.trim(), Number(confidence.textContent), index * 1600) };
    });
    document.addEventListener('visibilitychange', this.sync);
    this.reducedMotion.addEventListener('change', this.sync);
    window.addEventListener('pagehide', () => this.stop());
    window.addEventListener('pageshow', this.sync);
    this.sync();
  }
  private start(): void {
    this.previousTime = performance.now();
    this.tick();
    this.timer = setInterval(() => this.tick(), 80);
  }
  private stop(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    for (const detector of this.detectors) this.apply(detector, { label: detector.motion.label, confidence: detector.motion.baseline });
  }
  private tick(): void {
    const now = performance.now();
    this.elapsed += Math.min(250, Math.max(0, now - this.previousTime)); this.previousTime = now;
    for (const detector of this.detectors) {
      const frame = detector.motion.sample(this.elapsed);
      this.apply(detector, frame);
    }
  }
  private apply(detector: Detector, frame: DetectionFrame): void {
    const confidence = frame.confidence.toFixed(2);
    if (detector.confidence.textContent !== confidence) detector.confidence.textContent = confidence;
    if (detector.label.textContent !== frame.label) detector.label.textContent = frame.label;
  }
}
