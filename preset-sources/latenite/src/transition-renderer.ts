import './transition-effects.css';
import { stageDividerPaths } from './stage-dividers.ts';
import type { StageMode } from './stage-layout.ts';
import { sampleTransition, transitionTiles, TRANSITION_DURATION, TRANSITION_PURPLE, TRANSITION_SEED, TRANSITION_TUNNEL_RECTS } from './transition-model.ts';
import { transitionLayout } from './transition-settings.ts';
import type { TransitionSettings } from './transition-settings.ts';

const NS = 'http://www.w3.org/2000/svg';
const element = <K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}): SVGElementTagNameMap[K] => {
  const node = document.createElementNS(NS, tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
  return node;
};

function chatEdges(x: number, y: number, width: number, height: number, angle: number, uiScale: number): string[] {
  const theta = -16 * Math.PI / 180, rotation = angle * Math.PI / 180, perspective = 2200 * uiScale;
  const corners = [[0, 0], [width, 0], [width, height], [0, height]].map(([px, py]) => {
    const dx = px - width / 2, dy = py - height / 2;
    const z = -dx * Math.sin(theta), projection = perspective / (perspective - z);
    const rx = dx * Math.cos(theta) * projection, ry = dy * projection;
    return [x + width / 2 + rx * Math.cos(rotation) - ry * Math.sin(rotation), y + height / 2 + rx * Math.sin(rotation) + ry * Math.cos(rotation)];
  });
  return corners.map((point, index) => `M${point.join(' ')} L${corners[(index + 1) % 4].join(' ')}`);
}

/** The live output and the seekable preview use the same layers and design clock. */
export class TransitionRenderer {
  private arrivalBase = element('svg', { class: 'transition-layer transition-arrival-base', 'aria-hidden': 'true' });
  private mask = element('mask', { id: 'transition-arrival-mask', x: 0, y: 0, maskUnits: 'userSpaceOnUse', style: 'mask-type:luminance' });
  private maskField = element('rect', { fill: '#fff' });
  private captureHole = element('rect', { fill: '#000' });
  private arrivalBlack = element('rect', { fill: '#000', mask: 'url(#transition-arrival-mask)' });
  private capturePixels = element('g', { class: 'transition-capture-pixels', fill: '#000', 'shape-rendering': 'crispEdges' });
  private outlines = element('svg', { class: 'transition-layer transition-outlines', 'aria-hidden': 'true' });
  private outlinePaths = Array.from({ length: 4 }, () => element('path', { pathLength: 1 }));
  private cover = element('svg', { class: 'transition-layer transition-cover', 'aria-hidden': 'true' });
  private coverRect = element('rect');
  private grid = element('svg', { class: 'transition-layer transition-grid', 'shape-rendering': 'crispEdges', fill: TRANSITION_PURPLE, 'aria-hidden': 'true' });
  private tunnel = element('svg', { class: 'transition-layer transition-tunnel', 'aria-hidden': 'true' });
  private tunnelRects = Array.from({ length: TRANSITION_TUNNEL_RECTS }, () => element('rect', { 'vector-effect': 'non-scaling-stroke' }));
  private rescaling = element('svg', { class: 'transition-layer transition-text', 'aria-hidden': 'true' });
  private rescalingText = element('text', { 'text-anchor': 'middle' });
  private tiles: SVGRectElement[] = [];
  private previousTileCount = 0;
  private captureTiles: SVGRectElement[] = [];
  private previousDissolvedCount = 0;
  private components: HTMLElement[] = [];
  private canvas = { width: 3840, height: 2160 };

  constructor(private surface: HTMLElement, private workspace: HTMLElement, private live = false, private seed = TRANSITION_SEED) {
    surface.classList.add('transition-surface');
    surface.dataset.live = String(live);
    const defs = element('defs');
    this.mask.append(this.maskField, this.captureHole); defs.append(this.mask);
    this.arrivalBase.append(defs, this.arrivalBlack, this.capturePixels);
    this.outlines.append(...this.outlinePaths);
    this.cover.append(this.coverRect);
    this.tunnel.append(...this.tunnelRects);
    this.rescalingText.textContent = 'RESCALING'; this.rescaling.append(this.rescalingText);
    workspace.before(this.arrivalBase);
    surface.append(this.outlines, this.cover, this.grid, this.tunnel, this.rescaling);
    this.reset();
    void document.fonts.load('400 190px "StreamUI Retro Pixel"', 'RESCALING').then(() => this.fitText()).catch(() => {});
  }

  configure(settings: TransitionSettings, target: StageMode): void {
    this.canvas = settings.canvas;
    const { width, height } = this.canvas, uiScale = Math.min(width / 3840, height / 2160);
    const layout = structuredClone(transitionLayout(settings, target));
    if (target === '16:9') Object.assign(layout.windows['stream-window'], { x: 0, y: 0, width: 1, height: 1, angle: 0 });
    const rectangles = Object.fromEntries(Object.entries(layout.windows).map(([id, r]) => [id, { ...r, x: r.x * width, y: r.y * height, width: r.width * width, height: r.height * height }]));
    for (const svg of [this.arrivalBase, this.outlines, this.cover, this.grid, this.tunnel, this.rescaling]) svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    for (const rect of [this.maskField, this.arrivalBlack, this.coverRect]) { rect.setAttribute('width', String(width)); rect.setAttribute('height', String(height)); }
    for (const [key, value] of Object.entries({ width, height })) this.mask.setAttribute(key, String(value));
    const stream = rectangles['stream-window'];
    for (const [key, value] of Object.entries({ x: stream.x, y: stream.y, width: stream.width, height: stream.height,
      transform: `rotate(${stream.angle} ${stream.x + stream.width / 2} ${stream.y + stream.height / 2})` })) this.captureHole.setAttribute(key, String(value));
    this.capturePixels.setAttribute('transform', `translate(${stream.x} ${stream.y}) rotate(${stream.angle} ${stream.width / 2} ${stream.height / 2})`);
    this.captureTiles = transitionTiles(stream.width, stream.height, 300, this.seed).map(tile => element('rect', { ...tile, visibility: 'visible' }));
    this.capturePixels.replaceChildren(...this.captureTiles); this.previousDissolvedCount = 0;
    const chat = rectangles['chat-window'];
    const paths = target === '21:9' ? Object.values(stageDividerPaths(stream, rectangles['spectrogram-window'], rectangles['waveform-window']))
      : chatEdges(chat.x, chat.y, chat.width, chat.height, chat.angle, uiScale);
    this.outlinePaths.forEach((path, index) => path.setAttribute('d', paths[index]));
    this.outlines.style.strokeWidth = String((target === '21:9' ? 4 : 1.6) * uiScale);
    this.tunnel.style.strokeWidth = String(4 * uiScale);
    this.tiles = transitionTiles(width, height, 300, this.seed).map(tile => element('rect', { ...tile, visibility: 'hidden' }));
    this.grid.replaceChildren(...this.tiles); this.previousTileCount = 0;
    this.clearComponents();
    const selectors = ['#wordmark-blur-window', '#wordmark-window', '#chat-window',
      ...(target === '21:9' ? ['#spectrogram-window', '#waveform-window', '#stream-window'] : ['now-playing']),
      'stream-marquee[data-band="bottom-secondary"]', 'stream-marquee[data-band="bottom-primary"]'];
    this.components = selectors.map(selector => this.workspace.querySelector<HTMLElement>(selector)!).filter(Boolean);
    this.fitText();
  }

  private fitText(): void {
    const { width, height } = this.canvas;
    const context = document.createElement('canvas').getContext('2d')!;
    let size = 190 * Math.min(width / 3840, height / 2160);
    context.font = `400 ${size}px "StreamUI Retro Pixel", monospace`;
    size *= Math.min(1, width * .72 / context.measureText('RESCALING').width);
    context.font = `400 ${size}px "StreamUI Retro Pixel", monospace`;
    const metrics = context.measureText('RESCALING');
    this.rescalingText.setAttribute('font-size', String(size)); this.rescalingText.setAttribute('x', String(width / 2));
    this.rescalingText.setAttribute('y', String(height / 2 + (metrics.actualBoundingBoxAscent - metrics.actualBoundingBoxDescent) / 2));
  }

  draw(time: number): ReturnType<typeof sampleTransition> {
    const state = sampleTransition(Math.min(TRANSITION_DURATION, Math.max(0, time)), this.tiles.length, this.components.length, this.captureTiles.length);
    this.surface.dataset.phase = state.phase;
    this.surface.dataset.frame = String(Math.round(state.frame));
    this.surface.dataset.opaque = String(state.fullyOpaque);
    this.surface.dataset.arrival = String(state.arrivalVisible);
    this.grid.style.display = state.phase === 'fill' ? 'block' : 'none';
    for (let i = Math.min(this.previousTileCount, state.visibleTiles); i < Math.max(this.previousTileCount, state.visibleTiles); i++)
      this.tiles[i].setAttribute('visibility', i < state.visibleTiles ? 'visible' : 'hidden');
    this.previousTileCount = state.visibleTiles;
    for (let i = Math.min(this.previousDissolvedCount, state.captureDissolvedTiles); i < Math.max(this.previousDissolvedCount, state.captureDissolvedTiles); i++)
      this.captureTiles[i].setAttribute('visibility', i < state.captureDissolvedTiles ? 'hidden' : 'visible');
    this.previousDissolvedCount = state.captureDissolvedTiles;
    this.cover.style.visibility = state.cover ? 'visible' : 'hidden';
    if (state.cover) this.coverRect.setAttribute('fill', state.cover);
    this.rescaling.style.visibility = state.textVisible ? 'visible' : 'hidden'; this.rescaling.style.color = state.textColor;
    this.rescaling.style.opacity = String(state.textOpacity);
    this.tunnel.style.visibility = state.tunnelVisible ? 'visible' : 'hidden';
    const { width, height } = this.canvas;
    this.tunnelRects.forEach((rect, index) => {
      rect.style.visibility = state.tunnelRects[index] ? 'visible' : 'hidden';
      const w = width * .96 * .76 ** index * state.tunnelScale, h = w * 9 / 16;
      for (const [key, value] of Object.entries({ x: (width - w) / 2, y: (height - h) / 2, width: w, height: h })) rect.setAttribute(key, String(value));
    });
    const showLive = this.live && (state.phase === 'fill' || state.phase === 'complete');
    this.workspace.style.opacity = state.arrivalVisible || showLive ? '1' : '0';
    this.workspace.setAttribute('aria-hidden', String(!state.arrivalVisible && !showLive));
    this.arrivalBase.style.opacity = this.outlines.style.opacity = state.arrivalVisible ? '1' : '0';
    this.components.forEach((node, index) => node.style.opacity = showLive ? '' : state.components[index] ? '1' : '0');
    this.outlinePaths.forEach((path, index) => {
      const p = state.lineProgress[index];
      path.style.visibility = p > 0 ? 'visible' : 'hidden';
      path.setAttribute('stroke-dasharray', p >= 1 ? 'none' : `${p} 1`);
      path.setAttribute('stroke-dashoffset', String(-(1 - p) / 2));
    });
    return state;
  }

  private clearComponents(): void { this.components.forEach(node => node.style.removeProperty('opacity')); }

  reset(): void {
    this.clearComponents();
    this.workspace.style.removeProperty('opacity');
    this.workspace.removeAttribute('aria-hidden');
    this.surface.dataset.phase = 'idle';
    this.surface.dataset.arrival = 'false';
    this.surface.dataset.opaque = 'false';
    // Inline display from a previous fill must not override the idle CSS rule.
    this.grid.style.removeProperty('display');
  }
}
