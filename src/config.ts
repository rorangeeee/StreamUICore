import './config.css';
import { createClient, request } from './sdk/client.ts';
import type { CoreSettings, SceneSlot, PluginInfo, PresetInfo } from './sdk/contracts.ts';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id)! as T;
const input = (id: string) => $<HTMLInputElement>(id);
const select = (id: string) => $<HTMLSelectElement>(id);
const client = createClient();
let settings: CoreSettings | null = null, currentTab = 'preview', optionsSignature = '', parametersSignature = '', pluginSignature = '', panelPlugin = '';
let toastTimer: ReturnType<typeof setTimeout> | undefined;
let installedPresets: PresetInfo[] = [], shownPreset: string | null | undefined;

function toast(message: string, error = false): void {
  const box = $('feedback'); box.textContent = message; box.dataset.error = String(error); box.hidden = false;
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => box.hidden = true, error ? 7000 : 2400);
}
const failure = (error: unknown) => toast((error as Error).message, true);
function tab(name: string): void {
  currentTab = name;
  document.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach(button => {
    const active = button.dataset.tab === name;
    button.setAttribute('aria-selected', String(active)); button.tabIndex = active ? 0 : -1;
  });
  $('panel-stage').hidden = name === 'settings'; $('panel-settings').hidden = name !== 'settings';
  if (name === 'preview') preview();
}
document.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach(button => {
  button.onclick = () => tab(button.dataset.tab!);
  button.onkeydown = event => {
    const buttons = [...document.querySelectorAll<HTMLButtonElement>('[data-tab]')];
    let index = buttons.indexOf(button);
    if (event.key === 'ArrowRight') index = (index + 1) % buttons.length;
    else if (event.key === 'ArrowLeft') index = (index + buttons.length - 1) % buttons.length;
    else if (event.key === 'Home') index = 0;
    else if (event.key === 'End') index = buttons.length - 1;
    else return;
    event.preventDefault(); buttons[index].focus(); tab(buttons[index].dataset.tab!);
  };
});
function markDirty(): void { $('save-status').textContent = '有未保存的修改'; }
function sceneOptions(): void {
  const state = client.state; if (!state) return;
  const signature = JSON.stringify(state.scenes.map(scene => [scene.id, scene.name]));
  if (signature !== optionsSignature) {
    optionsSignature = signature;
    select('scene-picker').replaceChildren(...state.scenes.filter(scene => scene.id !== state.scene.awaySceneId).map(scene => new Option(scene.name, scene.id)));
  }
  select('scene-picker').value = state.scene.selectedId ?? '';
}
function drawSceneParameters(): void {
  const scenes = (client.state?.scenes ?? []).filter(scene => scene.settingsPage);
  const preset = client.state?.preset;
  const panels = [...(preset?.settingsPage ? [{ id: preset.id, name: preset.name, settingsPage: preset.settingsPage, parameter: 'streamuiPreset' }] : []),
    ...scenes.map(scene => ({ ...scene, parameter: 'streamuiScene' }))];
  const signature = JSON.stringify(panels.map(scene => [scene.id, scene.name, scene.settingsPage]));
  if (signature === parametersSignature) return; parametersSignature = signature;
  $('scene-parameters').replaceChildren(...panels.map(scene => {
    const panel = document.createElement('details'); panel.className = 'card extension-panel';
    const summary = document.createElement('summary'); summary.textContent = scene.name + '设置';
    const frame = document.createElement('iframe'); frame.className = 'scene-config-frame'; frame.title = scene.name + '设置'; frame.loading = 'lazy';
    const url = new URL('/user/' + scene.settingsPage, location.origin); url.searchParams.set(scene.parameter, scene.id); frame.src = url.href;
    panel.append(summary, frame); return panel;
  }));
}
async function loadPresets(refresh = false): Promise<void> {
  installedPresets = await request<PresetInfo[]>(refresh ? '/api/presets/reload' : '/api/presets', refresh ? 'POST' : 'GET');
  const picker = select('preset-picker'), previous = picker.value;
  picker.replaceChildren(new Option('不启用预设', ''), ...installedPresets.map(preset => {
    const option = new Option(preset.name + ' · ' + preset.version + (preset.available ? '' : '（不可用）'), preset.id); option.disabled = !preset.available; return option;
  }));
  picker.value = previous || client.state?.preset?.id || '';
}
function activeScene(): SceneSlot | undefined { return client.state?.scenes.find(scene => scene.id === client.state!.scene.activeId); }
function fitPreview(): void {
  const scene = activeScene(); $('preset-empty').hidden = Boolean(scene);
  if (!scene) { $('canvas-size').textContent = '—'; return; }
  const viewport = $('stage-viewport'), frame = $<HTMLIFrameElement>('output-frame');
  viewport.style.aspectRatio = scene.width + '/' + scene.height;
  Object.assign(frame.style, { width: scene.width + 'px', height: scene.height + 'px',
    transform: 'scale(' + Math.min(viewport.clientWidth / scene.width, viewport.clientHeight / scene.height) + ')' });
  $('canvas-size').textContent = scene.width + ' × ' + scene.height;
}
function preview(): void {
  const state = client.state; if (!state || currentTab !== 'preview') return;
  const url = new URL(state.outputUrl); url.searchParams.set('preview', '1');
  const frame = $<HTMLIFrameElement>('output-frame'); if (frame.src !== url.href) frame.src = url.href;
  fitPreview();
}
new ResizeObserver(fitPreview).observe($('stage-viewport'));
$<HTMLIFrameElement>('output-frame').onload = fitPreview;
function setStatus(id: string, value: string, live: boolean): void { $(id).textContent = value; $(id).dataset.live = String(live); }
function sync(): void {
  const state = client.state;
  $('host-dot').dataset.live = String(client.connected); $('host-status').textContent = client.connected ? '已连接' : '正在重新连接';
  $('save-settings').toggleAttribute('disabled', !client.connected || !settings);
  select('preset-picker').disabled = !client.connected;
  $<HTMLButtonElement>('apply-preset').disabled = !client.connected;
  select('scene-picker').disabled = !client.connected || !state?.scenes.length;
  for (const id of ['away-enabled', 'away-settings-enabled']) { input(id).disabled = !client.connected || !state?.scene.awaySceneId; input(id).checked = state?.scene.away ?? false; }
  $('away-status').textContent = !client.connected ? '未连接' : state?.scene.away ? '暂离中' : '已返回';
  if (!state) return;
  if (shownPreset !== (state.preset?.id ?? null)) { shownPreset = state.preset?.id ?? null; select('preset-picker').value = shownPreset ?? ''; }
  $('preset-message').textContent = state.presetError ?? (state.preset ? '当前预设：' + state.preset.name : '选择预设后点击“应用预设”。未启用时不会加载场景或启动预设插件。');
  input('startup-enabled').checked = state.startup; $('output-url').textContent = state.outputUrl;
  const names: Record<string, string> = { connected: '已连接', disabled: '未启用', disconnected: '已停用', connecting: '连接中', reconnecting: '正在重新连接' };
  setStatus('obs-status', client.connected ? names[state.obs.state] ?? state.obs.state : '未连接', client.connected && state.obs.state === 'connected');
  setStatus('chat-status', client.connected ? names[state.chat.state] ?? state.chat.state : '未连接', client.connected && state.chat.state === 'connected');
  $('obs-current').textContent = state.obs.scene ?? '—'; $('chat-count').textContent = String(state.chat.events);
  for (const [id, error] of [['obs-error', state.obs.error], ['chat-error', state.chat.error]] as const) { $(id).hidden = !error; $(id).textContent = error ?? ''; }
  sceneOptions(); preview(); drawSceneParameters(); drawPlugins();
}
async function loadSettings(fill = false): Promise<void> {
  settings = await request<CoreSettings>('/api/settings');
  if (fill) {
    input('obs-enabled').checked = settings.obs.enabled; input('obs-url').value = settings.obs.url; input('obs-password').value = settings.obs.password;
    input('chat-enabled').checked = settings.laplace.enabled; input('chat-url').value = settings.laplace.url; input('chat-token').value = settings.laplace.token;
    input('chat-local').checked = settings.laplace.startLocalBridge;
  }
}
$('settings-form').addEventListener('input', event => {
  const target = event.target as HTMLElement; if (target.hasAttribute('data-immediate')) return;
  markDirty();
});
$('settings-form').onsubmit = async event => {
  event.preventDefault(); if (!settings) return;
  const button = $<HTMLButtonElement>('save-settings'); button.disabled = true;
  try {
    const next: CoreSettings = { ...settings,
      obs: { enabled: input('obs-enabled').checked, url: input('obs-url').value.trim(), password: input('obs-password').value },
      laplace: { enabled: input('chat-enabled').checked, url: input('chat-url').value.trim(), token: input('chat-token').value, startLocalBridge: input('chat-local').checked },
    };
    client.state = await request('/api/settings', 'PUT', next);
    await loadSettings(true); sync();
    $('save-status').textContent = '已保存，OBS 已同步'; toast('配置已保存并应用');
  } catch (error) { failure(error); }
  finally { button.disabled = false; }
};
select('scene-picker').onchange = () => void client.selectScene(select('scene-picker').value).catch(failure);
$('apply-preset').onclick = async () => {
  const button = $<HTMLButtonElement>('apply-preset'); button.disabled = true;
  try { client.state = await request('/api/presets/activate', 'POST', { id: select('preset-picker').value || null }); sync(); toast(client.state?.preset ? '预设已应用' : '预设已停用'); }
  catch (error) { failure(error); }
  finally { button.disabled = !client.connected; }
};
$('reload-presets').onclick = () => void loadPresets(true).then(() => toast('预设列表已刷新')).catch(failure);
for (const id of ['away-enabled', 'away-settings-enabled']) input(id).onchange = async () => {
  try { client.state = await client.setAway(input(id).checked); sync(); } catch (error) { sync(); failure(error); }
};
input('startup-enabled').onchange = async () => {
  try { await request('/api/startup', 'PUT', { enabled: input('startup-enabled').checked }); toast('已保存'); }
  catch (error) { input('startup-enabled').checked = client.state?.startup ?? false; failure(error); }
};
for (const [id, path] of [['reconnect-obs', '/api/obs/reconnect'], ['reconnect-chat', '/api/chat/reconnect'], ['open-obs', '/api/open/obs'], ['open-data', '/api/open/data'], ['open-plugins', '/api/open/plugins']] as const)
  $(id).onclick = () => void request(path, 'POST').catch(failure);
