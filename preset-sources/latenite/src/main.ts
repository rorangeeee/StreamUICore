import './style.css';
import './stage.css';
import './stage-wide.css';
import { StagePresentation } from './stage-presentation.ts';
import './stream-marquee.ts';
import './on-air-indicator.ts';
import './barcode-code.ts';
import './data-matrix-code.ts';
import './locator-marker.ts';
import './design-credit.ts';
import { MetadataTerminal } from './metadata-terminal.ts';
import { NowPlaying } from './now-playing.ts';
import { DetectionOverlays } from './detection-overlay.ts';
import { HostAudio } from './audio.ts';
import type { AudioFrame, AudioState } from './audio.ts';
import { AudioScope } from './audio-scope.ts';
import './chat-terminal.ts';
import './chat-history-terminal.ts';
import { KineticWordmark } from './kinetic-wordmark.ts';
import { STAGE_WIDTH, STAGE_HEIGHT } from './stage-layout.ts';
import { WindowManager } from './windows.ts';
import { host } from './host-client.ts';
import type { HostState } from './host-client.ts';
import { TransitionRenderer } from './transition-renderer.ts';
import { TransitionPlayback } from './transition-playback.ts';
import { transitionSettings } from './transition-settings.ts';
import { TRANSITION_DURATION } from './transition-model.ts';
import { AwayOverlay } from './away-overlay.ts';

const editor = new URLSearchParams(location.search).get('edit') === '1';
document.body.dataset.editing = String(editor);
const audio = new HostAudio();
const workspace = document.querySelector<HTMLElement>('#workspace')!;
const surface = document.createElement('div');
surface.className = 'stage-transition-surface';
workspace.before(surface); surface.append(workspace);
const presentation = new StagePresentation(workspace);
const windows = new WindowManager(workspace, editor);
const nowPlaying = document.querySelector<NowPlaying>('now-playing')!;
new DetectionOverlays(workspace);
const scopes = Array.from(document.querySelectorAll<AudioScope>('audio-scope'));
let animation = 0;
let previousTime = 0;
let previousFrame: AudioFrame | null = null;
let previousState: AudioState | null = null;
let initialized = false;
let previousLayout = '';
let canvasWidth = STAGE_WIDTH, canvasHeight = STAGE_HEIGHT;
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const renderer = new TransitionRenderer(surface, workspace, true);
const away = new AwayOverlay(); surface.append(away);
let transitionVisuals = '';
const transition = new TransitionPlayback<HostState>({
  apply: applyState,
  prepare: (state, mode) => {
    const settings = transitionSettings(state), signature = JSON.stringify([mode, settings]);
    if (signature !== transitionVisuals) { renderer.configure(settings, mode); transitionVisuals = signature; }
  },
  draw: time => { renderer.draw(time); },
  reset: () => renderer.reset(),
});
let transitionAnimation = 0, transitionTime = 0;
let obsTransitionId: string | null = null;

function fitCanvas(): void {
  workspace.style.setProperty('--ui-scale', String(Math.min(canvasWidth / STAGE_WIDTH, canvasHeight / STAGE_HEIGHT)));
  Object.assign(workspace.style, {
    width: `${canvasWidth}px`, height: `${canvasHeight}px`,
  });
  Object.assign(surface.style, {
    width: `${canvasWidth}px`, height: `${canvasHeight}px`,
    transform: `scale(${Math.min(innerWidth / canvasWidth, innerHeight / canvasHeight)})`,
  });
}

function applyState(state: HostState): void {
  const config = state.config;
  const mode = config.layoutMode ?? '21:9';
  const changedMode = windows.mode !== mode;
  presentation.apply(mode);
  windows.setMode(mode);
  const changedSize = canvasWidth !== config.canvas.width || canvasHeight !== config.canvas.height;
  canvasWidth = config.canvas.width; canvasHeight = config.canvas.height;
  fitCanvas();
  document.querySelector<KineticWordmark>('#bilingual-title')!.setTitles(config.titles?.english ?? ['TITLE'], config.titles?.chinese ?? ['标题']);
  const layout = JSON.stringify([mode, config.canvas, config.layout]);
  if ((!editor && layout !== previousLayout) || !initialized || changedSize || changedMode) windows.restore(config.layout);
  previousLayout = layout;
  initialized = true;
}

