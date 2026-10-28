import type { AudioFrame } from './audio.ts';

/** Presentation-only component. Both views receive the same live audio frame. */
export class AudioScope extends HTMLElement {
  static observedAttributes = ['inverted'];
  private canvas!: HTMLCanvasElement;
  private ctx!: CanvasRenderingContext2D;
  private history = document.createElement('canvas');
  private historyContext = this.history.getContext('2d')!;
  private observer: ResizeObserver | null = null;
  private width = 0;
  private height = 0;
  private ratio = 1;
  private column: ImageData | null = null;
  private pendingPixels = 0;
  private lastFrame: AudioFrame | null = null;
  private foreground = '#40009e';

  connectedCallback(): void {
    this.canvas = document.createElement('canvas');
    this.canvas.setAttribute('aria-hidden', 'true');
    this.replaceChildren(this.canvas);
    this.ctx = this.canvas.getContext('2d')!;
    this.readPalette();
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(this);
  }

  disconnectedCallback(): void {
    this.observer?.disconnect();
  }

  attributeChangedCallback(): void {
    if (this.ctx) { this.readPalette(); this.render(this.lastFrame, 0); }
  }

  render(frame: AudioFrame | null, elapsed = 1 / 60): void {
    this.lastFrame = frame;
    if (!this.width || !this.height) return;
    if (this.ratio !== Math.min(window.devicePixelRatio || 1, 2)) this.resize();
    this.ctx.clearRect(0, 0, this.width, this.height);
    if (this.getAttribute('mode') === 'spectrogram') {
      if (frame) this.advanceSpectrogram(frame, Math.min(elapsed, .1));
      // History stores only intensity as alpha so theme changes preserve every sample.
      this.ctx.fillStyle = this.foreground;
      this.ctx.fillRect(0, 0, this.width, this.height);
      this.ctx.globalCompositeOperation = 'destination-in';
      this.ctx.drawImage(this.history, 0, 0, this.width, this.height);
      this.ctx.globalCompositeOperation = 'source-over';
    } else this.drawWaveform(frame);
  }

  private readPalette(): void {
    this.foreground = getComputedStyle(this).getPropertyValue('--scope-foreground').trim() || '#40009e';
  }

  /** A new capture starts a new time history. Stopping retains the last spectrogram. */
  clear(): void {
    this.historyContext.clearRect(0, 0, this.history.width, this.history.height);
    this.pendingPixels = 0;
    this.render(null, 0);
  }

  private resize(): void {
    // Canvas resolution follows its local size, independent of the panel's rotation.
    const width = this.clientWidth;
    const height = this.clientHeight;
    if (!width || !height) return;
    if (this.history.width && this.history.height && width && height) {
      const previous = document.createElement('canvas');
      previous.width = this.history.width;
      previous.height = this.history.height;
      previous.getContext('2d')!.drawImage(this.history, 0, 0);
      this.history.width = width;
      this.history.height = height;
      this.historyContext.drawImage(previous, 0, 0, width, height);
    } else {
      this.history.width = width;
      this.history.height = height;
    }
    this.width = width;
    this.height = height;
    this.column = width && height ? this.historyContext.createImageData(1, height) : null;
    this.ratio = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(width * this.ratio);
    this.canvas.height = Math.round(height * this.ratio);
    this.ctx.setTransform(this.ratio, 0, 0, this.ratio, 0, 0);
    this.render(this.lastFrame, 0);
  }

  private advanceSpectrogram(frame: AudioFrame, elapsed: number): void {
    if (!this.column) return;
    // Time advances from left to right: new samples enter at the right, 48 CSS px/s.
    this.pendingPixels += elapsed * 48;
    const pixels = Math.min(this.width, Math.floor(this.pendingPixels));
    if (!pixels) return;
    this.pendingPixels -= pixels;
    const { width, height, historyContext: ctx } = this;
    const binHz = frame.sampleRate / (frame.frequency.length * 2);
    const topFrequency = Math.min(20000, frame.sampleRate / 2);

    for (let y = 0; y < height; y++) {
      // Log-frequency vertical axis: bass at the bottom, treble at the top.
      const high = 30 * (topFrequency / 30) ** (1 - y / height);
      const low = 30 * (topFrequency / 30) ** (1 - (y + 1) / height);
      const first = Math.max(1, Math.floor(low / binHz));
      const last = Math.min(frame.frequency.length - 1, Math.max(first, Math.ceil(high / binHz)));
      let db = -Infinity;
      for (let bin = first; bin <= last; bin++) db = Math.max(db, frame.frequency[bin]);
      const intensity = Math.round(Math.max(0, Math.min(1, (db + 90) / 72)) * 255);
      const offset = y * 4;
      this.column.data[offset + 3] = intensity;
    }

    ctx.globalCompositeOperation = 'copy';
    ctx.drawImage(this.history, pixels, 0, width - pixels, height, 0, 0, width - pixels, height);
    ctx.globalCompositeOperation = 'source-over';
    for (let x = width - pixels; x < width; x++) ctx.putImageData(this.column, x, 0);
  }

  private drawWaveform(frame: AudioFrame | null): void {
    const { ctx, width, height } = this;
    const center = height / 2;
    ctx.beginPath();
    if (frame) {
      const samples = Math.min(Math.floor(frame.sampleRate * .045), frame.waveform.length / 2);
      const searchEnd = Math.min(Math.floor(frame.sampleRate * .02), frame.waveform.length - samples - 1);
      let start = 0;
      for (let sample = 1; sample < searchEnd; sample++) {
        if (frame.waveform[sample - 1] <= 0 && frame.waveform[sample] > 0) { start = sample; break; }
      }
      // Preserve fast transients even when several samples share a screen pixel.
      for (let x = 0; x < width; x++) {
        const first = start + Math.floor(x * samples / width);
        const last = Math.min(start + samples, Math.max(first + 1, start + Math.floor((x + 1) * samples / width)));
        let min = 1;
        let max = -1;
        for (let sample = first; sample < last; sample++) {
          min = Math.min(min, frame.waveform[sample]);
          max = Math.max(max, frame.waveform[sample]);
        }
        const top = center - Math.min(1, max) * (height * .45);
        const bottom = center - Math.max(-1, min) * (height * .45);
        if (x === 0) ctx.moveTo(x, top);
        else ctx.lineTo(x, top);
        ctx.lineTo(x, bottom);
      }
    } else {
      ctx.moveTo(0, center);
      ctx.lineTo(width, center);
    }
    ctx.lineWidth = 1.2;
    ctx.lineJoin = 'round';
    ctx.strokeStyle = this.foreground;
    ctx.stroke();
  }
}

customElements.define('audio-scope', AudioScope);
