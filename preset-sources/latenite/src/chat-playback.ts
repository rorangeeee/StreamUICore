import type { ChatEntry } from './chat-events.ts';
import { easeInOut } from './wordmark-motion.ts';

export const CHAT_COVER_DURATION = 450;
export const CHAT_UNCOVER_DURATION = 350;
export const CHAT_MESSAGE_HOLD = 2200;
export const CHAT_GIFT_HOLD = 3200;
const CHARACTER_INTERVAL = 10, MAX_TYPING_DURATION = 1200, LINE_INTERVAL = 160;
const segmenter = new Intl.Segmenter('zh-CN', { granularity: 'grapheme' });
export type ChatPhase = 'idle' | 'cover' | 'typing' | 'hold' | 'uncover';
export interface ChatFrame { entry: ChatEntry | null; phase: ChatPhase; lines: string[]; fill: number }

export function chatDisplayLines(entry: ChatEntry): string[] {
  return entry.kind === 'message' ? [entry.body]
    : [entry.username, entry.kind === 'gift' ? entry.body.replace(/^送出\s*\[/u, '送出[') : entry.body];
}

/** One visible entry, with a priority gift queue and a resumable interrupted message. */
export class ChatPlayback {
  reducedMotion = false;
  private messages: ChatEntry[] = [];
  private specials: ChatEntry[] = [];
  private suspended: ChatEntry | null = null;
  private current: ChatEntry | null = null;
  private phase: ChatPhase = 'idle';
  private elapsed = 0;
  private glyphs: string[][] = [];
  private characterInterval = CHARACTER_INTERVAL;

  get settled(): boolean {
    return this.phase === 'idle' || (this.phase === 'hold' && this.current?.kind === 'message'
      && !this.messages.length && !this.specials.length && this.elapsed >= this.duration());
  }

  enqueue(entry: ChatEntry): void {
    if (entry.kind === 'message') {
      this.messages.push(entry);
      if (this.messages.length > 200) this.messages.shift();
    } else {
      this.specials.push(entry);
      if (this.current?.kind === 'message') {
        this.suspended = this.current;
        this.activate(this.specials.shift()!);
        return;
      }
    }
    if (!this.current) this.next();
    this.advance(0);
  }

  clear(): void {
    this.messages = []; this.specials = []; this.suspended = null;
    this.current = null; this.glyphs = []; this.phase = 'idle'; this.elapsed = 0;
  }

  private activate(entry: ChatEntry): void {
    this.current = entry;
    this.glyphs = chatDisplayLines(entry).map(line => Array.from(segmenter.segment(line), part => part.segment));
    const length = this.glyphs.reduce((sum, line) => sum + line.length, 0);
    this.characterInterval = Math.min(CHARACTER_INTERVAL, MAX_TYPING_DURATION / Math.max(1, length));
    this.phase = entry.kind === 'message' ? 'typing' : 'cover'; this.elapsed = 0;
  }

  private next(): void {
    const special = this.specials.shift();
    if (special) { this.activate(special); return; }
    if (this.suspended) {
      const entry = this.suspended; this.suspended = null; this.activate(entry); return;
    }
    const message = this.messages.shift();
    if (message) this.activate(message);
    else { this.current = null; this.phase = 'idle'; this.elapsed = 0; }
  }

  private duration(): number {
    if (this.phase === 'cover') return this.reducedMotion ? 0 : CHAT_COVER_DURATION;
    if (this.phase === 'uncover') return this.reducedMotion ? 0 : CHAT_UNCOVER_DURATION;
    if (this.phase === 'typing') return this.reducedMotion ? 0
      : this.glyphs.reduce((sum, line) => sum + line.length, 0) * this.characterInterval + Math.max(0, this.glyphs.length - 1) * LINE_INTERVAL;
    if (this.phase === 'hold') return this.current?.kind === 'message'
      ? Math.max(700, CHAT_MESSAGE_HOLD / (1 + Math.floor(this.messages.length / 6)))
      : this.current?.kind === 'superchat' ? 4500 : CHAT_GIFT_HOLD;
    return Infinity;
  }

  advance(milliseconds: number): void {
    let remaining = Math.max(0, milliseconds);
    for (let step = 0; step < 1000 && this.current; step++) {
      const duration = this.duration();
      const untilNext = Math.max(0, duration - this.elapsed);
      if (remaining < untilNext) { this.elapsed += remaining; return; }
      remaining -= untilNext; this.elapsed = 0;
      if (this.phase === 'cover') this.phase = 'typing';
      else if (this.phase === 'typing') this.phase = 'hold';
      else if (this.phase === 'hold') {
        if (this.current.kind !== 'message') this.phase = 'uncover';
        else if (this.messages.length || this.specials.length) this.next();
        else { this.elapsed = duration; return; } // Keep the final message until something arrives.
      } else if (this.phase === 'uncover') this.next();
    }
  }

  read(): ChatFrame {
    if (!this.current) return { entry: null, phase: 'idle', lines: [], fill: 0 };
    let fill = 0;
    if (this.current.kind !== 'message') {
      fill = this.phase === 'cover' ? easeInOut(this.elapsed / CHAT_COVER_DURATION)
        : this.phase === 'uncover' ? 1 - easeInOut(this.elapsed / CHAT_UNCOVER_DURATION) : 1;
    }
    let elapsed = this.elapsed;
    const lines = this.glyphs.map(glyphs => {
      const count = this.phase === 'hold' ? glyphs.length : this.phase === 'typing'
        ? Math.max(0, Math.min(glyphs.length, Math.floor(elapsed / this.characterInterval))) : 0;
      elapsed -= glyphs.length * this.characterInterval + LINE_INTERVAL;
      return glyphs.slice(0, count).join('');
    });
    return { entry: this.current, phase: this.phase, lines, fill };
  }
}
