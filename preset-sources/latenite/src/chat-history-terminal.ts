import './chat-history.css';
import { host } from './host-client.ts';
import { ChatEventFormatter } from './chat-events.ts';
import { ChatHistoryPlayback } from './chat-history-playback.ts';
import type { HistoryFrame } from './chat-history-playback.ts';

interface HistoryRow { article: HTMLElement; lines: Text[]; frame: HistoryFrame | null }

/** The 16:9 terminal shares the frame's projection; the 21:9 component stays independent. */
export class ChatHistoryTerminal extends HTMLElement {
  private formatter = new ChatEventFormatter();
  private playback = new ChatHistoryPlayback();
  private viewport!: HTMLDivElement;
  private output!: HTMLDivElement;
  private cursor!: HTMLSpanElement;
  private rows = new Map<number, HistoryRow>();
  private seen = new Set<string>();
  private active = false;
  private subscribed = false;
  private animation = 0;
  private previousTime = 0;
  private followTail = true;
  private scrollPosition: { top: number; height: number; viewport: number } | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  private onScroll = () => {
    if (!this.active || !this.viewport.clientHeight) return;
    const { scrollTop: top, scrollHeight: height, clientHeight: viewport } = this.viewport;
    const previous = this.scrollPosition;
    // A reflow can move the bottom without the viewer scrolling away from it.
    if (previous && height === previous.height && viewport === previous.viewport && Math.abs(top - previous.top) > 1) {
      this.followTail = height - viewport - top < 32;
    }
    this.scrollPosition = { top, height, viewport };
  };
  private followLatest = () => {
    if (!this.active || !this.isConnected || document.hidden || !this.viewport.clientHeight) return;
    if (this.followTail) this.viewport.scrollTop = this.viewport.scrollHeight;
    this.scrollPosition = { top: this.viewport.scrollTop, height: this.viewport.scrollHeight, viewport: this.viewport.clientHeight };
  };
  private onChat = (event: Event) => this.receive((event as CustomEvent).detail);
  private onState = () => {
    const connected = host.connected && host.state?.laplace.state === 'connected';
    this.dataset.connection = connected ? 'connected' : 'disconnected';
    this.setAttribute('aria-label', connected ? '滚动弹幕终端，已连接' : '滚动弹幕终端，等待连接');
  };
  private hide = () => { this.disconnectBridge(); this.pause(); };
  private show = () => { this.connectBridge(); this.sync(); };
  private sync = () => {
    this.pause(); this.playback.reducedMotion = this.reducedMotion.matches;
    if (!this.active) this.playback.finish();
    this.playback.advance(0);
    if (!this.active || !this.isConnected || document.hidden) return;
    this.render();
    if (!this.playback.settled) this.animation = requestAnimationFrame(this.tick);
  };
  private tick = (time: number) => {
    this.animation = 0;
    if (this.previousTime) this.playback.advance(Math.min(250, Math.max(0, time - this.previousTime)));
    this.previousTime = time; this.render();
    if (!this.playback.settled) this.animation = requestAnimationFrame(this.tick);
    else this.previousTime = 0;
  };

  connectedCallback(): void {
    if (!this.viewport) {
      this.viewport = document.createElement('div'); this.viewport.className = 'history-viewport';
      this.output = document.createElement('div'); this.output.className = 'history-output';
      this.output.setAttribute('role', 'log'); this.output.setAttribute('aria-live', 'polite');
      this.output.setAttribute('aria-label', '直播弹幕历史');
      this.cursor = document.createElement('span'); this.cursor.className = 'history-cursor'; this.cursor.setAttribute('aria-hidden', 'true');
      this.output.append(this.cursor); this.viewport.append(this.output); this.replaceChildren(this.viewport);
    }
    this.setAttribute('aria-hidden', String(!this.active));
    window.addEventListener('pagehide', this.hide); window.addEventListener('pageshow', this.show);
    document.addEventListener('visibilitychange', this.sync); this.reducedMotion.addEventListener('change', this.sync);
    this.viewport.addEventListener('scroll', this.onScroll, { passive: true });
    this.resizeObserver = new ResizeObserver(this.followLatest);
    this.resizeObserver.observe(this.viewport); this.resizeObserver.observe(this.output);
    this.connectBridge(); this.sync();
  }

  disconnectedCallback(): void {
    window.removeEventListener('pagehide', this.hide); window.removeEventListener('pageshow', this.show);
    document.removeEventListener('visibilitychange', this.sync); this.reducedMotion.removeEventListener('change', this.sync);
    this.viewport.removeEventListener('scroll', this.onScroll);
    this.resizeObserver?.disconnect(); this.resizeObserver = null;
    this.disconnectBridge(); this.pause();
  }

  setActive(active: boolean): void {
    if (this.active === active) return;
    // A hidden log may have accumulated messages, and the new panel size is applied after this call.
    if (active) { this.followTail = true; this.scrollPosition = null; }
    this.active = active; this.setAttribute('aria-hidden', String(!active)); this.sync();
  }

  private pause(): void { cancelAnimationFrame(this.animation); this.animation = 0; this.previousTime = 0; }

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
    this.playback.enqueue(entry);
    if (!this.active) { this.playback.finish(); return; }
    if (!document.hidden) this.render();
    if (!this.animation && !document.hidden) this.sync();
  }

  private render(): void {
    if (!this.output) return;
    this.onScroll();
    const frames = this.playback.read(), ids = new Set(frames.map(frame => frame.id));
    const previousHeight = this.viewport.scrollHeight, previousTop = this.viewport.scrollTop;
    let removed = false;
    for (const [id, row] of this.rows) {
      if (!ids.has(id)) { row.article.remove(); this.rows.delete(id); removed = true; }
    }
    if (removed && !this.followTail) this.viewport.scrollTop = Math.max(0, previousTop - (previousHeight - this.viewport.scrollHeight));
    for (const frame of frames) {
      let row = this.rows.get(frame.id);
      if (!row) {
        const article = document.createElement('article'); article.className = 'history-entry';
        article.dataset.kind = frame.entry.kind; article.setAttribute('aria-atomic', 'true');
        if (frame.entry.key) article.dataset.eventId = frame.entry.key;
        this.output.append(article); row = { article, lines: [], frame: null }; this.rows.set(frame.id, row);
      }
      if (row.frame === frame) continue;
      row.article.dataset.typing = String(frame.typing); row.article.setAttribute('aria-busy', String(!frame.complete));
      frame.lines.forEach((text, index) => {
        if (!row!.lines[index]) {
          const line = document.createElement(index === 0 ? 'time' : 'div');
          line.className = `history-line history-${['time', 'user', 'body'][index]}`;
          if (line instanceof HTMLTimeElement) line.dateTime = new Date(frame.entry.timestamp).toISOString();
          const content = document.createTextNode(''); row!.lines.push(content); line.append(content); row!.article.append(line);
        }
        if (row!.lines[index].data !== text) row!.lines[index].data = text;
      });
      row.frame = frame;
    }
    const last = frames.at(-1), article = last && this.rows.get(last.id)?.article;
    (article?.lastElementChild ?? this.output).append(this.cursor);
    this.followLatest();
  }
}

customElements.define('chat-history-terminal', ChatHistoryTerminal);
