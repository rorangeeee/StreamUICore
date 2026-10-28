import { ON_AIR_BLINK } from './on-air-motion.ts';
import { NOW_PLAYING_HEIGHT, NOW_PLAYING_PANEL_HEIGHT, nowPlayingLit, nowPlayingRuns, nowPlayingText } from './now-playing-data.ts';
import type { NowPlayingTrack } from './now-playing-data.ts';
import { PIXEL_FONT_FAMILIES } from './mixed-text.ts';

const SVG_NS = 'http://www.w3.org/2000/svg';
const FAMILIES = PIXEL_FONT_FAMILIES;
interface FontMetric { y: number; height: number }

export class NowPlaying extends HTMLElement {
  private svg!: SVGSVGElement;
  private content!: SVGGElement;
  private references!: Record<'en' | 'zh', SVGTextElement>;
  private metrics!: Record<'en' | 'zh', FontMetric>;
  private inkCanvas = document.createElement('canvas');
  private inkContext = this.inkCanvas.getContext('2d', { willReadFrequently: true })!;
  private text = '';
  private ready = false;
  private fontsLoaded = false;
  private loading = false;
  private elapsed = 0;
  private previousTime = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private observer: ResizeObserver | null = null;
  private reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  private sync = () => {
    this.pause();
    if (!this.ready || !this.text || !this.isConnected || document.hidden) { this.show(false); return; }
    if (this.reducedMotion.matches) { this.show(true); return; }
    this.previousTime = performance.now(); this.show(nowPlayingLit(this.elapsed)); this.schedule();
  };

  connectedCallback(): void {
    if (!this.svg) this.build();
    document.addEventListener('visibilitychange', this.sync);
    this.reducedMotion.addEventListener('change', this.sync);
    this.observer = new ResizeObserver(() => this.layout()); this.observer.observe(this);
    if (this.fontsLoaded) { this.layout(); this.sync(); }
    else if (!this.loading) void this.loadFonts();
  }
  disconnectedCallback(): void {
    this.pause(); this.observer?.disconnect();
    document.removeEventListener('visibilitychange', this.sync); this.reducedMotion.removeEventListener('change', this.sync);
  }
  update(track: NowPlayingTrack | null | undefined): void {
    const text = nowPlayingText(track);
    this.dataset.state = track?.state ?? 'idle';
    if (text === this.text) return;
    this.pause(); this.text = text; this.elapsed = 0;
    this.setAttribute('aria-label', text || '当前曲目');
    this.setAttribute('aria-hidden', String(!text));
    if (this.ready) this.layout();
    this.sync();
  }

