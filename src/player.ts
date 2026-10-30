import { createClient } from './sdk/client.ts';
import type { TransitionModule } from './sdk/contracts.ts';
import { SceneCoordinator } from './scene-coordinator.ts';
import './player.css';

const previewId = new URLSearchParams(location.search).get('preview');
const client = createClient({ previewId });
const stage = document.getElementById('stage')!;
const transitionLayer = document.getElementById('transition-layer')!;
const preview = Boolean(previewId);
let currentId: string | null = null;
let activeFrame: HTMLIFrameElement | null = null;
function lifecycle(frame: HTMLIFrameElement, topic: 'scene.enter' | 'scene.leave', sceneId: string, presetId = ''): void {
  frame.contentWindow?.postMessage({ source: 'streamui', topic, data: { sceneId, presetId, preview } }, location.origin);
}
const coordinator = new SceneCoordinator<HTMLIFrameElement>({
  load(scene, signal) {
    return new Promise((resolve, reject) => {
      const frame = document.createElement('iframe');
      frame.title = scene.name; frame.dataset.sceneId = scene.id;
      frame.style.visibility = 'hidden'; frame.setAttribute('sandbox', 'allow-scripts allow-same-origin');
      const url = new URL('/user/' + scene.entry, location.origin); url.searchParams.set('streamuiScene', scene.id);
      if (scene.presetId) url.searchParams.set('streamuiPreset', scene.presetId);
      if (previewId) url.searchParams.set('streamuiPreview', previewId);
      const abort = () => { clearTimeout(timer); frame.remove(); reject(new DOMException('Canceled', 'AbortError')); };
      const timer = setTimeout(() => { frame.remove(); signal.removeEventListener('abort', abort); reject(new Error('场景加载超时。')); }, 10000);
      signal.addEventListener('abort', abort, { once: true });
      frame.onload = () => { clearTimeout(timer); signal.removeEventListener('abort', abort); resolve(frame); };
      frame.onerror = () => { clearTimeout(timer); signal.removeEventListener('abort', abort); frame.remove(); reject(new Error('场景加载失败。')); };
      frame.src = url.href; stage.append(frame);
    });
  },
  async transition(from, to, covered, signal) {
    const layer = document.createElement('div'); layer.className = 'transition-instance'; transitionLayer.append(layer);
    const abort = () => layer.remove(); signal.addEventListener('abort', abort, { once: true });
    let deadlineTimer: ReturnType<typeof setTimeout> | undefined;
    try {
      const module = await import(/* @vite-ignore */ '/user/' + to.transition) as TransitionModule;
      signal.throwIfAborted();
      if (typeof module.play !== 'function') throw new Error('转场需要导出 play()。');
      const aborted = new Promise<never>((_, reject) => signal.addEventListener('abort', () => reject(new DOMException('Canceled', 'AbortError')), { once: true }));
      const deadline = new Promise<never>((_, reject) => { deadlineTimer = setTimeout(() => reject(new Error('转场执行超时。')), 15000); });
      await Promise.race([module.play({ container: layer, from, to, covered, signal }), aborted, deadline]);
    } finally { if (deadlineTimer) clearTimeout(deadlineTimer); signal.removeEventListener('abort', abort); layer.remove(); }
  },
  show(next, previous, scene) {
    if (previous && currentId) lifecycle(previous, 'scene.leave', currentId);
    next.style.visibility = 'visible'; currentId = scene.id; activeFrame = next;
    lifecycle(next, 'scene.enter', scene.id, scene.presetId);
    document.title = scene.name + ' · StreamUI';
  },
  update(frame, previous, scene) {
    lifecycle(frame, 'scene.leave', previous.id, previous.presetId);
    frame.dataset.sceneId = scene.id; frame.title = scene.name; currentId = scene.id;
    lifecycle(frame, 'scene.enter', scene.id, scene.presetId);
    document.title = scene.name + ' · StreamUI';
  },
  remove(frame) { if (frame === activeFrame && currentId) { lifecycle(frame, 'scene.leave', currentId); activeFrame = null; currentId = null; } frame.remove(); },
});
client.onState(state => {
  const id = state.scene.activeId;
  const scene = state.scenes.find(item => item.id === id);
  if (!scene) { coordinator.clear(); return; }
  stage.style.width = scene.width + 'px'; stage.style.height = scene.height + 'px';
  stage.style.transform = 'scale(' + Math.min(innerWidth / scene.width, innerHeight / scene.height) + ')';
  void coordinator.activate(scene, state.scene.playback).catch(error => {
    console.error(error);
    if (preview) parent.postMessage({ source: 'streamui-preview', error: (error as Error).message }, new URL(state.configUrl).origin);
  });
});
window.addEventListener('resize', () => { if (client.state) { const scene = client.state.scenes.find(s => s.id === client.state!.scene.activeId); if (scene) stage.style.transform = 'scale(' + Math.min(innerWidth / scene.width, innerHeight / scene.height) + ')'; } });
window.addEventListener('pagehide', () => { coordinator.clear(); client.stop(); });
window.addEventListener('pageshow', () => client.start());
client.start();
