import type { SceneSlot, ScenePlayback } from './sdk/contracts.ts';
export interface SceneDriver<T> {
  load(scene: SceneSlot, signal: AbortSignal): Promise<T>;
  transition(from: SceneSlot | null, to: SceneSlot, covered: () => void, signal: AbortSignal): Promise<void>;
  show(next: T, previous: T | null, scene: SceneSlot, playback?: ScenePlayback | null): void;
  update?(value: T, previous: SceneSlot, scene: SceneSlot, playback?: ScenePlayback | null): void;
  remove(value: T): void;
}
export class SceneCoordinator<T> {
  private controller: AbortController | null = null;
  private current: { scene: SceneSlot; value: T } | null = null;
  private requested = '';
  private driver: SceneDriver<T>;
  constructor(driver: SceneDriver<T>) { this.driver = driver; }
  async activate(scene: SceneSlot, playback?: ScenePlayback | null): Promise<void> {
    const signature = JSON.stringify([scene, playback?.id]);
    if (signature === this.requested) return;
    this.requested = signature;
    this.controller?.abort();
    const controller = new AbortController(); this.controller = controller;
    let next: T | null = null, committed = false;
    try {
      if (this.current && scene.runtimeGroup && scene.runtimeGroup === this.current.scene.runtimeGroup
          && scene.entry === this.current.scene.entry && scene.width === this.current.scene.width && scene.height === this.current.scene.height && this.driver.update) {
        this.driver.update(this.current.value, this.current.scene, scene, playback);
        this.current.scene = scene;
        return;
      }
      next = await this.driver.load(scene, controller.signal);
      controller.signal.throwIfAborted();
      const covered = () => {
        if (committed || controller.signal.aborted || next === null) return;
        committed = true;
        const previous = this.current;
        this.driver.show(next, previous?.value ?? null, scene, playback);
        this.current = { scene, value: next };
        if (previous) this.driver.remove(previous.value);
      };
      if (this.current && scene.transition && (playback === undefined || playback?.animate)) await this.driver.transition(this.current.scene, scene, covered, controller.signal);
      else covered();
      controller.signal.throwIfAborted();
      if (!committed) throw new Error('转场未调用 covered()。');
    } catch (error) {
      if (next !== null && !committed) this.driver.remove(next);
      if (controller.signal.aborted) return;
      this.requested = '';
      throw error;
    }
  }
  clear(): void {
    this.controller?.abort(); this.controller = null; this.requested = '';
    if (this.current) this.driver.remove(this.current.value);
    this.current = null;
  }
}
