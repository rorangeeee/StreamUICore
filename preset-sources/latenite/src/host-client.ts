import type { SavedLayout } from './layout.ts';
import type { NowPlayingTrack } from './now-playing-data.ts';
import type { StageMode } from './stage-layout.ts';
import type { PublicState, ChatMessage } from '../../../src/sdk/contracts.ts';
const sdkUrl = '/sdk/streamui.js';
const { createClient, getSceneContext, request } = await import(/* @vite-ignore */ sdkUrl) as typeof import('../../../src/sdk/index.ts');
export interface ObsSettings { url: string; password: string; scene21: string; scene16: string }
export interface AwaySettings { enabled: boolean; text1: string; text2: string; overlayOpacity: number }
export interface HostConfig {
  audio: { enabled: boolean; deviceId: string; channel: number; gain: number };
  laplace: { enabled: boolean; url: string; token: string; startLocalBridge: boolean };
  canvas: { width: number; height: number }; layout: SavedLayout | null;
  titles: { english: string[]; chinese: string[] }; layoutVersion: number; layoutMode: StageMode;
  layoutProfiles: Partial<Record<StageMode, SavedLayout | null>>; obs: ObsSettings; away?: AwaySettings;
}
export interface ObsTransition { id: string; name: string; startedAt: number; phase: 'started' | 'ended' | 'video-ended' }
export interface HostState {
  nowPlaying?: NowPlayingTrack;
  obs?: { state: string; scene: string | null; error: string | null; detail?: string | null; transition?: ObsTransition | null };
  config: HostConfig;
  audio: { state: string; error: string | null; deviceId: string | null; sampleRate: number; channels: number; deviceSampleRate: number; frameRate: number };
  laplace: { state: string; error: string | null; localBridge: boolean; events: number; lastEventAt: string | null };
  obsUrl: string; configUrl: string; startup: boolean;
}
type VisualSettings = Pick<HostConfig, 'canvas' | 'titles' | 'layoutVersion' | 'layoutMode' | 'layout' | 'layoutProfiles' | 'away'>;
/** Preset-owned adapter; the Core has no LATENITE layout schema. */
export class HostConnection extends EventTarget {
  state: HostState | null = null;
  connected = false;
  private client = createClient();
  private active = false;
  private core: PublicState | null = null;
  private visuals: VisualSettings | null = null;
  private loading = false;
  private audio: HostState['audio'] = { state: 'connecting', error: null, deviceId: null, sampleRate: 48000, channels: 2, deviceSampleRate: 48000, frameRate: 0 };
  private track: NowPlayingTrack | undefined;
  private readonly presetId = getSceneContext().presetId ?? 'latenite';
  constructor() {
    super();
    this.client.onState(state => { this.core = state; this.sync(); });
    this.client.on<boolean>('connection', connected => { this.connected = connected; this.dispatchEvent(new Event('connectionchange')); if (connected) void this.readSettings(); });
    this.client.on('scene.enter', () => this.sync());
    this.client.on<{ id: string }>('preset.settingsChanged', ({ id }) => { if (id === this.presetId) void this.readSettings(); });
    this.client.on<{ audio: HostState['audio'] }>('plugin.desktop-audio.status', value => { this.audio = value.audio; this.sync(); });
    this.client.on<NowPlayingTrack>('plugin.system-media.track', value => { this.track = value; this.sync(); });
    for (const kind of ['message', 'gift', 'superchat']) this.client.on<ChatMessage>('chat.' + kind, value => {
      const numericId = Number(value.user.id);
      this.dispatchEvent(new CustomEvent('chat', { detail: { type: value.kind, origin: value.platform, stableKey: value.id,
        uid: Number.isSafeInteger(numericId) ? numericId : 0, username: value.user.name, userLvl: value.user.level,
        timestampNormalized: value.timestamp, message: value.text, giftName: value.gift?.name, num: value.gift?.count,
        priceNormalized: value.payment?.amount, medal: { name: value.user.medalName, level: value.user.medalLevel } } }));
    });
  }
  private async readSettings(): Promise<void> {
    if (this.loading) return; this.loading = true;
    try { this.visuals = await this.client.settings('preset', this.presetId).read<VisualSettings>(); this.sync(); }
    catch (error) { console.error('LATENITE settings:', error); }
    finally { this.loading = false; }
  }
  private sync(): void {
    if (!this.core || !this.visuals) return;
    const core = this.core, visuals = this.visuals, context = getSceneContext();
    const displayed = core.scenes.find(s => s.id === context.sceneId) ?? core.scenes.find(s => s.id === core.scene.activeId);
    const selected = core.scenes.find(s => s.id === core.scene.selectedId);
    const view = displayed?.view === 'away' ? selected?.view : displayed?.view;
    const mode: StageMode = view === '16:9' ? '16:9' : '21:9';
    const enabled = core.plugins.some(p => p.id === 'desktop-audio' && p.enabled);
    this.state = {
      config: { ...visuals, layoutMode: mode, layout: visuals.layoutProfiles[mode] ?? null,
        audio: { enabled, deviceId: 'default', channel: -1, gain: 1 },
        laplace: { enabled: core.chat.state !== 'disconnected', url: '', token: '', startLocalBridge: false },
        obs: { url: '', password: '', scene21: '', scene16: '' },
        away: { text1: '暂停一下，马上回来', text2: '', overlayOpacity: .5, ...visuals.away, enabled: core.scene.away } },
      audio: this.audio, nowPlaying: this.track, obs: core.obs as HostState['obs'], laplace: core.chat,
      obsUrl: core.outputUrl, configUrl: core.configUrl, startup: core.startup,
    };
    this.dispatchEvent(new CustomEvent('state', { detail: this.state }));
  }
  start(): void { if (this.active) return; this.active = true; this.client.start(); }
  stop(): void { this.active = false; this.client.stop(); this.connected = false; }
  setOffline(offline: boolean): void { if (offline) this.stop(); }
}
export const host = new HostConnection();
export function socketUrl(path: string): string {
  const url = new URL(path === '/ws/audio' ? '/ws/plugins/desktop-audio/frames' : path, location.origin);
  url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'; return url.href;
}
export function api<T = void>(path: string, method = 'GET', body?: unknown): Promise<T> { return request<T>(path, method, body); }
