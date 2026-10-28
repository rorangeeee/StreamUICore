import { decodeAudioFrame } from './audio-protocol.ts';
import type { AudioFrame } from './audio-protocol.ts';
import { host, socketUrl } from './host-client.ts';
export type { AudioFrame } from './audio-protocol.ts';
export type AudioState = 'idle' | 'requesting' | 'live' | 'error';

/** Receives host analysis frames. No browser capture, audio permission, or playback is needed. */
export class HostAudio extends EventTarget {
  state: AudioState = 'idle';
  error: string | null = null;
  private frame: AudioFrame | null = null;
  private socket: WebSocket | null = null;
  private retry: ReturnType<typeof setTimeout> | null = null;
  private watchdog: ReturnType<typeof setInterval> | null = null;
  private lastFrame = 0;
  private active = false;
  private stateChanged = () => {
    if (!host.state) return;
    if (host.state?.audio.state === 'error') this.setState('error', host.state.audio.error);
    else if (!host.state?.config.audio.enabled) { this.frame = null; this.setState('idle'); }
    else if (host.state.audio.state !== 'live') this.setState('requesting');
  };
  start(): void {
    if (this.active) return;
    this.active = true;
    host.addEventListener('state', this.stateChanged);
    host.start(); this.connect();
    this.watchdog = setInterval(() => {
      if (this.state === 'live' && Date.now() - this.lastFrame > 2000) {
        this.frame = null; this.setState('requesting', '等待 host 音频数据…');
        this.socket?.close();
      }
    }, 1000);
  }
  private connect(): void {
    if (!this.active || this.socket) return;
    this.setState('requesting');
    const socket = new WebSocket(socketUrl('/ws/audio'));
    socket.binaryType = 'arraybuffer'; this.socket = socket;
    socket.onopen = this.stateChanged;
    socket.onmessage = (event: MessageEvent<ArrayBuffer>) => {
      if (!(event.data instanceof ArrayBuffer)) return;
      const frame = decodeAudioFrame(event.data);
      if (!frame) return;
      this.frame = frame; this.lastFrame = Date.now(); this.setState('live');
    };
    socket.onclose = () => {
      if (this.socket !== socket) return;
      this.socket = null; this.frame = null;
      this.setState('requesting', '等待 StreamUI Host 连接…');
      if (this.active) this.retry = setTimeout(() => { this.retry = null; this.connect(); }, 1500);
    };
    socket.onerror = () => socket.close();
  }
  read(): AudioFrame | null { return this.state === 'live' ? this.frame : null; }
  stop(): void {
    this.active = false;
    host.removeEventListener('state', this.stateChanged);
    if (this.retry) clearTimeout(this.retry);
    if (this.watchdog) clearInterval(this.watchdog);
    this.retry = this.watchdog = null;
    const socket = this.socket; this.socket = null; socket?.close();
    this.frame = null; this.setState('idle');
  }
  private setState(state: AudioState, error: string | null = null): void {
    if (this.state === state && this.error === error) return;
    this.state = state; this.error = error;
    this.dispatchEvent(new Event('statechange'));
  }
}
