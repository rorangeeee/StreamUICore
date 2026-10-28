import { hexRgb, inverseRgb, mixRgb, sampleWordmark, TITLE_MIN_SPACING, TITLE_STEP, TITLE_TIMING, WORDMARKS, WORDMARK_STEP } from './wordmark-motion.ts';
import { titleAtStep } from './title-sequence.ts';

const SVG_NS = 'http://www.w3.org/2000/svg';
const CENTER_X = 500;
const CENTER_Y = 110;
const CAP_HEIGHT = 112;
const REST_WIDTH = 900;

interface GlyphLayer { group: SVGGElement; text: SVGTextElement; prefix: string; anchorX: number }
interface WordLayer { group: SVGGElement; glyphs: GlyphLayer[]; spacingAnchorX: number }

/** The brand and centered bilingual titles share the original playback clock and motion curve. */
export class KineticWordmark extends HTMLElement {
  static observedAttributes = ['inverted', 'effect'];
  private static playing = new Set<KineticWordmark>();
  private static elapsed = 0;
  private static previousTime = 0;
  private static animation = 0;
  private static filterId = 0;
  private static tick = (time: number): void => {
    // Do not wrap the clock: title sequences may have a different number of phrases.
    if (this.previousTime) this.elapsed += Math.min(time - this.previousTime, 100);
    this.previousTime = time;
    for (const wordmark of this.playing) wordmark.render(this.elapsed);
    this.animation = requestAnimationFrame(this.tick);
  };
  private svg!: SVGSVGElement;
  private layers: WordLayer[] = [];
  private defs!: SVGDefsElement;
  private blurLayer: SVGGElement | null = null;
  private blurEffect: SVGFEGaussianBlurElement | null = null;
  private filter: SVGFilterElement | null = null;
  private filterWidth = 2000;
  private filterHeight = 220;
  private blurOnly = false;
  private titleMode = false;
  private phrases: readonly string[] = WORDMARKS;
  private bilingual: { englishCount: number; chineseCount: number } | null = null;
  private base: [number, number, number] = [64, 0, 158];
  private highlight: [number, number, number] = inverseRgb(this.base);
  private ready = false;
  private generation = 0;
  private observer: ResizeObserver | null = null;
  private fontSignature = '';
  private renderSignature = '';
  private activeLayer: WordLayer | null = null;
  private reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  private syncPlayback = () => {
    const clock = KineticWordmark;
    if (this.ready && this.isConnected && !document.hidden && !this.reducedMotion.matches) clock.playing.add(this);
    else clock.playing.delete(this);
    if (this.ready && this.isConnected) this.render(this.reducedMotion.matches ? 0 : clock.elapsed);
    if (!clock.playing.size) {
      cancelAnimationFrame(clock.animation); clock.animation = 0; clock.previousTime = 0;
    } else if (!clock.animation) clock.animation = requestAnimationFrame(clock.tick);
  };

