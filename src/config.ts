import './config.css';
import { createClient, request } from './sdk/client.ts';
import type { CoreSettings, PluginInfo, PresetInfo, PublicState, SceneSlot } from './sdk/contracts.ts';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id)! as T;
const select = (id: string) => $<HTMLSelectElement>(id);
const live = createClient({ previewId: null });
let preview: ReturnType<typeof createClient> | null = null, previewId = '';
let state: PublicState | null = null, currentPreset: string | null | undefined;
let sceneSignature = '', panelSignature = '', pluginSignature = '', sidebarSignature = '', presetPanelSignature = '';
let preferences: CoreSettings = { enabledPlugins: [] };
let toastTimer: ReturnType<typeof setTimeout> | undefined;
let initializing: Promise<void> | null = null;
const sceneFrames = new Map<string, HTMLIFrameElement>();
function failure(error: unknown): void {
  $('feedback').textContent = (error as Error).message; $('feedback').hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => $('feedback').hidden = true, 5000);
}
function tab(name: string): void {
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-tab]')) {
    const active = button.dataset.tab === name; button.setAttribute('aria-selected', String(active)); button.tabIndex = active ? 0 : -1;
    $('panel-' + button.dataset.tab).hidden = !active;
  }
  fitPreview();
}
const tabs = [...document.querySelectorAll<HTMLButtonElement>('[data-tab]')];
tabs.forEach((button, index) => {
  button.onclick = () => tab(button.dataset.tab!);
  button.onkeydown = event => {
    const position = event.key === 'ArrowDown' || event.key === 'ArrowRight' ? (index + 1) % tabs.length
      : event.key === 'ArrowUp' || event.key === 'ArrowLeft' ? (index + tabs.length - 1) % tabs.length : -1;
    if (position >= 0) { event.preventDefault(); tabs[position].focus(); tab(tabs[position].dataset.tab!); }
  };
});
function settingsFrame(path: string, parameters: Record<string, string>, title: string): HTMLIFrameElement {
  const frame = document.createElement('iframe'); frame.title = title; frame.className = 'settings-frame'; frame.style.height = '1px';
  const url = new URL('/user/' + path, location.origin);
  for (const [key, value] of Object.entries(parameters)) url.searchParams.set(key, value);
  if (previewId) url.searchParams.set('streamuiPreview', previewId);
  let observer: ResizeObserver | undefined;
  frame.onload = () => {
    observer?.disconnect();
    const body = frame.contentDocument?.body; if (!body) return;
    const resize = () => { frame.style.height = Math.ceil(body.getBoundingClientRect().height) + 'px'; };
    observer = new ResizeObserver(resize); observer.observe(body); resize();
  };
  frame.src = url.href; return frame;
}
function mountScenePanel(): void {
  const scene = state?.scenes.find(scene => scene.id === state!.scene.activeId);
  const signature = JSON.stringify([scene?.id, scene?.settingsPage, previewId]);
  if (signature !== panelSignature) {
    panelSignature = signature;
    if (scene?.settingsPage && !sceneFrames.has(signature)) {
      const frame = settingsFrame(scene.settingsPage, { streamuiScene: scene.id, streamuiPreset: scene.presetId ?? '' }, scene.name + '配置');
      sceneFrames.set(signature, frame); $('scene-settings').append(frame);
    }
    for (const [key, frame] of sceneFrames) frame.hidden = key !== signature;
    $('scene-settings').hidden = !scene?.settingsPage;
  }
  const preset = state?.preset, presetSignature = JSON.stringify([preset?.id, preset?.settingsPage, previewId]);
  if (presetSignature !== presetPanelSignature) {
    presetPanelSignature = presetSignature; $('preset-settings').replaceChildren();
    if (preset?.settingsPage) $('preset-settings').append(settingsFrame(preset.settingsPage, { streamuiPreset: preset.id }, preset.name + '配置'));
  }
  $('empty-settings').hidden = Boolean(scene?.settingsPage || preset?.settingsPage);
}
function mountSidebar(): void {
  const preset = state?.preset, signature = JSON.stringify([preset?.id, preset?.sidebarPage, previewId]);
  if (signature === sidebarSignature) return; sidebarSignature = signature;
  $('sidebar-controls').replaceChildren();
  if (preset?.sidebarPage && previewId) $('sidebar-controls').append(settingsFrame(preset.sidebarPage, { streamuiPreset: preset.id }, preset.name + '控制'));
}
function fitPreview(): void {
  const scene = state?.scenes.find(scene => scene.id === state!.scene.activeId);
  $('empty-preview').hidden = Boolean(scene); $('replay').toggleAttribute('disabled', !scene);
  if (!scene) { $('canvas-size').textContent = ''; return; }
  const viewport = $('stage-viewport'), frame = $<HTMLIFrameElement>('preview-frame');
  viewport.style.aspectRatio = scene.width + '/' + scene.height;
  Object.assign(frame.style, { width: scene.width + 'px', height: scene.height + 'px', transform: 'scale(' + Math.min(viewport.clientWidth / scene.width, viewport.clientHeight / scene.height) + ')' });
  $('canvas-size').textContent = scene.width + ' × ' + scene.height;
}
function syncPreview(value: PublicState): void {
  state = value;
  const signature = JSON.stringify(value.scenes.map(scene => [scene.id, scene.name]));
  if (signature !== sceneSignature) {
    sceneSignature = signature;
    for (const id of ['preview-scene', 'settings-scene']) select(id).replaceChildren(...value.scenes.map(scene => new Option(scene.name, scene.id)));
  }
  for (const id of ['preview-scene', 'settings-scene']) {
    select(id).value = value.scene.activeId ?? ''; select(id).disabled = value.scenes.length === 0;
  }
  const url = new URL(value.outputUrl); url.searchParams.set('preview', previewId);
  const frame = $<HTMLIFrameElement>('preview-frame'); if (frame.src !== url.href) frame.src = url.href;
  fitPreview(); mountScenePanel(); mountSidebar();
}
function pluginRow(plugin: PluginInfo, required: boolean): HTMLElement {
  const card = document.createElement('section'); card.className = 'card'; card.dataset.plugin = plugin.id;
  const heading = document.createElement('div'); heading.className = 'card-heading';
  const title = document.createElement('h2'); title.textContent = plugin.name;
  const toggle = document.createElement('input'); toggle.type = 'checkbox'; toggle.setAttribute('role', 'switch'); toggle.setAttribute('aria-label', '启用' + plugin.name);
  toggle.checked = plugin.enabled; toggle.disabled = required;
  toggle.onchange = async () => {
    preferences.enabledPlugins = toggle.checked ? [...new Set([...preferences.enabledPlugins, plugin.id])] : preferences.enabledPlugins.filter(id => id !== plugin.id);
    try { await request('/api/settings', 'PATCH', { enabledPlugins: preferences.enabledPlugins }); } catch (error) { failure(error); }
  };
  heading.append(title, toggle); toggle.hidden = required; card.append(heading);
  const error = document.createElement('p'); error.className = 'error'; card.append(error);
  if (plugin.settingsPage) card.append(settingsFrame('plugins/' + plugin.id + '/' + plugin.settingsPage, { streamuiPlugin: plugin.id }, plugin.name + '配置'));
  else { const detail = document.createElement('span'); detail.className = 'detail'; detail.textContent = plugin.version; card.append(detail); }
  return card;
}
function syncLive(value: PublicState): void {
  $('output-url').textContent = value.outputUrl;
  $('preset-error').hidden = !value.presetError; $('preset-error').textContent = value.presetError ?? '';
  if (currentPreset !== value.preset?.id) { currentPreset = value.preset?.id; select('preset-picker').value = currentPreset ?? ''; }
  const signature = JSON.stringify(value.plugins.map(plugin => [plugin.id, plugin.version, plugin.settingsPage]));
  if (signature !== pluginSignature) {
    pluginSignature = signature;
    $('plugin-list').replaceChildren(...value.plugins.map(plugin => pluginRow(plugin, value.preset?.requiredPlugins.includes(plugin.id) ?? false)));
  }
  for (const plugin of value.plugins) {
    const card = [...$('plugin-list').children].find(card => (card as HTMLElement).dataset.plugin === plugin.id)!;
    const toggle = card.querySelector<HTMLInputElement>('input[role=switch]')!;
    toggle.checked = plugin.enabled; toggle.hidden = value.preset?.requiredPlugins.includes(plugin.id) ?? false; toggle.disabled = toggle.hidden;
    const error = card.querySelector<HTMLElement>('.error')!; error.hidden = !plugin.error; error.textContent = plugin.error ?? '';
  }
  $('empty-plugins').hidden = value.plugins.length > 0;
}
async function catalog(refresh = false): Promise<void> {
  const presets = await request<PresetInfo[]>(refresh ? '/api/presets/reload' : '/api/presets', refresh ? 'POST' : 'GET');
  const selected = select('preset-picker').value || live.state?.preset?.id || '';
  select('preset-picker').replaceChildren(new Option('选择预设', ''), ...presets.map(preset => {
    const option = new Option(preset.name, preset.id); option.disabled = !preset.available; option.title = preset.error ?? ''; return option;
  }));
  select('preset-picker').value = selected;
}
select('preview-scene').onchange = () => void preview?.selectScene(select('preview-scene').value).catch(failure);
select('settings-scene').onchange = () => void preview?.selectScene(select('settings-scene').value, { animate: false }).catch(failure);
$('replay').onclick = () => { if (state?.scene.activeId) void preview?.selectScene(state.scene.activeId).catch(failure); };
$('activate-preset').onclick = () => void request('/api/presets/activate', 'POST', { id: select('preset-picker').value || null }).catch(failure);
$('refresh-presets').onclick = () => void catalog(true).catch(failure);
$('refresh-plugins').onclick = () => void request('/api/plugins/reload', 'POST').catch(failure);
for (const [id, page] of [['open-output', 'obs'], ['open-presets', 'presets'], ['open-plugins', 'plugins']])
  $(id).onclick = () => void request('/api/open/' + page, 'POST').catch(failure);
