import { DATA_MATRIX_CONTENT, DATA_MATRIX_ROWS } from './data-matrix-data.ts';
import { DataMatrixMotion, matrixDiagonal, matrixDiagonalFilled } from './data-matrix-motion.ts';

const SVG_NS = 'http://www.w3.org/2000/svg';
const SIZE = DATA_MATRIX_ROWS.length;
const cell = (x: number, y: number) => `M${x} ${y}h1v1h-1Z`;

export class DataMatrixCode extends HTMLElement {
  private overlays: SVGPathElement[] = [];
  private visible: boolean[] = [];
  private motion = new DataMatrixMotion(SIZE);
  private timer: ReturnType<typeof setInterval> | null = null;
  private elapsed = 0;
  private previousTime = 0;
  private reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  private sync = () => {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    if (!this.isConnected) return;
    if (this.reducedMotion.matches) { this.render(0); return; }
    if (!document.hidden) {
      this.previousTime = performance.now(); this.tick();
      this.timer = setInterval(() => this.tick(), 30);
    }
  };

  connectedCallback(): void {
    if (!this.overlays.length) this.build();
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
    svg.setAttribute('viewBox', `0 0 ${SIZE} ${SIZE}`); svg.setAttribute('preserveAspectRatio', 'none');
    svg.setAttribute('aria-hidden', 'true'); svg.setAttribute('fill', 'currentColor'); svg.setAttribute('shape-rendering', 'crispEdges');
    const symbol = document.createElementNS(SVG_NS, 'path'); symbol.classList.add('matrix-symbol');
    symbol.setAttribute('d', DATA_MATRIX_ROWS.flatMap((row, y) => [...row].flatMap((value, x) => value === '1' ? [cell(x, y)] : [])).join(''));
    svg.append(symbol);
    this.overlays = Array.from({ length: 2 * SIZE - 1 }, (_, diagonal) => {
      const path = document.createElementNS(SVG_NS, 'path');
      path.dataset.diagonal = String(diagonal); path.setAttribute('visibility', 'hidden');
      path.setAttribute('d', matrixDiagonal(SIZE, diagonal).flatMap(({ x, y }) => DATA_MATRIX_ROWS[SIZE - 1 - y][x] === '0' ? [cell(x, SIZE - 1 - y)] : []).join(''));
      svg.append(path); return path;
    });
    this.visible = this.overlays.map(() => false); this.dataset.content = DATA_MATRIX_CONTENT; this.dataset.size = String(SIZE);
    this.replaceChildren(svg); this.render(0);
  }
  private tick(): void {
    const now = performance.now(); this.elapsed += Math.min(100, Math.max(0, now - this.previousTime)); this.previousTime = now;
    this.render(this.elapsed);
  }
  private render(time: number): void {
    const frame = this.motion.sample(time);
    if (this.dataset.phase !== frame.phase) this.dataset.phase = frame.phase;
    if (this.dataset.diagonal !== String(frame.diagonal)) this.dataset.diagonal = String(frame.diagonal);
    if (this.dataset.glitch !== String(frame.highlighted)) this.dataset.glitch = String(frame.highlighted);
    this.overlays.forEach((path, diagonal) => {
      const filled = matrixDiagonalFilled(frame, diagonal);
      if (filled !== this.visible[diagonal]) {
        path.setAttribute('visibility', filled ? 'visible' : 'hidden'); this.visible[diagonal] = filled;
      }
    });
  }
}

customElements.define('data-matrix-code', DataMatrixCode);
