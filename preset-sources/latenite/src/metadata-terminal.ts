import type { HostState } from './host-client.ts';

const ROWS = 14, CHARACTER_DELAY = 40, LINE_HOLD = 1100;
interface Row { element: HTMLDivElement; entry: HTMLSpanElement; text: Text; full: string }

/** Values are captured when a line starts, like entries in a live terminal log. */
export function metadataLines(state: HostState, now = new Date()): string[] {
  const date = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
  return [
    `[resolution] ${state.config.canvas.width}*${state.config.canvas.height}`,
    `[frame-rate] ${Math.round(state.audio.frameRate || 60)}fps`,
    '[target-bitrate] 5000kbps', '[liveroom-id] 526038',
    '[sponsor] HOPE FINDERS', '[sponsor] BASS KARYOTES',
    `[date] ${date}`, `[time] ${now.toLocaleTimeString('en-GB', { hour12: false })}`,
    '[capture] WASAPI LOOPBACK',
    state.audio.state === 'live' ? `[audio] ${state.audio.sampleRate / 1000}kHz / ${state.audio.channels}CH` : `[audio] ${state.audio.state.toUpperCase()}`,
    '[fft] 8192 SAMPLES', '[output] OBS OVERLAY',
    `[laplace] ${state.laplace.state.toUpperCase()}`,
    '[host] LOCAL CONNECTION', '[mode] IMMERSIVE OVERLAY', '[spectrum] 30Hz - 20kHz',
  ];
}

export class MetadataTerminal extends HTMLElement {
  private state: HostState | null = null;
  private lines = document.createElement('div');
  private rows: Row[] = [];
  private nextIndex = 0;
  private typed = 0;
  private initialized = false;
  private fontsReady = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private callback: (() => void) | null = null;
  private remaining = 0;
  private deadline = 0;
  private observer: ResizeObserver | null = null;
  private context = document.createElement('canvas').getContext('2d')!;
  private fontSize = 25;
  private reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  private sync = () => {
    if (!this.initialized) return;
    if (this.reducedMotion.matches) {
      this.pauseTimer();
      if (this.dataset.phase === 'typing') this.finishLine();
    } else if (!this.active) {
      this.pauseTimer();
    } else {
      this.armTimer();
    }
  };

  connectedCallback(): void {
    this.style.setProperty('--metadata-rows', String(ROWS));
    this.lines.className = 'metadata-lines'; this.replaceChildren(this.lines);
    document.addEventListener('visibilitychange', this.sync);
    this.reducedMotion.addEventListener('change', this.sync);
    this.observer = new ResizeObserver(() => this.fit()); this.observer.observe(this);
    if (this.fontsReady) this.initialize();
    else {
      const style = getComputedStyle(this);
      void document.fonts.load(`${style.fontSize} ${style.fontFamily}`, '[resolution] 3840*2160').then(fonts => {
        this.dataset.fonts = fonts.length ? 'ready' : 'fallback';
      }).catch(() => { this.dataset.fonts = 'fallback'; }).then(() => {
        this.fontsReady = true; this.initialize();
      });
    }
  }
  disconnectedCallback(): void {
    this.pauseTimer(); this.callback = null;
    this.observer?.disconnect(); this.initialized = false; this.rows = [];
    document.removeEventListener('visibilitychange', this.sync);
    this.reducedMotion.removeEventListener('change', this.sync);
  }
  update(state: HostState): void { this.state = state; this.initialize(); }
  private get active(): boolean { return this.isConnected && !document.hidden && !this.reducedMotion.matches; }

  private initialize(): void {
    if (this.initialized || !this.fontsReady || !this.state || !this.isConnected) return;
    this.initialized = true; this.lines.replaceChildren(); this.rows = [];
    this.readFont();
    const entries = metadataLines(this.state);
    for (let index = 0; index < ROWS - 1; index++) this.makeRow(entries[index], true);
    this.nextIndex = ROWS - 1; this.beginLine();
  }
  private readFont(): void {
    const style = getComputedStyle(this);
    this.context.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
    this.fontSize = parseFloat(style.fontSize);
  }
  private fit(): void {
    if (!this.initialized) return;
    this.readFont(); this.rows.forEach(row => this.sizeRow(row));
  }
  private sizeRow(row: Row): void {
    // Reserve the completed line's width so right alignment does not pull earlier letters sideways while typing.
    row.entry.style.width = `${Math.ceil(this.context.measureText(row.full).width + this.fontSize * .6)}px`;
  }
  private makeRow(full: string, complete = false): Row {
    const element = document.createElement('div'); element.className = 'metadata-row';
    const entry = document.createElement('span'); entry.className = 'metadata-text';
    const text = document.createTextNode(complete ? full : '');
    const cursor = document.createElement('span'); cursor.className = 'metadata-cursor'; cursor.setAttribute('aria-hidden', 'true');
    entry.append(text, cursor); element.append(entry); this.lines.append(element);
    const row = { element, entry, text, full }; this.rows.push(row); this.sizeRow(row); return row;
  }
  private beginLine(row?: Row): void {
    const entries = metadataLines(this.state!);
    const full = entries[this.nextIndex % entries.length]; this.nextIndex = (this.nextIndex + 1) % entries.length;
    if (!row) row = this.makeRow(full);
    else { row.full = full; row.text.data = ''; this.sizeRow(row); }
    this.typed = 0; this.dataset.phase = 'typing';
    if (this.reducedMotion.matches) this.finishLine();
    else this.queue(() => this.typeNext(), CHARACTER_DELAY);
  }
  private typeNext(): void {
    const row = this.rows.at(-1)!;
    this.typed++; row.text.data = row.full.slice(0, this.typed);
    if (this.typed >= row.full.length) this.finishLine();
    else this.queue(() => this.typeNext(), CHARACTER_DELAY);
  }
  private finishLine(): void {
    const row = this.rows.at(-1)!; row.text.data = row.full; this.typed = row.full.length;
    this.dataset.phase = 'hold'; this.queue(() => this.advance(), LINE_HOLD);
  }
  private advance(): void {
    // Reflow the next line atomically, like a terminal newline, without interpolated scrolling.
    this.rows.shift()!.element.remove(); this.beginLine();
  }
  private queue(callback: () => void, delay: number): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null; this.callback = callback; this.remaining = delay; this.armTimer();
  }
  private armTimer(): void {
    if (!this.active || !this.callback || this.timer !== null) return;
    this.deadline = performance.now() + this.remaining;
    this.timer = setTimeout(() => {
      this.timer = null; this.remaining = 0;
      if (!this.active) return;
      const callback = this.callback; this.callback = null; callback?.();
    }, this.remaining);
  }
  private pauseTimer(): void {
    if (this.timer === null) return;
    this.remaining = Math.max(0, this.deadline - performance.now());
    clearTimeout(this.timer); this.timer = null;
  }
}

customElements.define('stream-metadata', MetadataTerminal);