$('copy-url').onclick = () => { if (live.state) void navigator.clipboard.writeText(live.state.outputUrl).catch(failure); };
$('reload-preview').onclick = () => { const frame = $<HTMLIFrameElement>('preview-frame'); if (frame.src) frame.src = frame.src; };
new ResizeObserver(fitPreview).observe($('stage-viewport'));
live.onState(syncLive);
live.on<boolean>('connection', connected => {
  $('connection-status').textContent = connected ? '已连接' : '正在连接'; $('connection-dot').dataset.connected = String(connected);
  if (connected && previewId) void request('/api/state?preview=' + previewId).catch(() => initialize()).catch(failure);
});
live.start();
async function initialize(): Promise<void> {
  if (initializing) return initializing;
  initializing = (async () => {
    const [created, values] = await Promise.all([request<{ id: string; state: PublicState }>('/api/previews', 'POST'), request<CoreSettings>('/api/settings'), catalog()]);
    preview?.stop(); previewId = created.id; preferences = values; preview = createClient({ previewId });
    sceneFrames.clear(); panelSignature = ''; $('scene-settings').replaceChildren();
    pluginSignature = ''; if (live.state) syncLive(live.state);
    preview.onState(syncPreview); syncPreview(created.state); preview.start();
  })();
  try { await initializing; } finally { initializing = null; }
}
void initialize().catch(failure);
addEventListener('pagehide', () => { preview?.stop(); live.stop(); const id = previewId; previewId = ''; if (id) void request('/api/previews/' + id, 'DELETE').catch(() => {}); });
addEventListener('pageshow', () => { live.start(); if (!previewId) void initialize().catch(failure); });
