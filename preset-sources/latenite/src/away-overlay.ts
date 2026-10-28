import './away-overlay.css';
import { AwayMotion, AWAY_DEFAULTS, AWAY_GEOMETRY, awayMessages } from './away-motion.ts';
import { mixedTextRuns, PIXEL_FONT_FAMILIES } from './mixed-text.ts';
import type { TextLanguage } from './mixed-text.ts';
import type { AwaySettings } from './host-client.ts';

const NS = 'http://www.w3.org/2000/svg';
const svgElement = <K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}): SVGElementTagNameMap[K] => {
  const element = document.createElementNS(NS, tag);
  for (const [key, value] of Object.entries(attrs)) element.setAttribute(key, String(value));
  return element;
};
interface InkFace { size: number; ascent: number; descent: number; height: number }

/** A separate top layer so layout changes and their opaque covers stay underneath. */
export class AwayOverlay extends HTMLElement {
  private scrim = document.createElement('div');
  private band = document.createElement('div');
  private ticker = svgElement('svg', { class: 'away-ticker', 'aria-hidden': 'true' });
  private settings: AwaySettings = { ...AWAY_DEFAULTS };
  private motion = new AwayMotion();
  private initialized = false;
  private fontsLoaded = false;
  private signature = '';
  private inkCanvas = document.createElement('canvas');
  private inkContext = this.inkCanvas.getContext('2d', { willReadFrequently: true })!;
  private observer: ResizeObserver | null = null;
  private tickerAnimation: Animation | null = null;
  private scrollSpeed = 0;
  private animation = 0;
  private previousTime = 0;
  private reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  private visibility = () => {
    cancelAnimationFrame(this.animation); this.animation = 0; this.previousTime = 0;
    this.motion.setEnabled(this.settings.enabled, true);
    this.draw();
    this.layout();
  };

  connectedCallback(): void {
    this.scrim.className = 'away-scrim'; this.band.className = 'away-band';
    this.band.append(this.ticker); this.replaceChildren(this.scrim, this.band);
    this.setAttribute('role', 'status'); this.setAttribute('aria-live', 'polite');
    this.observer = new ResizeObserver(() => this.layout()); this.observer.observe(this);
    document.addEventListener('visibilitychange', this.visibility);
    this.reducedMotion.addEventListener('change', this.visibility);
    this.draw();
    void Promise.allSettled([
      document.fonts.load(`400 160px ${PIXEL_FONT_FAMILIES.en}`, 'H AWAY BE RIGHT BACK'),
      document.fonts.load(`400 160px ${PIXEL_FONT_FAMILIES.zh}`, '国主播暂离马上回来'),
    ]).then(results => {
      if (!this.isConnected) return;
      this.fontsLoaded = true;
      this.dataset.fonts = results.every(result => result.status === 'fulfilled' && result.value.length > 0) ? 'ready' : 'fallback';
      this.layout();
    });
  }

  disconnectedCallback(): void {
    cancelAnimationFrame(this.animation); this.animation = 0;
    this.observer?.disconnect(); this.tickerAnimation?.cancel(); this.tickerAnimation = null; this.signature = '';
    document.removeEventListener('visibilitychange', this.visibility);
    this.reducedMotion.removeEventListener('change', this.visibility);
  }

  update(settings?: AwaySettings): void {
    const previous = this.settings.enabled;
    this.settings = { ...(settings ?? AWAY_DEFAULTS) };
    const label = awayMessages(this.settings).join(' / ');
    if (this.getAttribute('aria-label') !== label) this.setAttribute('aria-label', label);
    if (!this.initialized || previous !== this.settings.enabled) {
      this.motion.setEnabled(this.settings.enabled, !this.initialized || document.hidden || this.reducedMotion.matches);
      this.initialized = true;
    }
    this.hidden = false;
    this.layout(); this.draw();
    if (this.motion.running && !this.animation) { this.previousTime = performance.now(); this.animation = requestAnimationFrame(this.tick); }
  }

  private ink(language: TextLanguage, size: number): InkFace {
    const extent = Math.ceil(size * 3), baseline = Math.ceil(size * 2);
    this.inkCanvas.width = this.inkCanvas.height = extent;
    const context = this.inkContext;
    context.font = `400 ${size}px ${PIXEL_FONT_FAMILIES[language]}`;
    context.fillText(language === 'en' ? 'H' : '国', Math.ceil(size), baseline);
    const { data } = context.getImageData(0, 0, extent, extent);
    let top = extent, bottom = -1;
    for (let i = 3; i < data.length; i += 4) if (data[i] > 127) {
      const row = Math.floor(i / (extent * 4)); top = Math.min(top, row); bottom = Math.max(bottom, row);
    }
    return { size, ascent: baseline - top, descent: bottom - baseline + 1, height: Math.max(1, bottom - top + 1) };
  }

  private face(language: TextLanguage, height: number): InkFace {
    const reference = this.ink(language, 100);
    let current = this.ink(language, 100 * height / reference.height), best = current;
    for (let i = 0; i < 4 && Math.abs(best.height - height) > .5; i++) {
      current = this.ink(language, current.size * height / current.height);
      if (Math.abs(current.height - height) < Math.abs(best.height - height)) best = current;
    }
    return best;
  }

