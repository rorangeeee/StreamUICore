import { ON_AIR_BLINK } from './on-air-motion.ts';
import { mixedTextRuns } from './mixed-text.ts';

export const NOW_PLAYING_HEIGHT = 42;
export const NOW_PLAYING_PANEL_HEIGHT = 218.615;
export interface NowPlayingTrack { title: string; artist: string; playing: boolean; state: string }
export interface PlayingRun { language: 'en' | 'zh'; text: string }

export function nowPlayingText(track: NowPlayingTrack | null | undefined): string {
  const clean = (value: unknown) => typeof value === 'string' ? value.replace(/[\p{Cc}\p{Zl}\p{Zp}]+/gu, ' ').trim() : '';
  const title = clean(track?.title), artist = clean(track?.artist);
  return track?.playing && title ? `NOW PLAYING:  ${title}${artist ? `-${artist}` : ''}` : '';
}

export function nowPlayingRuns(text: string): PlayingRun[] {
  return mixedTextRuns(text);
}

export function nowPlayingLit(time: number): boolean {
  return Math.max(0, time) % ON_AIR_BLINK < ON_AIR_BLINK / 2;
}
