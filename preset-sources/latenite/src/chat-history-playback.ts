import { formatChatTimestamp } from './chat-events.ts';
import type { ChatEntry } from './chat-events.ts';

export const CHAT_HISTORY_LIMIT = 200;
const LINE_INTERVAL = 160, CHARACTER_INTERVAL = 10, MAX_TYPING_DURATION = 1200;
const segmenter = new Intl.Segmenter('zh-CN', { granularity: 'grapheme' });
export interface HistoryFrame {
  id: number;
  entry: ChatEntry;
  lines: string[];
  complete: boolean;
  typing: boolean;
}

export function historyDisplayLines(entry: ChatEntry): string[] {
  return [`[${formatChatTimestamp(entry.timestamp)}]`, `${entry.username} · ${entry.level}`, entry.body];
}

/** A chronological terminal log; gifts keep their own row instead of replacing chat. */
export class ChatHistoryPlayback {
  reducedMotion = false;
  private history: HistoryFrame[] = [];
  private queue: ChatEntry[] = [];
  private current: { id: number; entry: ChatEntry; glyphs: string[]; lineInterval: number; characterInterval: number } | null = null;
  private elapsed = 0;
  private sequence = 0;

  get settled(): boolean { return this.current === null; }

  enqueue(entry: ChatEntry): void {
    this.queue.push(entry);
    if (this.queue.length > CHAT_HISTORY_LIMIT) this.queue.shift();
    if (!this.current) this.next();
    this.advance(0);
  }

  /** Keep an up-to-date history while the other layout is visible, without animating it. */
  finish(): void {
    while (this.current) { this.complete(); this.next(); }
  }

  clear(): void { this.history = []; this.queue = []; this.current = null; this.elapsed = 0; }

  private next(): void {
    const entry = this.queue.shift();
    this.elapsed = 0;
    if (!entry) { this.current = null; return; }
    const glyphs = Array.from(segmenter.segment(entry.body), part => part.segment);
    const speed = 1 + Math.floor(this.queue.length / 6);
    this.current = { id: ++this.sequence, entry, glyphs,
      lineInterval: Math.max(32, LINE_INTERVAL / speed),
      characterInterval: Math.min(CHARACTER_INTERVAL, MAX_TYPING_DURATION / Math.max(1, glyphs.length)) / speed };
    this.trim();
  }

  private trim(): void {
    while (this.history.length + Number(this.current !== null) > CHAT_HISTORY_LIMIT) this.history.shift();
  }

  private complete(): void {
    const { id, entry } = this.current!;
    this.history.push({ id, entry, lines: historyDisplayLines(entry), complete: true, typing: false });
    this.current = null; this.trim();
  }

  advance(milliseconds: number): void {
    let remaining = Math.max(0, milliseconds);
    while (this.current) {
      const duration = this.reducedMotion ? 0 : this.current.lineInterval * 3 + this.current.glyphs.length * this.current.characterInterval;
      const untilNext = Math.max(0, duration - this.elapsed);
      if (remaining < untilNext) { this.elapsed += remaining; return; }
      remaining -= untilNext; this.complete(); this.next();
    }
  }

  read(): HistoryFrame[] {
    if (!this.current) return this.history;
    const { id, entry, glyphs, lineInterval, characterInterval } = this.current;
    const lines = historyDisplayLines(entry).slice(0, this.elapsed < lineInterval ? 1 : this.elapsed < lineInterval * 2 ? 2 : 3);
    const count = Math.max(0, Math.min(glyphs.length, Math.floor((this.elapsed - lineInterval * 2) / characterInterval)));
    if (lines.length === 3) lines[2] = glyphs.slice(0, count).join('');
    return [...this.history, { id, entry, lines, complete: false, typing: lines.length < 3 || count < glyphs.length }];
  }
}
