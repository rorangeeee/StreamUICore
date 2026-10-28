import { sampleOnAir } from './on-air-motion.ts';

const SVG_NS = 'http://www.w3.org/2000/svg';

export class OnAirIndicator extends HTMLElement {
  private record!: SVGGElement;
  private label!: SVGTextElement;
  private elapsed = 0;
  private previousTime = 0;
  private animation = 0;
  private ready = false;
  private previousAxes = '';
  private reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  private tick = (time: number) => {
    if (this.previousTime) this.elapsed += Math.min(100, Math.max(0, time - this.previousTime));
    this.previousTime = time;
    this.render(this.elapsed);
    this.animation = requestAnimationFrame(this.tick);
  };
  private sync = () => {
    cancelAnimationFrame(this.animation); this.animation = 0; this.previousTime = 0;
    if (!this.ready || !this.isConnected) return;
    this.render(this.elapsed);
    if (!document.hidden && !this.reducedMotion.matches) this.animation = requestAnimationFrame(this.tick);
  };

  connectedCallback(): void {
    document.addEventListener('visibilitychange', this.sync);
    this.reducedMotion.addEventListener('change', this.sync);
    if (this.record) { this.sync(); return; }
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 200 100');
    svg.setAttribute('preserveAspectRatio', 'none');
    svg.setAttribute('aria-hidden', 'true');
    this.record = document.createElementNS(SVG_NS, 'g');
    this.record.classList.add('record-light');
    this.record.setAttribute('transform', 'translate(47.409679 72.872441)');
    const letter = document.createElementNS(SVG_NS, 'text');
    letter.textContent = 'O'; letter.classList.add('record-letter');
    const center = document.createElementNS(SVG_NS, 'circle');
    center.classList.add('record-center');
    this.record.append(letter, center);
    const labelGroup = document.createElementNS(SVG_NS, 'g');
    labelGroup.setAttribute('transform', 'translate(66.494679 72.872441)');
    this.label = document.createElementNS(SVG_NS, 'text');
    this.label.textContent = 'N AIR'; this.label.classList.add('on-air-label');
    labelGroup.append(this.label); svg.append(this.record, labelGroup); this.append(svg);
    void this.loadFont(letter, center);
  }

  disconnectedCallback(): void {
    cancelAnimationFrame(this.animation); this.animation = 0; this.previousTime = 0;
    document.removeEventListener('visibilitychange', this.sync);
    this.reducedMotion.removeEventListener('change', this.sync);
  }

  private async loadFont(letter: SVGTextElement, center: SVGCircleElement): Promise<void> {
    let loaded = false;
    try {
      const fonts = await Promise.all([150, 850, 1000].map(weight => document.fonts.load(`${weight} 25px "StreamUI SF Pro"`, 'ON AIR')));
      loaded = fonts.every(faces => faces.length > 0);
    } catch { /* Keep a readable fallback when the local font is unavailable. */ }
    const context = document.createElement('canvas').getContext('2d')!;
    context.font = '1000 25px "StreamUI SF Pro", sans-serif';
    const metrics = context.measureText('O');
    const width = metrics.actualBoundingBoxLeft + metrics.actualBoundingBoxRight;
    const height = metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent;
    center.setAttribute('cx', String((metrics.actualBoundingBoxRight - metrics.actualBoundingBoxLeft) / 2));
    center.setAttribute('cy', String((metrics.actualBoundingBoxDescent - metrics.actualBoundingBoxAscent) / 2));
    center.setAttribute('r', String(Math.min(width, height) * .42));
    this.dataset.fonts = loaded ? 'ready' : 'fallback'; this.ready = true;
    letter.setAttribute('aria-hidden', 'true'); this.sync();
  }

  private render(time: number): void {
    const state = this.reducedMotion.matches ? { width: 100, weight: 200, slant: 0, recording: true } : sampleOnAir(time);
    if (this.dataset.recording !== String(state.recording)) {
      this.record.style.color = state.recording ? '#8a1024' : '#000000'; this.dataset.recording = String(state.recording);
    }
    const weight = state.weight.toFixed(0);
    const axes = `"wdth" ${state.width.toFixed(1)}, "opsz" 28`;
    const signature = `${axes}|${weight}`;
    if (this.previousAxes !== signature) {
      // Let font-weight drive the native wght axis instead of fixing it at 200.
      this.label.style.fontWeight = weight; this.label.style.fontVariationSettings = axes;
      this.previousAxes = signature;
    }
    const slant = `skewX(${(-state.slant).toFixed(2)})`;
    if (this.label.getAttribute('transform') !== slant) this.label.setAttribute('transform', slant);
  }
}

customElements.define('on-air-indicator', OnAirIndicator);