$('copy-url').onclick = async () => { if (!client.state) return; try { await navigator.clipboard.writeText(client.state.outputUrl); toast('地址已复制'); } catch (error) { failure(error); } };
$('reload-preview').onclick = () => { const frame = $<HTMLIFrameElement>('output-frame'); if (frame.src) frame.src = frame.src; };
function drawPlugins(): void {
  const plugins = client.state?.plugins ?? [], signature = JSON.stringify(plugins);
  if (signature === pluginSignature) return; pluginSignature = signature;
  $('plugin-empty').hidden = plugins.length > 0;
  $('plugin-list').replaceChildren(...plugins.map(plugin => {
    const row = document.createElement('div'); row.className = 'plugin-item';
    const copy = document.createElement('div'); copy.className = 'plugin-copy';
    const title = document.createElement('h3'); title.textContent = plugin.name;
    const detail = document.createElement('p'); detail.textContent = plugin.version + ' · ' + ({ running: '运行中', starting: '启动中', disabled: '已停用', error: '加载失败' }[plugin.state] ?? plugin.state); copy.append(title, detail);
    if (plugin.error) { const message = document.createElement('p'); message.className = 'error'; message.textContent = plugin.error; copy.append(message); }
    const controls = document.createElement('div'); controls.className = 'plugin-controls';
    const configure = document.createElement('button'); configure.type = 'button'; configure.className = 'text-button'; configure.textContent = '设置'; configure.onclick = () => void openPlugin(plugin).catch(failure);
    const toggle = document.createElement('input'); toggle.type = 'checkbox'; toggle.setAttribute('role', 'switch'); toggle.setAttribute('aria-label', '启用 ' + plugin.name); toggle.setAttribute('data-immediate', ''); toggle.checked = plugin.enabled;
    if (client.state?.preset?.requiredPlugins.includes(plugin.id)) { toggle.disabled = true; detail.textContent += ' · 当前预设需要'; }
    toggle.onchange = async () => { if (!settings) return; try {
      const enabledPlugins = toggle.checked ? [...settings.enabledPlugins.filter(id => id !== plugin.id), plugin.id] : settings.enabledPlugins.filter(id => id !== plugin.id);
      await request('/api/settings', 'PUT', { ...settings, enabledPlugins }); await loadSettings(); toast(toggle.checked ? '插件已启用' : '插件已停用');
    } catch (error) { failure(error); } };
    controls.append(configure, toggle); row.append(copy, controls); return row;
  }));
}
async function openPlugin(plugin: PluginInfo): Promise<void> {
  panelPlugin = plugin.id; $('plugin-panel').hidden = false; $('plugin-panel-title').textContent = plugin.name;
  const frame = $<HTMLIFrameElement>('plugin-config-frame'); frame.hidden = !plugin.settingsPage; $('plugin-json-form').hidden = Boolean(plugin.settingsPage);
  if (plugin.settingsPage) frame.src = '/user/plugins/' + encodeURIComponent(plugin.id) + '/' + plugin.settingsPage + '?streamuiPlugin=' + encodeURIComponent(plugin.id);
  else { frame.removeAttribute('src'); $<HTMLTextAreaElement>('plugin-json').value = JSON.stringify(await client.settings('plugin', plugin.id).read(), null, 2); }
}
$('close-plugin-panel').onclick = () => { $('plugin-panel').hidden = true; $<HTMLIFrameElement>('plugin-config-frame').removeAttribute('src'); };
$('plugin-json-form').onsubmit = async event => { event.preventDefault(); try { await client.settings('plugin', panelPlugin).save(JSON.parse($<HTMLTextAreaElement>('plugin-json').value)); toast('已保存'); } catch (error) { failure(error); } };
$('reload-plugins').onclick = () => void request('/api/plugins/reload', 'POST').then(() => toast('已刷新')).catch(failure);
window.addEventListener('message', event => {
  if (event.source !== $<HTMLIFrameElement>('output-frame').contentWindow || !client.state || event.origin !== new URL(client.state.outputUrl).origin || event.data?.source !== 'streamui-preview') return;
  if (event.data.error) toast(String(event.data.error), true);
});
client.onState(sync); client.on('connection', sync);
for (const kind of ['message', 'gift', 'superchat']) client.on('chat.' + kind, () => $('chat-count').textContent = String(Number($('chat-count').textContent) + 1));
client.start(); void Promise.all([loadSettings(true), loadPresets()]).then(sync).catch(failure);
window.addEventListener('pagehide', () => client.stop()); window.addEventListener('pageshow', () => client.start());
