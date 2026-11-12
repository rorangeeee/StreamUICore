import './config.css';
import { createClient, request } from './sdk/client.ts';
import type { CoreSettings, PluginInfo, PresetInfo, PublicState } from './sdk/contracts.ts';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id)! as T;
const select = (id: string) => $<HTMLSelectElement>(id);
const live = createClient({ previewId: null });
let preview: ReturnType<typeof createClient> | null = null, previewId = '';
let state: PublicState | null = null, currentPreset: string | null | undefined;
let settingsSceneId: string | null = null;
let section: 'scene' | 'plugin' | 'general' = 'scene', settingsPluginId: string | null = null;
let sceneSignature = '', panelSignature = '', pluginSignature = '', sidebarSignature = '', presetPanelSignature = '';
let preferences: CoreSettings = { enabledPlugins: [] };
let toastTimer: ReturnType<typeof setTimeout> | undefined;
let initializing: Promise<void> | null = null;
let startupBusy = false;
const sceneFrames = new Map<string, HTMLIFrameElement>();
const pluginSubscriptions = new Map<string, () => void>();
function feedback(message: string): void {
  $('feedback').textContent = message; $('feedback').hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => $('feedback').hidden = true, 5000);
}
function failure(error: unknown): void { feedback((error as Error).message); }
function tab(name: string): void {
  document.querySelector<HTMLElement>('.console')!.dataset.tab = name;
  for (const button of document.querySelectorAll<HTMLButtonElement>('button[data-tab]')) {
    const active = button.dataset.tab === name; button.setAttribute('aria-selected', String(active)); button.tabIndex = active ? 0 : -1;
  }
  $('panel-preview').setAttribute('role', name === 'preview' ? 'tabpanel' : 'complementary');
  if (name === 'preview') $('panel-preview').setAttribute('aria-labelledby', 'tab-preview');
  else $('panel-preview').removeAttribute('aria-labelledby');
  fitPreview();
}
const tabs = [...document.querySelectorAll<HTMLButtonElement>('button[data-tab]')];
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
function navigationButton(name: string, kind: 'scene' | 'plugin', id: string): HTMLButtonElement {
  const button = document.createElement('button'); button.type = 'button'; button.textContent = name;
  button.dataset.section = kind; button.dataset.id = id;
  button.onclick = () => { section = kind; if (kind === 'scene') settingsSceneId = id; else settingsPluginId = id; renderSelection(); };
  return button;
}
function renderSelection(): void {
  $('scene-panels').hidden = section !== 'scene'; $('plugin-panels').hidden = section !== 'plugin'; $('general-panel').hidden = section !== 'general';
  const scene = state?.scenes.find(scene => scene.id === settingsSceneId);
  const plugin = live.state?.plugins.find(plugin => plugin.id === settingsPluginId);
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-section]'))
    button.toggleAttribute('aria-current', false);
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-section]'))
    if (button.dataset.section === section && button.dataset.id === (section === 'scene' ? settingsSceneId : settingsPluginId)) button.setAttribute('aria-current', 'page');
  $('general-settings').toggleAttribute('aria-current', section === 'general');
  if (section === 'general') $('general-settings').setAttribute('aria-current', 'page');
  $('category-title').textContent = section === 'scene' ? scene?.name ?? '场景预设' : section === 'plugin' ? plugin?.name ?? '插件设置' : '通用设置';
  $('category-description').textContent = section === 'scene' ? '编辑当前场景的参数。' : section === 'plugin' ? '管理插件连接与运行参数。' : '配置操作界面的外观与后台。';
  $('settings-scope').textContent = section === 'scene' ? '场景预设' : section === 'plugin' ? '插件设置' : '即时生效';
  for (const card of $('plugin-list').children) {
    const selected = (card as HTMLElement).dataset.plugin === settingsPluginId; (card as HTMLElement).hidden = !selected;
    if (section === 'plugin' && selected && plugin?.settingsPage && !card.querySelector('iframe'))
      card.append(settingsFrame('plugins/' + plugin.id + '/' + plugin.settingsPage, { streamuiPlugin: plugin.id }, plugin.name + '配置'));
  }
  mountScenePanel();
}
function mountScenePanel(): void {
  const scene = state?.scenes.find(scene => scene.id === settingsSceneId);
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
  $('empty-settings').textContent = state?.scenes.length ? '这个场景没有配置项。' : '选择预设后可配置场景。';
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
  const signature = JSON.stringify(value.scenes.map(scene => [scene.id, scene.name, scene.role]));
  if (signature !== sceneSignature) {
    sceneSignature = signature;
    select('preview-scene').replaceChildren(...value.scenes.filter(scene => scene.role !== 'overlay').map(scene => new Option(scene.name, scene.id)));
    $('scene-navigation').replaceChildren(...value.scenes.map(scene => navigationButton(scene.name, 'scene', scene.id)));
  }
  if (!value.scenes.some(scene => scene.id === settingsSceneId)) settingsSceneId = value.scene.activeId;
  select('preview-scene').value = value.scene.activeId ?? ''; select('preview-scene').disabled = !value.scenes.some(scene => scene.role !== 'overlay');
  const url = new URL(value.outputUrl); url.searchParams.set('preview', previewId);
  const frame = $<HTMLIFrameElement>('preview-frame'); if (frame.src !== url.href) frame.src = url.href;
  $('preview-state').textContent = value.preset?.name ?? '未启用预设';
  fitPreview(); renderSelection(); mountSidebar();
}
function pluginRow(plugin: PluginInfo, required: boolean): HTMLElement {
  const card = document.createElement('section'); card.className = 'card'; card.dataset.plugin = plugin.id;
  const heading = document.createElement('div'); heading.className = 'card-heading';
  const title = document.createElement('h2'); title.textContent = required ? '随预设启用' : '启用插件';
  const toggle = document.createElement('input'); toggle.type = 'checkbox'; toggle.setAttribute('role', 'switch'); toggle.setAttribute('aria-label', '启用' + plugin.name);
  toggle.checked = plugin.enabled; toggle.disabled = required;
  toggle.onchange = async () => {
    preferences.enabledPlugins = toggle.checked ? [...new Set([...preferences.enabledPlugins, plugin.id])] : preferences.enabledPlugins.filter(id => id !== plugin.id);
    try { await request('/api/settings', 'PATCH', { enabledPlugins: preferences.enabledPlugins }); } catch (error) { failure(error); }
  };
  heading.append(title, toggle); toggle.hidden = required; card.append(heading);
  const error = document.createElement('p'); error.className = 'error'; card.append(error);
  if (!plugin.settingsPage) { const detail = document.createElement('span'); detail.className = 'detail'; detail.textContent = '版本 ' + plugin.version + ' · 此插件没有配置项。'; card.append(detail); }
  return card;
}
function syncLive(value: PublicState): void {
  $('output-url').textContent = value.outputUrl;
  $('preset-error').hidden = !value.presetError; $('preset-error').textContent = value.presetError ?? '';
  if (currentPreset !== value.preset?.id) { currentPreset = value.preset?.id; select('preset-picker').value = currentPreset ?? ''; }
  const signature = JSON.stringify(value.plugins.map(plugin => [plugin.id, plugin.version, plugin.settingsPage]));
  if (signature !== pluginSignature) {
    pluginSignature = signature;
    $('plugin-navigation').replaceChildren(...value.plugins.map(plugin => navigationButton(plugin.name, 'plugin', plugin.id)));
    $('plugin-list').replaceChildren(...value.plugins.map(plugin => pluginRow(plugin, value.preset?.requiredPlugins.includes(plugin.id) ?? false)));
  }
  if (!value.plugins.some(plugin => plugin.id === settingsPluginId)) settingsPluginId = value.plugins[0]?.id ?? null;
  for (const plugin of value.plugins) {
    if (!pluginSubscriptions.has(plugin.id)) pluginSubscriptions.set(plugin.id, live.on('plugin.' + plugin.id + '.status', status => {
      const current = live.state?.plugins.find(item => item.id === plugin.id);
      if (current) { current.topics.status = status; syncPluginStatus(live.state!); }
    }));
    const card = [...$('plugin-list').children].find(card => (card as HTMLElement).dataset.plugin === plugin.id)!;
    const required = value.preset?.requiredPlugins.includes(plugin.id) ?? false;
    const toggle = card.querySelector<HTMLInputElement>('input[role=switch]')!;
    toggle.checked = plugin.enabled; toggle.hidden = required; toggle.disabled = required;
    card.querySelector('.card-heading h2')!.textContent = required ? '随预设启用' : '启用插件';
    const error = card.querySelector<HTMLElement>('.error')!; error.hidden = !plugin.error; error.textContent = plugin.error ?? '';
  }
  $('empty-plugins').hidden = value.plugins.length > 0;
  if (!startupBusy) $<HTMLInputElement>('startup-enabled').checked = value.startup;
  for (const [id, off] of pluginSubscriptions) if (!value.plugins.some(plugin => plugin.id === id)) { off(); pluginSubscriptions.delete(id); }
  syncPluginStatus(value); renderSelection();
}
function syncPluginStatus(value: PublicState): void {
  const summaries = value.plugins.map(plugin => {
    const topic = plugin.topics.status as { state?: string; audio?: { state?: string } } | undefined;
    const state = topic?.state ?? topic?.audio?.state ?? plugin.state;
    const labels: Record<string, string> = { connected: '已连接', live: '采集中', running: '运行中', connecting: '正在连接', reconnecting: '正在重连', disabled: '未启用', disconnected: '未连接', idle: '已停止', error: '不可用', stopped: '已停止' };
    return { name: plugin.name, label: plugin.error ? '不可用' : labels[state] ?? state, active: plugin.enabled && ['connected', 'live', 'running'].includes(state) };
  });
  for (const [id, definition] of [['service-strip', true], ['plugin-status', false]] as const) {
    $(id).replaceChildren(...summaries.map(summary => {
      const row = document.createElement(definition ? 'span' : 'div');
      const name = document.createElement(definition ? 'span' : 'dt'); name.textContent = summary.name;
      const status = document.createElement(definition ? 'strong' : 'dd'); status.textContent = summary.label; status.dataset.live = String(summary.active);
      row.append(name, status); return row;
    }));
  }
}
async function catalog(refresh = false): Promise<void> {
  const presets = await request<PresetInfo[]>(refresh ? '/api/presets/reload' : '/api/presets', refresh ? 'POST' : 'GET');
  const selected = select('preset-picker').value || live.state?.preset?.id || '';
  select('preset-picker').replaceChildren(new Option('选择预设', ''), ...presets.map(preset => {
    const option = new Option(preset.name, preset.id); option.disabled = !preset.available; option.title = preset.error ?? ''; return option;
  }));
  select('preset-picker').value = selected;
}
const installToggle = $<HTMLButtonElement>('toggle-install');
const installRepository = $<HTMLInputElement>('install-repository');
const installSubmit = $<HTMLButtonElement>('install-submit');
const installStatus = $('install-status');
function showInstall(open: boolean): void {
  $('extension-install').hidden = !open;
  installToggle.setAttribute('aria-expanded', String(open));
  if (open) installRepository.focus();
}
installToggle.onclick = () => showInstall($('extension-install').hasAttribute('hidden'));
$<HTMLFormElement>('install-form').onsubmit = async event => {
  event.preventDefault();
  if (installSubmit.disabled) return;
  installSubmit.disabled = true;
  installRepository.readOnly = true;
  installStatus.removeAttribute('data-error');
  installStatus.textContent = '正在拉取仓库并构建，可能需要几分钟。';
  try {
    const extension = await request<{ kind: 'preset' | 'plugin'; id: string; name: string }>(
      '/api/extensions/install', 'POST', { repository: installRepository.value.trim() },
    );
    if (extension.kind === 'preset') {
      await catalog();
      select('preset-picker').value = extension.id;
      tab('preview');
      feedback('已安装「' + extension.name + '」。点击「启用预设」切换直播画面。');
    } else {
      section = 'plugin';
      settingsPluginId = extension.id;
      tab('settings');
      renderSelection();
      feedback('已安装「' + extension.name + '」。可在插件设置中启用。');
    }
    installRepository.value = '';
    installStatus.textContent = '';
    showInstall(false);
    (extension.kind === 'preset' ? $('activate-preset') : installToggle).focus();
  } catch (error) {
    installStatus.dataset.error = 'true';
    installStatus.textContent = (error as Error).message;
  } finally {
    installRepository.readOnly = false;
    installSubmit.disabled = false;
  }
};
select('preview-scene').onchange = () => void preview?.selectScene(select('preview-scene').value).catch(failure);
$('general-settings').onclick = () => { section = 'general'; renderSelection(); };
$('show-preview').onclick = () => tab('preview');
$<HTMLInputElement>('startup-enabled').onchange = async () => {
  const input = $<HTMLInputElement>('startup-enabled'), enabled = input.checked;
  startupBusy = true; input.disabled = true;
  try { await request('/api/startup', 'PUT', { enabled }); } catch (error) { input.checked = !enabled; failure(error); }
  finally { startupBusy = false; input.disabled = false; }
};
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
  $('connection-notice').hidden = connected;
  $('connection-notice').textContent = connected ? '' : '与 Host 的连接已断开，正在重连。配置更改失败时会保留在对应面板中。';
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
tab('settings'); void initialize().catch(failure);
addEventListener('pagehide', () => { preview?.stop(); live.stop(); const id = previewId; previewId = ''; if (id) void request('/api/previews/' + id, 'DELETE').catch(() => {}); });
addEventListener('pageshow', () => { live.start(); if (!previewId) void initialize().catch(failure); });