  private build(): void {
    this.style.visibility = 'hidden'; this.setAttribute('aria-hidden', 'true');
    this.svg = document.createElementNS(SVG_NS, 'svg'); this.svg.setAttribute('aria-hidden', 'true');
    this.content = document.createElementNS(SVG_NS, 'g'); this.content.classList.add('now-playing-content');
    this.references = {} as Record<'en' | 'zh', SVGTextElement>;
    for (const language of ['en', 'zh'] as const) {
      const reference = document.createElementNS(SVG_NS, 'text');
      reference.textContent = language === 'en' ? 'H' : '国'; reference.dataset.reference = language;
      reference.style.fontFamily = FAMILIES[language]; reference.setAttribute('font-size', '100');
      reference.setAttribute('visibility', 'hidden'); this.references[language] = reference; this.svg.append(reference);
    }
    this.svg.append(this.content); this.replaceChildren(this.svg);
  }
  private async loadFonts(): Promise<void> {
    this.loading = true;
    const fonts = await Promise.allSettled([
      document.fonts.load('400 100px "StreamUI Retro Pixel"', 'H NOW PLAYING'),
      document.fonts.load('400 100px "StreamUI Pixel Chinese"', '国歌曲歌手'),
    ]);
    this.dataset.fonts = fonts.every(font => font.status === 'fulfilled' && font.value.length > 0) ? 'ready' : 'fallback';
    this.loading = false; this.fontsLoaded = true;
    this.layout();
  }
  private measureFonts(): boolean {
    if (this.ready) return true;
    const metrics = {} as Record<'en' | 'zh', FontMetric>;
    for (const language of ['en', 'zh'] as const) {
      this.references[language].setAttribute('font-size', '100');
      const bounds = this.references[language].getBBox();
      if (!bounds.height) return false;
      metrics[language] = { y: bounds.y, height: bounds.height };
    }
    this.metrics = metrics; this.ready = true; return true;
  }
  private fontAtHeight(language: 'en' | 'zh', height: number): { size: number; y: number; height: number } {
    const reference = this.references[language];
    let size = 100 * height / this.metrics[language].height;
    let best = { size, y: 0, height: 0 }, error = Infinity;
    // SVG engines round font sizes to different subpixel grids. Calibrate the
    // nominal size before comparing the fonts' visible pixels.
    for (let attempt = 0; attempt < 5; attempt++) {
      reference.setAttribute('font-size', String(size));
      const bounds = reference.getBBox(), difference = Math.abs(bounds.height - height);
      if (difference < error) { best = { size, y: bounds.y, height: bounds.height }; error = difference; }
      if (!bounds.height || difference < .05) break;
      size *= height / bounds.height;
    }
    reference.setAttribute('font-size', String(best.size));
    return best;
  }
  private inkBounds(language: 'en' | 'zh', size: number): FontMetric {
    const extent = Math.ceil(size * 3), baseline = Math.ceil(size * 2);
    this.inkCanvas.width = this.inkCanvas.height = extent;
    const context = this.inkContext;
    context.font = `400 ${size}px ${FAMILIES[language]}`;
    context.fillText(this.references[language].textContent!, Math.ceil(size), baseline);
    const { data } = context.getImageData(0, 0, extent, extent);
    let top = extent, bottom = -1;
    for (let offset = 3; offset < data.length; offset += 4) {
      if (data[offset] <= 127) continue;
      const row = Math.floor(offset / (extent * 4));
      top = Math.min(top, row); bottom = Math.max(bottom, row);
    }
    return bottom < 0 ? { y: 0, height: 0 } : { y: top - baseline, height: bottom - top + 1 };
  }
  private fontAtInkHeight(language: 'en' | 'zh', size: number, height: number): { size: number; y: number; height: number } {
    let current = { size, ...this.inkBounds(language, size) }, best = current, error = Math.abs(current.height - height);
    for (let attempt = 0; attempt < 5 && error > 0 && current.height > 0; attempt++) {
      size = current.size * height / current.height;
      current = { size, ...this.inkBounds(language, size) };
      const difference = Math.abs(current.height - height);
      if (difference < error) { best = current; error = difference; }
    }
    return best;
  }
  private layout(): void {
    if (!this.fontsLoaded || !this.isConnected) return;
    if (!this.clientWidth || !this.clientHeight) { this.pause(); this.show(false); return; }
    if (!this.measureFonts()) return;
    const style = getComputedStyle(this), width = parseFloat(style.width), height = parseFloat(style.height);
    if (!width || !height) return;
    const glyphHeight = height / NOW_PLAYING_PANEL_HEIGHT * NOW_PLAYING_HEIGHT;
    this.svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    const en = this.fontAtHeight('en', glyphHeight);
    const enInk = this.inkBounds('en', en.size);
    // SVG text boxes include font padding. Match the visible pixels instead,
    // keeping the English size and raising Chinese to the same cap height.
    const faces = { en: { size: en.size, ...enInk },
      zh: this.fontAtInkHeight('zh', this.fontAtHeight('zh', en.height).size, enInk.height) };
    const nodes = nowPlayingRuns(this.text).map(run => {
      const node = document.createElementNS(SVG_NS, 'text'); node.dataset.language = run.language;
      node.textContent = run.text; node.style.fontFamily = FAMILIES[run.language];
      const face = faces[run.language];
      node.setAttribute('font-size', String(face.size));
      node.setAttribute('y', String(-face.y - face.height / 2));
      return node;
    });
    this.content.replaceChildren(...nodes);
    // Measure in unscaled local coordinates, including after a long previous title.
    this.content.removeAttribute('transform');
    const widths = nodes.map(node => node.getComputedTextLength());
    const total = widths.reduce((sum, value) => sum + value, 0);
    let x = -total / 2;
    nodes.forEach((node, index) => { node.setAttribute('x', String(x)); x += widths[index]; });
    const bounds = this.content.getBBox();
    const fit = Math.min(1, Math.max(1, width - 48 * height / NOW_PLAYING_PANEL_HEIGHT) / Math.max(1, bounds.width));
    this.content.setAttribute('transform', `translate(${width / 2} ${height / 2}) scale(${fit}) translate(${-bounds.x - bounds.width / 2} ${-bounds.y - bounds.height / 2})`);
    for (const language of ['en', 'zh'] as const) {
      this.references[language].setAttribute('font-size', String(faces[language].size * fit));
    }
    this.dataset.glyphHeight = String(en.height * fit);
    this.sync();
  }
  private show(lit: boolean): void {
    this.dataset.lit = String(lit); this.style.visibility = lit ? 'visible' : 'hidden';
  }
  private schedule(): void {
    const half = ON_AIR_BLINK / 2;
    this.timer = setTimeout(() => {
      this.timer = null;
      const now = performance.now(); this.elapsed += now - this.previousTime; this.previousTime = now;
      this.show(nowPlayingLit(this.elapsed)); this.schedule();
    }, Math.max(1, Math.ceil(half - this.elapsed % half)));
  }
  private pause(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    if (this.previousTime) this.elapsed += Math.max(0, performance.now() - this.previousTime);
    this.previousTime = 0;
  }
}

customElements.define('now-playing', NowPlaying);
