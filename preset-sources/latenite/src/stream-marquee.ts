import { MARQUEE_BANDS } from './marquee-bands.ts';
import { GLOW_DURATION, marqueeGlowKeyframes } from './marquee-motion.ts';

const GLOW_FRAMES = { text: marqueeGlowKeyframes('text'), purple: marqueeGlowKeyframes('purple'), green: marqueeGlowKeyframes('green') };

/** Repeated copies form a continuous belt; each belt's period follows its measured width and speed. */
export class StreamMarquee extends HTMLElement {
  private track!: HTMLDivElement;
  private content!: HTMLDivElement;
  private highlight!: HTMLDivElement;
  private halos!: HTMLDivElement;
  private blooms: HTMLDivElement[] = [];
  private unit!: HTMLDivElement;
  private band: typeof MARQUEE_BANDS[keyof typeof MARQUEE_BANDS] = MARQUEE_BANDS['bottom-primary'];
  private observer: ResizeObserver | null = null;
  private playback: Animation | null = null;
  private glow: Animation[] = [];
  private glowTimer: ReturnType<typeof setTimeout> | null = null;
  private glowDeadline = 0;
  private glowRemaining = 4000 + Math.random() * 12000;
  private duration = 0;
  private signature = '';
  private reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  private refresh = () => { this.layout(); this.visibility(); };
  private visibility = () => {
    if (document.hidden || this.reducedMotion.matches || !this.isConnected) {
      this.playback?.pause(); this.glow.forEach(animation => animation.pause()); this.pauseGlowTimer();
      if (this.reducedMotion.matches) {
        this.glow.forEach(animation => animation.cancel()); this.glow = []; this.dataset.glow = 'idle';
      }
    } else {
      this.playback?.play(); this.glow.forEach(animation => animation.play()); this.scheduleGlow();
    }
  };

  connectedCallback(): void {
    if (!this.track) {
      this.band = MARQUEE_BANDS[this.dataset.band as keyof typeof MARQUEE_BANDS] ?? MARQUEE_BANDS['bottom-primary'];
      this.dataset.speed = String(this.band.speed); this.dataset.direction = this.band.direction;
      this.setAttribute('aria-label', this.band.text.join(' · '));
      this.track = document.createElement('div'); this.track.className = 'marquee-track'; this.track.setAttribute('aria-hidden', 'true');
      this.content = document.createElement('div'); this.content.className = 'marquee-content';
      this.highlight = document.createElement('div'); this.highlight.className = 'marquee-highlight';
      this.halos = document.createElement('div'); this.halos.className = 'marquee-halos';
      this.blooms = ['purple', 'green'].map(color => {
        const bloom = document.createElement('div'); bloom.className = 'marquee-bloom'; bloom.dataset.color = color; return bloom;
      });
      this.unit = document.createElement('div'); this.unit.className = 'marquee-copy';
      for (const text of this.band.text) {
        const item = document.createElement('span'); item.className = 'marquee-item'; item.textContent = text; this.unit.append(item);
      }
      this.halos.append(...this.blooms);
      this.content.append(this.unit); this.track.append(this.halos, this.content, this.highlight); this.replaceChildren(this.track);
    }
    this.signature = '';
    this.dataset.glow = 'idle';
    this.observer = new ResizeObserver(this.refresh);
    this.observer.observe(this); this.observer.observe(this.unit);
    this.reducedMotion.addEventListener('change', this.refresh);
    document.addEventListener('visibilitychange', this.visibility);
    const style = getComputedStyle(this);
    void document.fonts.load(`400 ${style.fontSize} ${style.fontFamily}`, this.band.text.join(' ')).catch(() => {}).then(() => this.refresh());
    this.refresh();
  }
  disconnectedCallback(): void {
    this.observer?.disconnect(); this.playback?.cancel(); this.playback = null;
    this.pauseGlowTimer(); this.glow.forEach(animation => animation.cancel()); this.glow = [];
    this.reducedMotion.removeEventListener('change', this.refresh);
    document.removeEventListener('visibilitychange', this.visibility);
  }
  private pauseGlowTimer(): void {
    if (this.glowTimer === null) return;
    this.glowRemaining = Math.max(0, this.glowDeadline - performance.now());
    clearTimeout(this.glowTimer); this.glowTimer = null;
  }
  private scheduleGlow(): void {
    if (this.glowTimer !== null || this.glow.length || !this.isConnected || document.hidden || this.reducedMotion.matches) return;
    this.glowDeadline = performance.now() + this.glowRemaining;
    this.glowTimer = setTimeout(() => {
      this.glowTimer = null;
      if (this.isConnected && !document.hidden && !this.reducedMotion.matches) this.startGlow();
    }, this.glowRemaining);
  }
  private startGlow(): void {
    if (this.glow.length || !this.isConnected || document.hidden || this.reducedMotion.matches) return;
    this.pauseGlowTimer();
    this.dataset.glow = 'active';
    // All three animations share a timeline origin. Only cached layer opacity
    // changes; blur and text shadows are never repainted on every frame.
    const options = { duration: GLOW_DURATION, easing: 'linear' };
    const animations = [this.highlight.animate(GLOW_FRAMES.text, options),
      this.blooms[0].animate(GLOW_FRAMES.purple, options), this.blooms[1].animate(GLOW_FRAMES.green, options)];
    const start = document.timeline.currentTime;
    if (start !== null) animations.forEach(animation => { animation.startTime = start; });
    this.glow = animations;
    animations[0].onfinish = () => {
      if (this.glow !== animations) return;
      animations.forEach(animation => animation.cancel()); this.glow = []; this.dataset.glow = 'idle';
      this.glowRemaining = 12000 + Math.random() * 24000;
      this.scheduleGlow();
    };
  }
  private layout(): void {
    if (!this.isConnected) return;
    // Computed width preserves fractional canvas pixels and ignores the outer canvas scale.
    const unitWidth = parseFloat(getComputedStyle(this.unit).width);
    if (!unitWidth || !this.clientWidth) return;
    const scale = parseFloat(getComputedStyle(this).fontSize) / 20.833;
    const signature = `${unitWidth}|${this.clientWidth}|${scale}|${this.reducedMotion.matches}`;
    if (signature === this.signature) return;
    this.signature = signature;
    const progress = this.playback && this.duration ? (Number(this.playback.currentTime ?? 0) / this.duration) % 1 : 0;
    this.playback?.cancel(); this.playback = null;
    const copies = Math.max(2, Math.ceil(this.clientWidth / unitWidth) + 1);
    while (this.content.children.length > copies) this.content.lastElementChild!.remove();
    while (this.content.children.length < copies) this.content.append(this.unit.cloneNode(true));
    for (const layer of [this.highlight, ...this.blooms]) layer.replaceChildren(...Array.from(this.content.children, child => child.cloneNode(true)));
    this.duration = unitWidth / (this.band.speed * scale) * 1000;
    this.dataset.period = String(this.duration);
    this.dataset.unitWidth = String(unitWidth);
    if (this.reducedMotion.matches) return;
    this.playback = this.track.animate([
      { transform: 'translate3d(0, 0, 0)' }, { transform: `translate3d(${-unitWidth}px, 0, 0)` },
    ], { duration: this.duration, iterations: Infinity, easing: 'linear', direction: this.band.direction === 'right' ? 'reverse' : 'normal' });
    this.playback.currentTime = progress * this.duration;
    this.visibility();
  }
}
customElements.define('stream-marquee', StreamMarquee);