function drawTransition(time: number): void {
  transition.advance(transitionTime ? time - transitionTime : 0);
  transitionTime = time;
  transitionAnimation = transition.running ? requestAnimationFrame(drawTransition) : 0;
  if (!transition.running) transitionTime = 0;
}

function finishTransition(): void {
  cancelAnimationFrame(transitionAnimation); transitionAnimation = 0; transitionTime = 0;
  transition.finish();
}

function syncPresentation(resume = false): void {
  if (!host.state) return;
  const state = host.state!, config = state.config;
  away.update(config.away);
  document.querySelector<MetadataTerminal>('stream-metadata')!.update(state);
  nowPlaying.update(state.nowPlaying);
  const animate = !editor && !document.hidden && !reducedMotion.matches
    && (!initialized || (canvasWidth === config.canvas.width && canvasHeight === config.canvas.height));
  const signal = state.obs?.transition;
  const mode = config.layoutMode ?? '21:9';
  if (signal && (signal.id !== obsTransitionId || resume)) {
    obsTransitionId = signal.id;
    const elapsed = Math.max(0, Date.now() - signal.startedAt);
    transition.begin(mode, state, elapsed, animate && elapsed < TRANSITION_DURATION);
    // The next animation frame must not count time from an older run again.
    transitionTime = performance.now();
  } else if (!signal && obsTransitionId !== null) {
    obsTransitionId = null;
    transition.update(mode, state, false);
  } else transition.update(mode, state, animate);
  if (transition.running && !transitionAnimation) transitionAnimation = requestAnimationFrame(drawTransition);
  else if (!transition.running) { cancelAnimationFrame(transitionAnimation); transitionAnimation = 0; transitionTime = 0; }
}
host.addEventListener('state', () => syncPresentation());
host.addEventListener('connectionchange', () => { if (!host.connected) nowPlaying.update(null); });
workspace.addEventListener('layoutchange', (event) => {
  if (editor && host.state && parent !== window) parent.postMessage({ type: 'streamui:layout', mode: windows.mode, layout: (event as CustomEvent).detail }, new URL(host.state.configUrl).origin);
});
window.addEventListener('message', (event) => {
  if (!editor || !host.state || event.source !== parent || event.origin !== new URL(host.state.configUrl).origin) return;
  if (event.data?.type === 'streamui:reset') { windows.reset(); windows.save(); }
});

function draw(time: number): void {
  const frame = audio.read();
  if (frame !== previousFrame) {
    const elapsed = previousTime ? (time - previousTime) / 1000 : 1 / 60;
    previousTime = time; previousFrame = frame;
    if (windows.mode === '21:9') for (const scope of scopes) scope.render(frame, elapsed);
  }
  if (audio.state === 'live' && !document.hidden) animation = requestAnimationFrame(draw);
}
function syncState(): void {
  cancelAnimationFrame(animation); previousTime = 0; previousFrame = null;
  document.body.dataset.audioState = audio.state;
  workspace.setAttribute('aria-busy', String(audio.state === 'requesting'));
  workspace.setAttribute('aria-label', audio.error ?? '音频可视化与弹幕工作区');
  if (audio.state === 'live' && previousState !== 'live') scopes.forEach(scope => scope.clear());
  previousState = audio.state;
  if (audio.state === 'live' && !document.hidden) animation = requestAnimationFrame(draw);
  else for (const scope of scopes) scope.render(null);
}
audio.addEventListener('statechange', syncState);
document.addEventListener('visibilitychange', syncState);
document.addEventListener('visibilitychange', () => { if (document.hidden) finishTransition(); else syncPresentation(true); });
reducedMotion.addEventListener('change', () => { if (reducedMotion.matches) finishTransition(); });
window.addEventListener('resize', fitCanvas);
window.addEventListener('pagehide', () => { finishTransition(); audio.stop(); host.stop(); });
window.addEventListener('pageshow', () => { audio.start(); syncState(); });
fitCanvas(); windows.reset(); audio.start(); syncState();
