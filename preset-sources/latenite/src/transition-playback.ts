import type { StageMode } from './stage-layout.ts';
import { TRANSITION_CUES, TRANSITION_DURATION, TRANSITION_FPS } from './transition-model.ts';

interface LayoutRequest<T> { mode: StageMode; state: T }
interface PlaybackCallbacks<T> {
  apply(state: T): void;
  prepare(state: T, mode: StageMode): void;
  draw(time: number): void;
  reset(): void;
}

/** Commit under the opaque cover; finish later reversals before starting the latest request. */
export class TransitionPlayback<T> {
  private mode: StageMode | null = null;
  private requested: LayoutRequest<T> | null = null;
  private active: (LayoutRequest<T> & { elapsed: number; committed: boolean; synchronized?: boolean }) | null = null;
  private callbacks: PlaybackCallbacks<T>;

  constructor(callbacks: PlaybackCallbacks<T>) { this.callbacks = callbacks; }
  get running(): boolean { return this.active !== null; }

  /** OBS starts before its destination is known. Join its clock, then retarget
   * the same animation when the delayed program-scene event arrives. */
  begin(mode: StageMode, state: T, elapsed = 0, animate = true): void {
    this.requested = { mode, state };
    if (!animate || elapsed >= TRANSITION_DURATION) { this.finish(); return; }
    this.callbacks.reset();
    if (this.mode === null) { this.mode = mode; this.callbacks.apply(state); }
    this.active = { mode, state, elapsed: 0, committed: false, synchronized: true };
    this.callbacks.prepare(state, mode);
    this.advance(elapsed);
  }

  update(mode: StageMode, state: T, animate = true): void {
    this.requested = { mode, state };
    if (!animate || this.mode === null) { this.finish(); return; }
    if (this.active) {
      if (this.active.synchronized) {
        this.active.mode = mode;
        this.active.state = state;
        if (this.active.committed) {
          this.mode = mode;
          this.callbacks.apply(state);
        }
        this.callbacks.prepare(state, mode);
        this.callbacks.draw(this.active.elapsed);
        return;
      }
      if (mode === this.active.mode) {
        this.active.state = state;
        if (this.active.committed) {
          this.callbacks.apply(state);
          this.callbacks.prepare(state, mode);
          this.callbacks.draw(this.active.elapsed);
        }
      } else if (!this.active.committed) this.finish();
      return;
    }
    if (mode === this.mode) { this.callbacks.apply(state); return; }
    this.active = { mode, state, elapsed: 0, committed: false };
    this.callbacks.prepare(state, mode);
    this.callbacks.draw(0);
  }

  advance(elapsed: number): void {
    const active = this.active;
    if (!active) return;
    active.elapsed = Math.min(TRANSITION_DURATION, active.elapsed + Math.max(0, elapsed));
    if (!active.committed && active.elapsed >= TRANSITION_CUES.covered / TRANSITION_FPS * 1000) {
      active.committed = true;
      this.mode = active.mode;
      this.callbacks.apply(active.state);
      this.callbacks.prepare(active.state, active.mode);
    }
    this.callbacks.draw(active.elapsed);
    if (active.elapsed < TRANSITION_DURATION) return;
    this.active = null;
    this.callbacks.reset();
    if (this.requested && this.requested.mode !== this.mode) this.update(this.requested.mode, this.requested.state);
  }

  /** Hidden pages and reduced motion settle immediately to the newest Host state. */
  finish(): void {
    this.active = null;
    this.callbacks.reset();
    if (this.requested) {
      this.mode = this.requested.mode;
      this.callbacks.apply(this.requested.state);
    }
  }
}