  private layout(): void {
    if (!this.fontsLoaded || !this.isConnected || this.hidden || !this.clientWidth || !this.clientHeight) return;
    const width = this.clientWidth, height = this.clientHeight, scale = Math.min(width / 3840, height / 2160);
    const messages = awayMessages(this.settings);
    const signature = JSON.stringify([width, height, messages, this.reducedMotion.matches]);
    if (signature === this.signature) return;
    this.signature = signature;
    const offset = Number(this.tickerAnimation?.currentTime ?? 0) / 1000 * this.scrollSpeed;
    this.tickerAnimation?.cancel(); this.tickerAnimation = null;
    const g = AWAY_GEOMETRY, bandHeight = g.bandHeight * scale;
    Object.assign(this.band.style, { top: `${(height - bandHeight) / 2}px`, height: `${bandHeight}px` });
    const faces = { en: this.face('en', g.glyphHeight * scale), zh: this.face('zh', g.glyphHeight * scale) };
    for (const language of ['en', 'zh'] as const) {
      this.dataset[`size${language === 'en' ? 'En' : 'Zh'}`] = String(faces[language].size);
      this.dataset[`height${language === 'en' ? 'En' : 'Zh'}`] = String(faces[language].height);
    }
    const defs = svgElement('defs');
    const hatch = svgElement('pattern', { id: 'away-hatch', width: 32 * scale, height: 32 * scale, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)' });
    hatch.append(svgElement('rect', { width: 8 * scale, height: 32 * scale, fill: '#000' })); defs.append(hatch);
    const unit = svgElement('g', { class: 'away-unit' });
    this.ticker.replaceChildren(defs, unit);
    let x = 0;
    for (const message of messages) {
      const group = svgElement('g', { class: 'away-phrase' });
      for (const run of mixedTextRuns(message)) {
        const face = faces[run.language];
        const node = svgElement('text', { class: 'away-message', x, y: bandHeight / 2 + (face.ascent - face.descent) / 2, 'font-size': face.size });
        node.style.fontFamily = PIXEL_FONT_FAMILIES[run.language]; node.dataset.language = run.language;
        node.textContent = run.text; group.append(node); unit.append(group);
        x += node.getComputedTextLength();
      }
      x += g.gap * scale;
      unit.append(svgElement('rect', { class: 'away-separator', fill: 'url(#away-hatch)', x, y: (bandHeight - g.separatorHeight * scale) / 2, width: g.separatorWidth * scale, height: g.separatorHeight * scale }));
      x += (g.separatorWidth + g.gap) * scale;
    }
    const unitWidth = Math.max(1, x), copies = Math.max(2, Math.ceil(width / unitWidth) + 1);
    for (let i = 1; i < copies; i++) {
      const copy = unit.cloneNode(true) as SVGGElement;
      copy.setAttribute('transform', `translate(${i * unitWidth} 0)`); this.ticker.append(copy);
    }
    for (const [key, value] of Object.entries({ width: unitWidth * copies, height: bandHeight, viewBox: `0 0 ${unitWidth * copies} ${bandHeight}` })) this.ticker.setAttribute(key, String(value));
    this.dataset.unitWidth = String(unitWidth); this.dataset.copies = String(copies);
    this.scrollSpeed = g.speed * scale;
    if (!this.reducedMotion.matches) {
      this.tickerAnimation = this.ticker.animate([{ transform: 'translate3d(0,0,0)' }, { transform: `translate3d(${-unitWidth}px,0,0)` }],
        { duration: unitWidth / this.scrollSpeed * 1000, iterations: Infinity, easing: 'linear' });
      this.tickerAnimation.currentTime = offset % unitWidth / this.scrollSpeed * 1000; this.tickerAnimation.pause();
    }
    this.draw();
  }

  private tick = (time: number) => {
    this.motion.advance(this.previousTime ? time - this.previousTime : 0); this.previousTime = time;
    this.draw();
    this.animation = this.motion.running && !document.hidden ? requestAnimationFrame(this.tick) : 0;
    if (!this.animation) this.previousTime = 0;
  };

  private draw(): void {
    const state = this.motion.read(), g = AWAY_GEOMETRY;
    const scale = Math.min(this.clientWidth / 3840, this.clientHeight / 2160);
    if (scale > 0) Object.assign(this.band.style, { top: `${(this.clientHeight - g.bandHeight * scale) / 2}px`, height: `${g.bandHeight * scale}px` });
    this.dataset.phase = state.phase; this.dataset.enabled = String(this.settings.enabled);
    this.setAttribute('aria-hidden', String(!this.settings.enabled));
    this.scrim.style.opacity = String(state.mask * this.settings.overlayOpacity);
    this.band.style.transform = `translate3d(${state.offset * this.clientWidth}px,0,0) scaleX(${state.width}) scaleY(${(g.lineHeight + (g.bandHeight - g.lineHeight) * state.expand) / g.bandHeight})`;
    this.ticker.style.opacity = String(state.text);
    const scrolling = state.text > 0 && this.settings.enabled && !document.hidden && !this.reducedMotion.matches;
    if (scrolling) { if (this.tickerAnimation?.playState !== 'running') this.tickerAnimation?.play(); }
    else this.tickerAnimation?.pause();
    this.hidden = !this.settings.enabled && !this.motion.running && state.mask === 0;
  }
}
customElements.define('away-banner', AwayOverlay);
