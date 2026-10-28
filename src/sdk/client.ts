import type { PublicState } from './contracts.ts';
let enteredSceneId: string | null = null;
let enteredPresetId: string | null = null;
export function getSceneContext() {
  const params = new URLSearchParams(location.search);
  return { sceneId: enteredSceneId ?? params.get('streamuiScene'), presetId: enteredPresetId ?? params.get('streamuiPreset'),
    pluginId: params.get('streamuiPlugin'), preview: params.has('streamuiPreview') };
}

export async function request<T>(path: string, method = 'GET', body?: unknown, baseUrl = location.origin): Promise<T> {
  const response = await fetch(new URL(path, baseUrl), {
    method, headers: { 'Content-Type': 'application/json', 'X-StreamUI-Request': '1' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => null) as { error?: string } | null;
    throw new Error(error?.error ?? '请求失败 (' + response.status + ')');
  }
  return response.headers.get('content-type')?.includes('application/json') ? response.json() as Promise<T> : undefined as T;
}
const socketUrl = (path: string, base: string) => {
  const url = new URL(path, base); url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'; return url.href;
};
export class StreamUIClient extends EventTarget {
  state: PublicState | null = null;
  connected = false;
  private socket: WebSocket | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private active = false;
  private binarySubscriptions = new Set<() => void>();
  private lifecycle = (event: MessageEvent) => {
    if (event.source !== parent || event.origin !== location.origin || event.data?.source !== 'streamui' || !['scene.enter', 'scene.leave'].includes(event.data?.topic)) return;
    if (event.data.topic === 'scene.enter') { enteredSceneId = event.data.data?.sceneId ?? null; enteredPresetId = event.data.data?.presetId ?? null; }
    this.emit(event.data.topic, event.data.data);
  };
  readonly baseUrl: string;
  constructor(baseUrl = location.origin) { super(); this.baseUrl = baseUrl; }
  on<T = unknown>(topic: string, callback: (data: T) => void): () => void {
    const listener = (event: Event) => callback((event as CustomEvent<T>).detail);
    this.addEventListener(topic, listener); return () => this.removeEventListener(topic, listener);
  }
  onState(callback: (state: PublicState) => void): () => void {
    const off = this.on<PublicState>('state', callback); if (this.state) callback(this.state); return off;
  }
  private emit(topic: string, data: unknown): void { this.dispatchEvent(new CustomEvent(topic, { detail: data })); }
  start(): void {
    if (this.active) return; this.active = true;
    window.addEventListener('message', this.lifecycle); this.connect();
  }
  private connect(): void {
    if (!this.active || this.socket) return;
    const socket = new WebSocket(socketUrl('/ws/events', this.baseUrl)); this.socket = socket;
    socket.onopen = () => { this.connected = true; this.emit('connection', true); };
    socket.onmessage = event => {
      let message: { type: string; data: PublicState; topic?: string };
      try { message = JSON.parse(event.data as string); } catch { return; }
      if (message.type === 'state') {
        const previous = this.state; this.state = message.data; this.emit('state', this.state);
        if (this.state.obs.scene && previous?.obs.scene !== this.state.obs.scene) this.emit('obs.sceneChanged', { name: this.state.obs.scene });
        if (previous?.scene.revision !== this.state.scene.revision) this.emit('scene.changed', this.state.scene);
        if (previous?.scene.away !== this.state.scene.away) this.emit('away.changed', { enabled: this.state.scene.away });
      } else if (message.type === 'event' && message.topic) this.emit(message.topic, message.data);
    };
    socket.onclose = () => {
      if (this.socket !== socket) return;
      this.socket = null; this.connected = false; this.emit('connection', false);
      if (this.active) this.timer = setTimeout(() => this.connect(), 1500);
    };
    socket.onerror = () => socket.close();
  }
  stop(): void {
    this.active = false; for (const off of [...this.binarySubscriptions]) off(); if (this.timer) clearTimeout(this.timer); this.timer = null;
    const socket = this.socket; this.socket = null; socket?.close(); this.connected = false;
    window.removeEventListener('message', this.lifecycle);
  }
  selectScene(id: string): Promise<PublicState> { return request('/api/actions/scene', 'POST', { id }, this.baseUrl); }
  setAway(enabled: boolean): Promise<PublicState> { return request('/api/actions/away', 'POST', { enabled }, this.baseUrl); }
  settings(scope: 'scene' | 'plugin' | 'preset', id: string) {
    const path = '/api/' + ({ scene: 'scenes', plugin: 'plugins', preset: 'presets' }[scope]) + '/' + encodeURIComponent(id) + '/settings';
    return {
      read: <T extends object = Record<string, unknown>>() => request<T>(path, 'GET', undefined, this.baseUrl),
      save: (value: object) => request<void>(path, 'PUT', value, this.baseUrl),
    };
  }
  binary(pluginId: string, topic: string, callback: (data: ArrayBuffer) => void): () => void {
    let socket: WebSocket | null = null, retry: ReturnType<typeof setTimeout> | null = null, active = true;
    const connect = () => {
      if (!active) return;
      socket = new WebSocket(socketUrl('/ws/plugins/' + encodeURIComponent(pluginId) + '/' + encodeURIComponent(topic), this.baseUrl)); socket.binaryType = 'arraybuffer';
      socket.onmessage = event => { if (event.data instanceof ArrayBuffer) callback(event.data); };
      socket.onclose = () => { if (active) retry = setTimeout(connect, 1500); };
      socket.onerror = () => socket?.close();
    };
    connect();
    const off = () => { active = false; if (retry) clearTimeout(retry); socket?.close(); this.binarySubscriptions.delete(off); };
    this.binarySubscriptions.add(off); return off;
  }
}
export const createClient = (options: { baseUrl?: string } = {}) => new StreamUIClient(options.baseUrl);
