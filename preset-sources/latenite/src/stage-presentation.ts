import type { StageMode } from './stage-layout.ts';
import { KineticWordmark } from './kinetic-wordmark.ts';
import type { ChatHistoryTerminal } from './chat-history-terminal.ts';

/** Layout changes reuse the live elements, including the independently maintained NOW PLAYING. */
export class StagePresentation {
  private mode: StageMode | null = null;
  private title: HTMLElement;
  private brand: HTMLElement;
  private decorations: HTMLDivElement;
  private nowPlaying: HTMLElement | null;
  private nowPlayingParent: HTMLElement | null;
  private chatLift: HTMLDivElement;
  private chatHistory: ChatHistoryTerminal;

  constructor(private workspace: HTMLElement) {
    this.title = workspace.querySelector('#wordmark-blur-window')!;
    this.brand = workspace.querySelector('#wordmark-window')!;
    this.decorations = document.createElement('div');
    this.decorations.className = 'themebar-decorations';
    for (const child of [...this.title.children]) if (!child.matches('kinetic-wordmark')) this.decorations.append(child);
    this.title.prepend(this.decorations);
    this.nowPlaying = workspace.querySelector('now-playing');
    this.nowPlayingParent = this.nowPlaying?.parentElement ?? null;
    const chat = workspace.querySelector('#chat-window')!;
    this.chatHistory = chat.querySelector('chat-history-terminal')!;
    const projection = document.createElement('div'); projection.className = 'chat-projection';
    this.chatLift = document.createElement('div'); this.chatLift.className = 'chat-lift';
    this.chatLift.append(...chat.childNodes); projection.append(this.chatLift); chat.append(projection);
    document.addEventListener('visibilitychange', () => {
      this.chatLift.style.animationPlayState = document.hidden ? 'paused' : 'running';
    });
    this.apply('21:9');
  }

  apply(mode: StageMode): void {
    if (this.mode === mode) return;
    this.mode = mode;
    this.workspace.dataset.layoutMode = mode;
    this.title.querySelector('kinetic-wordmark')!.setAttribute('effect', mode === '16:9' ? 'blur' : 'stretch');
    this.brand.querySelector('kinetic-wordmark')!.setAttribute('effect', mode === '16:9' ? 'stretch' : 'blur');
    this.chatHistory.setActive(mode === '16:9');
    (mode === '16:9' ? this.brand : this.title).prepend(this.decorations);
    if (this.nowPlaying) {
      (mode === '16:9' ? this.workspace : this.nowPlayingParent)?.append(this.nowPlaying);
      this.nowPlaying.classList.toggle('wide-now-playing', mode === '16:9');
    }
    for (const wordmark of this.workspace.querySelectorAll<KineticWordmark>('kinetic-wordmark')) wordmark.refreshPalette();
  }
}
