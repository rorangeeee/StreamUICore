import { host } from './host-client.ts';
import { ChatEventFormatter, formatChatTimestamp } from './chat-events.ts';
import type { ChatEntry } from './chat-events.ts';
import { ChatPlayback } from './chat-playback.ts';

/** A single message surface; gifts cover it from left to right before text appears. */
export class ChatTerminal extends HTMLElement {
  private formatter = new ChatEventFormatter();
  private playback = new ChatPlayback();
  private fill!: HTMLDivElement;
  private output!: HTMLDivElement;
  private cursor!: HTMLSpanElement;
  private article: HTMLElement | null = null;
  private bodyScroller: HTMLElement | null = null;
  private lines: Text[] = [];
  private current: ChatEntry | null = null;
  private seen = new Set<string>();
  private subscribed = false;
  private animation = 0;
  private previousTime = 0;
  private fillSignature = '';
  private reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  private onChat = (event: Event) => this.receive((event as CustomEvent).detail);
  private onState = () => {
    const connected = host.connected && host.state?.laplace.state === 'connected';
    this.dataset.connection = connected ? 'connected' : 'disconnected';
    this.setAttribute('aria-label', connected ? '单条弹幕，已连接' : '单条弹幕，等待连接');
  };
  private hide = () => { this.disconnectBridge(); this.pause(); };
  private show = () => { this.connectBridge(); this.sync(); };
  private sync = () => {
    this.pause();
    this.playback.reducedMotion = this.reducedMotion.matches;
    this.playback.advance(0); this.render();
    if (this.isConnected && !document.hidden && !this.playback.settled) this.animation = requestAnimationFrame(this.tick);
  };
  private tick = (time: number) => {
    this.animation = 0;
    if (this.previousTime) this.playback.advance(Math.min(250, Math.max(0, time - this.previousTime)));
    this.previousTime = time; this.render();
    if (!this.playback.settled) this.animation = requestAnimationFrame(this.tick);
    else this.previousTime = 0;
  };

  connectedCallback(): void {
    if (!this.output) {
      this.fill = document.createElement('div'); this.fill.className = 'terminal-fill'; this.fill.setAttribute('aria-hidden', 'true');
      this.output = document.createElement('div'); this.output.className = 'terminal-output';
      this.output.setAttribute('role', 'log'); this.output.setAttribute('aria-live', 'polite');
      this.output.setAttribute('aria-atomic', 'true');
      this.cursor = document.createElement('span'); this.cursor.className = 'terminal-cursor'; this.cursor.setAttribute('aria-hidden', 'true');
      this.output.append(this.cursor); this.replaceChildren(this.fill, this.output);
    }
    window.addEventListener('pagehide', this.hide); window.addEventListener('pageshow', this.show);
    document.addEventListener('visibilitychange', this.sync); this.reducedMotion.addEventListener('change', this.sync);
    this.connectBridge(); this.sync();
  }

  disconnectedCallback(): void {
    window.removeEventListener('pagehide', this.hide); window.removeEventListener('pageshow', this.show);
    document.removeEventListener('visibilitychange', this.sync); this.reducedMotion.removeEventListener('change', this.sync);
    this.disconnectBridge(); this.pause(); this.playback.clear();
  }

  private pause(): void {
    cancelAnimationFrame(this.animation); this.animation = 0; this.previousTime = 0;
  }
  private connectBridge(): void {
    if (this.subscribed) return;
    this.subscribed = true; host.addEventListener('chat', this.onChat);
    host.addEventListener('state', this.onState); host.addEventListener('connectionchange', this.onState);
    host.start(); this.onState();
  }
  private disconnectBridge(): void {
    host.removeEventListener('chat', this.onChat); host.removeEventListener('state', this.onState);
    host.removeEventListener('connectionchange', this.onState); this.subscribed = false;
  }
  private receive(event: unknown): void {
    const entry = this.formatter.format(event);
    if (!entry || (entry.key && this.seen.has(entry.key))) return;
    if (entry.key) {
      this.seen.add(entry.key);
      if (this.seen.size > 2000) this.seen.delete(this.seen.values().next().value!);
    }
    this.playback.enqueue(entry); this.playback.advance(0); this.render();
    if (!this.animation && !document.hidden) this.sync();
  }

  private render(): void {
    if (!this.output) return;
    const frame = this.playback.read();
    if (this.dataset.phase !== frame.phase) {
      this.dataset.phase = frame.phase;
      this.output.setAttribute('aria-busy', String(frame.phase === 'typing' || frame.phase === 'cover'));
    }
    const fill = frame.fill.toFixed(4);
    if (this.fillSignature !== fill) { this.fill.style.transform = `scaleX(${fill})`; this.fillSignature = fill; }
    if (this.current !== frame.entry) {
      this.current = frame.entry; this.lines = [];
      if (!frame.entry) { this.article = null; this.bodyScroller = null; this.output.replaceChildren(this.cursor); return; }
      const entry = frame.entry;
      this.article = document.createElement('article'); this.article.className = 'terminal-entry';
      this.article.dataset.kind = entry.kind;
      if (entry.key) this.article.dataset.eventId = entry.key;
      if (entry.kind === 'message') {
        const metadata = document.createElement('header'); metadata.className = 'terminal-meta';
        const time = document.createElement('time'); time.className = 'terminal-time';
        time.dateTime = new Date(entry.timestamp).toISOString(); time.textContent = formatChatTimestamp(entry.timestamp);
        const username = document.createElement('div'); username.className = 'terminal-user';
        username.textContent = entry.username; username.title = entry.username;
        metadata.append(time, username); this.article.append(metadata);
      }
      this.lines = frame.lines.map((_, index) => {
        const element = document.createElement('div');
        element.className = `terminal-line ${entry.kind !== 'message' && index === 0 ? 'terminal-user' : 'terminal-body'}`;
        const text = document.createTextNode(''); element.append(text); this.article!.append(element); return text;
      });
      this.article.lastElementChild!.append(this.cursor);
      this.bodyScroller = this.article.querySelector('.terminal-body');
      this.output.replaceChildren(this.article); this.output.scrollTop = 0;
    }
    if (this.article) this.article.dataset.typing = String(frame.phase === 'typing');
    let changed = false;
    this.lines.forEach((text, index) => {
      if (text.data !== frame.lines[index]) { text.data = frame.lines[index]; changed = true; }
    });
    // Only the body scrolls, so the sender and sending date remain readable.
    if (changed && this.bodyScroller) this.bodyScroller.scrollTop = this.bodyScroller.scrollHeight;
  }
}

customElements.define('chat-terminal', ChatTerminal);