  connectedCallback(): void {
    this.titleMode = this.hasAttribute('title-text');
    if (!this.svg) {
      if (this.titleMode) {
        this.phrases = this.hasAttribute('bilingual') ? ['TITLE', '标题'] : [this.getAttribute('lang') === 'zh' ? '标题' : 'TITLE'];
        if (this.hasAttribute('bilingual')) this.bilingual = { englishCount: 1, chineseCount: 1 };
      }
      this.build();
    }
    document.addEventListener('visibilitychange', this.syncPlayback);
    this.reducedMotion.addEventListener('change', this.syncPlayback);
    this.readPalette();
    this.observer = new ResizeObserver(() => {
      const style = getComputedStyle(this);
      if (this.titleMode && this.fontSignature !== `${style.fontFamily}|${style.fontSize}|${this.clientWidth}|${this.clientHeight}`) void this.loadFonts();
    });
    this.observer.observe(this);
    if (this.ready) this.syncPlayback(); else void this.loadFonts();
  }
  disconnectedCallback(): void {
    this.syncPlayback(); this.observer?.disconnect();
    document.removeEventListener('visibilitychange', this.syncPlayback);
    this.reducedMotion.removeEventListener('change', this.syncPlayback);
  }
  attributeChangedCallback(name: string): void {
    if (!this.svg) return;
    if (name === 'effect') this.blurOnly = this.getAttribute('effect') === 'blur';
    this.readPalette();
    if (this.ready) this.render(this.reducedMotion.matches ? 0 : KineticWordmark.elapsed);
  }
  setWords(words: readonly string[]): void {
    const phrases = words.map(word => word.trim()).filter(Boolean);
    if (!phrases.length || (!this.bilingual && JSON.stringify(phrases) === JSON.stringify(this.phrases))) return;
    this.bilingual = null;
    this.phrases = phrases;
    this.ready = false; this.syncPlayback(); this.build(); this.readPalette();
    if (this.isConnected) void this.loadFonts();
  }
  setTitles(english: readonly string[], chinese: readonly string[]): void {
    const en = english.map(text => text.trim()).filter(Boolean);
    const zh = chinese.map(text => text.trim()).filter(Boolean);
    if (!en.length) en.push('TITLE');
    if (!zh.length) zh.push('标题');
    const phrases = [...en, ...zh];
    if (this.bilingual?.englishCount === en.length && this.bilingual?.chineseCount === zh.length && JSON.stringify(phrases) === JSON.stringify(this.phrases)) return;
    this.bilingual = { englishCount: en.length, chineseCount: zh.length };
    this.phrases = phrases;
    this.ready = false; this.syncPlayback(); this.build(); this.readPalette();
    if (this.isConnected) void this.loadFonts();
  }
  private build(): void {
    this.activeLayer = null; this.renderSignature = '';
    this.blurLayer = null; this.blurEffect = null; this.filter = null;
    this.filterWidth = 2000; this.filterHeight = 220;
    this.svg = document.createElementNS(SVG_NS, 'svg');
    this.svg.setAttribute('viewBox', '0 40 1000 140');
    this.svg.setAttribute('role', 'img');
    this.svg.setAttribute('aria-label', `${this.phrases.join('、')} 循环文字动效`);
    this.svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    this.blurOnly = this.getAttribute('effect') === 'blur';
    this.defs = document.createElementNS(SVG_NS, 'defs');
    this.svg.append(this.defs);
    this.layers = this.phrases.map((word, index) => {
      const group = document.createElementNS(SVG_NS, 'g');
      if (this.bilingual) group.dataset.language = index < this.bilingual.englishCount ? 'en' : 'zh';
      group.classList.add('wordmark-phrase'); group.setAttribute('fill', 'currentColor'); group.setAttribute('visibility', 'hidden');
      group.setAttribute('display', 'none');
      const glyphs: GlyphLayer[] = [];
      let prefix = '';
      for (const character of word) {
        if (character !== ' ') {
          const glyphGroup = document.createElementNS(SVG_NS, 'g'); glyphGroup.classList.add('wordmark-glyph');
          const text = document.createElementNS(SVG_NS, 'text'); text.textContent = character;
          glyphGroup.append(text); group.append(glyphGroup);
          glyphs.push({ group: glyphGroup, text, prefix, anchorX: 0 });
        }
        prefix += character;
      }
      this.svg.append(group);
      return { group, glyphs, spacingAnchorX: CENTER_X };
    });
    this.replaceChildren(this.svg);
  }
  private async loadFonts(): Promise<void> {
    const generation = ++this.generation;
    const style = getComputedStyle(this);
    this.fontSignature = `${style.fontFamily}|${style.fontSize}|${this.clientWidth}|${this.clientHeight}`;
    const fonts = this.layers.map(layer => {
      const textStyle = this.bilingual ? getComputedStyle(layer.group) : style;
      return { family: textStyle.fontFamily, size: this.titleMode ? parseFloat(textStyle.fontSize) : 160 };
    });
    let fontStatus = 'ready';
    const requests = new Map<string, string>();
    fonts.forEach((font, index) => {
      const definition = `400 ${font.size}px ${font.family}`;
      requests.set(definition, (requests.get(definition) ?? '') + this.phrases[index]);
    });
    const loaded = await Promise.allSettled([...requests].map(([font, text]) => document.fonts.load(font, text)));
    if (loaded.some(result => result.status === 'rejected')) fontStatus = 'fallback';
    if (!this.isConnected || generation !== this.generation) return;
    const context = document.createElement('canvas').getContext('2d')!;
    const measurements = this.phrases.map((word, index) => {
      const font = fonts[index];
      context.font = `400 ${font.size}px ${font.family}`;
      const metrics = context.measureText(word);
      return { metrics, width: metrics.actualBoundingBoxLeft + metrics.actualBoundingBoxRight, height: metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent || font.size * .7 };
    });
    const capHeight = Math.min(CAP_HEIGHT, REST_WIDTH / Math.max(...measurements.map(item => item.width / item.height)));
    const titleWidth = this.clientWidth || 2265.558;
    const titleHeight = this.clientHeight || 220;
    const uiScale = parseFloat(style.getPropertyValue('--ui-scale')) || 1;
    const titleReferenceWidth = (parseFloat(style.getPropertyValue('--title-reference-width')) || 0) * uiScale;
    const titleScale = Math.min(1, titleHeight / (276.2784 * uiScale),
      Math.max(1, Math.max(titleWidth, titleReferenceWidth) - parseFloat(style.fontSize) * 2.8) / Math.max(1, ...measurements.map(item => item.width)));
    const centeredTitle = style.getPropertyValue('--title-centered').trim() === '1';
    const titleCenterX = centeredTitle ? titleWidth / 2 : Math.max(titleWidth / 2,
      titleReferenceWidth ? Math.max(...measurements.map(item => item.width)) * titleScale / 2 + 16 * uiScale : 0);
    const titleBaseline = titleHeight / 2 + ((parseFloat(style.lineHeight) || 168.55 * uiScale) - 276.2784 * uiScale / 2) * titleScale;
    if (this.titleMode) {
      this.svg.setAttribute('viewBox', `0 0 ${titleWidth} ${titleHeight}`);
      this.filterWidth = Math.max(2000, Math.max(titleWidth, titleReferenceWidth) + 1000); this.filterHeight = titleHeight;
      this.filter?.setAttribute('width', String(this.filterWidth));
      this.filter?.setAttribute('height', String(this.filterHeight));
    }
    this.layers.forEach((layer, index) => {
      const { family, size: fontSize } = fonts[index];
      const { metrics, height } = measurements[index];
      const scale = this.titleMode ? titleScale : capHeight / height;
      const centerX = this.titleMode ? titleCenterX : CENTER_X;
      const x = centerX + (metrics.actualBoundingBoxLeft - metrics.actualBoundingBoxRight) * scale / 2;
      const y = this.titleMode ? titleBaseline : CENTER_Y + (metrics.actualBoundingBoxAscent - metrics.actualBoundingBoxDescent) * scale / 2;
      context.font = `400 ${fontSize * scale}px ${family}`;
      for (const glyph of layer.glyphs) {
        const glyphX = x + context.measureText(glyph.prefix).width;
        const glyphMetrics = context.measureText(glyph.text.textContent!);
        glyph.anchorX = glyphX + (glyphMetrics.actualBoundingBoxRight - glyphMetrics.actualBoundingBoxLeft) / 2;
        glyph.text.setAttribute('font-size', String(fontSize * scale));
        glyph.text.setAttribute('x', String(glyphX)); glyph.text.setAttribute('y', String(y));
      }
      // Both ends contract symmetrically toward the shared center of the title area.
      layer.spacingAnchorX = centerX;
    });
    this.renderSignature = ''; this.ready = true; this.dataset.fonts = fontStatus; this.syncPlayback();
  }
  private readPalette(): void {
    this.renderSignature = '';
    const style = getComputedStyle(this);
    this.base = hexRgb(style.getPropertyValue('--wordmark-color').trim() || style.getPropertyValue('--accent').trim());
    if (this.hasAttribute('inverted')) this.base = inverseRgb(this.base);
    const highlight = style.getPropertyValue('--wordmark-highlight').trim();
    this.highlight = highlight ? hexRgb(highlight) : this.titleMode ? [0, 0, 0] : inverseRgb(this.base);
  }
  refreshPalette(): void {
    this.readPalette();
    if (this.ready) this.render(this.reducedMotion.matches ? 0 : KineticWordmark.elapsed);
    if (this.titleMode && this.isConnected) void this.loadFonts();
  }
  private renderBlur(active: WordLayer, blurX: number): void {
    if (blurX <= 0) {
      if (!this.blurLayer) return;
      // Release the temporary filtered surface so the rotated wordmark rests
      // on a fresh, unfiltered surface without cached highlight edges.
      this.svg.append(active.group);
      this.blurLayer.remove(); this.filter?.remove();
      this.blurLayer = null; this.blurEffect = null; this.filter = null;
      return;
    }
    if (!this.blurLayer) {
      this.filter = document.createElementNS(SVG_NS, 'filter');
      this.filter.id = `wordmark-blur-${KineticWordmark.filterId++}`;
      this.filter.setAttribute('filterUnits', 'userSpaceOnUse');
      this.filter.setAttribute('x', '-500'); this.filter.setAttribute('y', '0');
      this.filter.setAttribute('width', String(this.filterWidth)); this.filter.setAttribute('height', String(this.filterHeight));
      this.filter.setAttribute('color-interpolation-filters', 'sRGB');
      this.blurEffect = document.createElementNS(SVG_NS, 'feGaussianBlur');
      this.blurEffect.setAttribute('in', 'SourceGraphic');
      this.blurEffect.setAttribute('edgeMode', 'none');
      this.filter.append(this.blurEffect); this.defs.append(this.filter);
      this.blurLayer = document.createElementNS(SVG_NS, 'g');
      this.blurLayer.setAttribute('filter', `url(#${this.filter.id})`);
      this.svg.append(this.blurLayer);
    }
    this.blurEffect!.setAttribute('stdDeviation', `${blurX} 0`);
    if (active.group.parentNode !== this.blurLayer) this.blurLayer.append(active.group);
  }
  private render(time: number): void {
    const state = sampleWordmark(time, this.phrases.length, this.blurOnly ? TITLE_MIN_SPACING : undefined, this.titleMode ? TITLE_TIMING : undefined);
    const step = Math.floor(Math.max(0, time) / (this.titleMode ? TITLE_STEP : WORDMARK_STEP)) + (state.phase === 'shrink' ? 1 : 0);
    const title = this.bilingual ? titleAtStep(step, this.bilingual.englishCount, this.bilingual.chineseCount) : null;
    const index = title?.layerIndex ?? (state.phase === 'shrink' ? state.to : state.from);
    const active = this.layers[index];
    if (!active) return;
    const signature = `${index}|${state.phase}|${state.light}|${state.blurX}|${state.spacingScale}`;
    if (this.renderSignature === signature) return;
    this.renderSignature = signature;
    this.dataset.phase = state.phase; this.dataset.word = this.phrases[index];
    if (title) this.dataset.language = title.language;
    this.svg.style.color = mixRgb(this.base, this.highlight, state.light);
    if (this.activeLayer !== active) {
      if (this.activeLayer) {
        this.activeLayer.group.setAttribute('visibility', 'hidden');
        this.activeLayer.group.setAttribute('display', 'none');
        this.svg.append(this.activeLayer.group);
      }
      active.group.removeAttribute('display');
      active.group.setAttribute('visibility', 'visible'); this.activeLayer = active;
    }
    this.renderBlur(active, state.blurX);
    const scaleX = this.blurOnly ? 1 : state.glyphScaleX;
    for (const glyph of active.glyphs) {
      const anchorX = active.spacingAnchorX + (glyph.anchorX - active.spacingAnchorX) * state.spacingScale;
      glyph.group.setAttribute('transform', `translate(${anchorX} 0) scale(${scaleX} 1) translate(${-glyph.anchorX} 0)`);
    }
  }
}
customElements.define('kinetic-wordmark', KineticWordmark);
