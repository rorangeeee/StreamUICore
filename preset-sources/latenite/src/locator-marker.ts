import { LOCATOR_LINE_LENGTH, LOCATOR_RADIUS, LocatorMotion } from './locator-motion.ts';
import type { LocatorFrame } from './locator-motion.ts';

const SVG_NS = 'http://www.w3.org/2000/svg';
const HALF = LOCATOR_LINE_LENGTH / (2 * Math.SQRT2);
const ENDPOINTS = [[-HALF, -HALF, HALF, HALF], [-HALF, HALF, HALF, -HALF]];

export class LocatorMarker extends HTMLElement {
  private circle!: SVGCircleElement;
  private rotor!: HTMLDivElement;
  private strokes: SVGLineElement[] = [];
  private motion = new LocatorMotion();
  private animation = 0;
  private elapsed = 0;
  private previousTime = 0;
  private ringSignature = '';
  private rotationSignature = '';
  private strokeSignatures = ['', ''];
  private reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  private tick = (time: number) => {
    if (this.previousTime) this.elapsed += Math.min(100, Math.max(0, time - this.previousTime));
    this.previousTime = time; this.render(this.elapsed);
    this.animation = requestAnimationFrame(this.tick);
  };
  private sync = () => {
    cancelAnimationFrame(this.animation); this.animation = 0; this.previousTime = 0;
    if (!this.isConnected) return;
    if (this.reducedMotion.matches) { this.render(0); return; }
    if (!document.hidden) { this.render(this.elapsed); this.animation = requestAnimationFrame(this.tick); }
  };

  connectedCallback(): void {
    if (!this.circle) this.build();
    document.addEventListener('visibilitychange', this.sync);
    this.reducedMotion.addEventListener('change', this.sync); this.sync();
  }
  disconnectedCallback(): void {
    cancelAnimationFrame(this.animation); this.animation = 0; this.previousTime = 0;
    document.removeEventListener('visibilitychange', this.sync);
    this.reducedMotion.removeEventListener('change', this.sync);
  }
  private svg(): SVGSVGElement {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '-32 -32 64 64'); svg.setAttribute('preserveAspectRatio', 'none');
    svg.setAttribute('aria-hidden', 'true'); svg.setAttribute('fill', 'none'); svg.setAttribute('stroke', 'currentColor');
    return svg;
  }
  private build(): void {
    const ring = this.svg(); ring.classList.add('locator-ring');
    this.circle = document.createElementNS(SVG_NS, 'circle');
    this.circle.setAttribute('r', String(LOCATOR_RADIUS)); this.circle.setAttribute('stroke-width', '1'); ring.append(this.circle);
    this.rotor = document.createElement('div'); this.rotor.className = 'locator-rotor';
    const cross = this.svg(); cross.setAttribute('stroke-width', '1'); cross.setAttribute('stroke-linecap', 'butt');
    this.strokes = ENDPOINTS.map((_, index) => {
      const line = document.createElementNS(SVG_NS, 'line'); line.dataset.stroke = String(index); cross.append(line); return line;
    });
    this.rotor.append(cross); this.replaceChildren(ring, this.rotor);
  }
  private render(time: number): void { this.apply(this.motion.sample(time)); }
  private apply(frame: LocatorFrame): void {
    const ring = frame.ringWidth.toFixed(3);
    if (this.ringSignature !== ring) { this.circle.setAttribute('stroke-width', ring); this.ringSignature = ring; }
    const rotation = `rotate(${(frame.angle % 360).toFixed(3)}deg)`;
    if (this.rotationSignature !== rotation) { this.rotor.style.transform = rotation; this.rotationSignature = rotation; }
    const wiping = String(frame.wiping);
    if (this.dataset.wiping !== wiping) this.dataset.wiping = wiping;
    this.strokes.forEach((line, index) => {
      const window = frame.strokes[index], signature = `${window.start.toFixed(5)}|${window.end.toFixed(5)}`;
      if (line.dataset.phase !== window.phase) line.dataset.phase = window.phase;
      if (this.strokeSignatures[index] === signature) return;
      this.strokeSignatures[index] = signature;
      const [ax, ay, bx, by] = ENDPOINTS[index];
      for (const [name, value] of Object.entries({ x1: ax + (bx - ax) * window.start, y1: ay + (by - ay) * window.start, x2: ax + (bx - ax) * window.end, y2: ay + (by - ay) * window.end })) line.setAttribute(name, value.toFixed(5));
    });
  }
}

customElements.define('locator-marker', LocatorMarker);
