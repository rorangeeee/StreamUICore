import { BARCODE_BARS, BARCODE_CONTENT, BARCODE_WIDTH } from './barcode-data.ts';
import { BarcodeMotion } from './barcode-motion.ts';

const SVG_NS = 'http://www.w3.org/2000/svg';

export class BarcodeCode extends HTMLElement {
  private bars: SVGRectElement[] = [];
  private visible: boolean[] = [];
  private motion = new BarcodeMotion(BARCODE_BARS.length);
  private elapsed = 0;
  private previousTime = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  private sync = () => {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    if (!this.isConnected) return;
    if (this.reducedMotion.matches) { this.render(0); return; }
    if (!document.hidden) {
      this.previousTime = performance.now(); this.render(this.elapsed);
      this.timer = setInterval(() => this.tick(), 30);
    }
  };
  connectedCallback(): void {
    if (!this.bars.length) this.build();
    document.addEventListener('visibilitychange', this.sync);
    this.reducedMotion.addEventListener('change', this.sync); this.sync();
  }
  disconnectedCallback(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    document.removeEventListener('visibilitychange', this.sync);
    this.reducedMotion.removeEventListener('change', this.sync);
  }
  private build(): void {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', `0 0 ${BARCODE_WIDTH} 28`); svg.setAttribute('preserveAspectRatio', 'none');
    svg.setAttribute('aria-hidden', 'true'); svg.setAttribute('fill', 'currentColor'); svg.setAttribute('shape-rendering', 'crispEdges');
    this.bars = BARCODE_BARS.map((bar, index) => {
      const rectangle = document.createElementNS(SVG_NS, 'rect'); rectangle.dataset.bar = String(index);
      rectangle.setAttribute('x', String(bar.x)); rectangle.setAttribute('width', String(bar.width));
      rectangle.setAttribute('height', '28'); svg.append(rectangle); return rectangle;
    });
    this.visible = this.bars.map(() => true); this.dataset.content = BARCODE_CONTENT; this.dataset.encoding = 'Code128B';
    this.replaceChildren(svg);
  }
  private tick(): void {
    const now = performance.now(); this.elapsed += Math.min(100, Math.max(0, now - this.previousTime)); this.previousTime = now;
    this.render(this.elapsed);
  }
  private render(time: number): void {
    const frame = this.motion.sample(time);
    if (this.dataset.phase !== frame.phase) this.dataset.phase = frame.phase;
    if (this.dataset.glitch !== String(frame.highlighted)) this.dataset.glitch = String(frame.highlighted);
    this.bars.forEach((bar, index) => {
      if (this.visible[index] === frame.visible[index]) return;
      this.visible[index] = frame.visible[index]; bar.setAttribute('visibility', frame.visible[index] ? 'visible' : 'hidden');
    });
  }
}

customElements.define('barcode-code', BarcodeCode);
