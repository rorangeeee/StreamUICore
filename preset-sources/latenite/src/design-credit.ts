import { DESIGN_CREDIT_TEXT, DesignCreditMotion } from './design-credit-motion.ts';

const SVG_NS = 'http://www.w3.org/2000/svg';
const FONT_SIZE = 20.833, BLOCK_SIZE = 12, BASELINE = 32;
const ADVANCES = [...DESIGN_CREDIT_TEXT].map(character => character === 'w' ? 22.706 : 14.374);
const START = 125 - ADVANCES.reduce((sum, width) => sum + width, 0) / 2;
interface CreditSlot { glyph: SVGTextElement; block: SVGRectElement; blocked: boolean }

export class DesignCredit extends HTMLElement {
  private slots: CreditSlot[] = [];
  private motion = new DesignCreditMotion();
  private timer: ReturnType<typeof setInterval> | null = null;
  private elapsed = 0;
  private previousTime = 0;
  private ready = false;
  private loading = false;
  private fontStatus = 'fallback';
  private reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  private sync = () => {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    if (!this.isConnected || !this.ready || !this.slots.length) return;
    if (this.reducedMotion.matches) { this.render(0); return; }
    if (!document.hidden) {
      this.previousTime = performance.now(); this.render(this.elapsed);
      this.timer = setInterval(() => this.tick(), 40);
    }
  };

  connectedCallback(): void {
    document.addEventListener('visibilitychange', this.sync);
    this.reducedMotion.addEventListener('change', this.sync);
    if (this.ready) { if (!this.slots.length) this.build(); this.sync(); }
    else if (!this.loading) void this.loadFont();
  }
  disconnectedCallback(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    document.removeEventListener('visibilitychange', this.sync);
    this.reducedMotion.removeEventListener('change', this.sync);
  }
  private async loadFont(): Promise<void> {
    this.loading = true;
    try { this.fontStatus = (await document.fonts.load(`400 ${FONT_SIZE}px "StreamUI Technotot"`, DESIGN_CREDIT_TEXT)).length ? 'ready' : 'fallback'; }
    catch { this.fontStatus = 'fallback'; }
    this.ready = true; this.loading = false;
    if (this.isConnected) { this.build(); this.sync(); }
  }
  private build(): void {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 250 50'); svg.setAttribute('preserveAspectRatio', 'none'); svg.setAttribute('aria-hidden', 'true');
    const group = document.createElementNS(SVG_NS, 'g');
    group.setAttribute('fill', 'currentColor');
    const context = document.createElement('canvas').getContext('2d')!;
    context.font = `400 ${FONT_SIZE}px "StreamUI Technotot", sans-serif`;
    const metrics = context.measureText(DESIGN_CREDIT_TEXT);
    const centerY = BASELINE + (metrics.actualBoundingBoxDescent - metrics.actualBoundingBoxAscent) / 2;
    let cursor = START;
    this.slots = [...DESIGN_CREDIT_TEXT].map((character, index) => {
      const slot = document.createElementNS(SVG_NS, 'g'); slot.dataset.index = String(index); slot.dataset.character = character;
      const glyph = document.createElementNS(SVG_NS, 'text'); glyph.textContent = character;
      glyph.setAttribute('x', String(cursor)); glyph.setAttribute('y', String(BASELINE)); glyph.setAttribute('font-size', String(FONT_SIZE)); glyph.setAttribute('fill-opacity', '.75');
      const block = document.createElementNS(SVG_NS, 'rect');
      block.setAttribute('x', String(cursor + (ADVANCES[index] - BLOCK_SIZE) / 2)); block.setAttribute('y', String(centerY - BLOCK_SIZE / 2));
      block.setAttribute('width', String(BLOCK_SIZE)); block.setAttribute('height', String(BLOCK_SIZE)); block.setAttribute('visibility', 'hidden');
      slot.append(glyph, block); group.append(slot); cursor += ADVANCES[index];
      return { glyph, block, blocked: false };
    });
    svg.append(group); this.replaceChildren(svg); this.dataset.fonts = this.fontStatus; this.render(0);
  }
  private tick(): void {
    const now = performance.now(); this.elapsed += Math.min(100, Math.max(0, now - this.previousTime)); this.previousTime = now;
    this.render(this.elapsed);
  }
  private render(time: number): void {
    const frame = this.motion.sample(time);
    if (this.dataset.phase !== frame.phase) this.dataset.phase = frame.phase;
    this.slots.forEach((slot, index) => {
      if (slot.blocked === frame.blocked[index]) return;
      slot.blocked = frame.blocked[index]; slot.glyph.setAttribute('visibility', slot.blocked ? 'hidden' : 'visible'); slot.block.setAttribute('visibility', slot.blocked ? 'visible' : 'hidden');
    });
  }
}

customElements.define('design-credit', DesignCredit);
