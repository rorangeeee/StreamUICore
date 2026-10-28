export interface SceneSlot {
  id: string; name: string; entry: string; obsScene: string;
  width: number; height: number; transition: string; settingsPage: string;
  presetId?: string; sceneId?: string; view?: string; runtimeGroup?: string;
}
export interface PluginInfo {
  id: string; name: string; version: string; capabilities: string[];
  settingsPage: string; enabled: boolean; state: string; error: string | null;
}
export interface SceneState { selectedId: string | null; activeId: string | null; away: boolean; awaySceneId: string | null; revision: number; reason: string }
export interface ServiceStatus { state: string; error: string | null }
export interface PublicState {
  apiVersion: 1; scenes: SceneSlot[]; scene: SceneState;
  preset?: { id: string; name: string; version: string; description: string; settingsPage: string; requiredPlugins: string[] } | null;
  presetError?: string | null;
  obs: ServiceStatus & { scene: string | null; detail: string | null; transition?: { id: string; name: string; startedAt: number; phase: string } | null };
  chat: ServiceStatus & { events: number; lastEventAt: string | null; localBridge: boolean };
  plugins: PluginInfo[]; outputUrl: string; configUrl: string; startup: boolean;
}
export interface PresetInfo {
  id: string; name: string; version: string; description: string; sceneCount: number;
  plugins: { id: string; minimumVersion: string; required: boolean }[]; available: boolean; error: string | null;
}
export interface CoreSettings {
  obs: { enabled: boolean; url: string; password: string };
  laplace: { enabled: boolean; url: string; token: string; startLocalBridge: boolean };
  enabledPlugins: string[];
}
export interface ChatMessage {
  id: string | null; kind: 'message' | 'gift' | 'superchat'; platform: string; timestamp: number;
  user: { id: string; name: string; level: number | null; medalName: string | null; medalLevel: number | null };
  text: string; gift: { name: string; count: number | null } | null; payment: { amount: number | null; currency: string } | null;
}
export interface TransitionContext { container: HTMLElement; from: SceneSlot | null; to: SceneSlot; signal: AbortSignal; covered(): void }
export interface TransitionModule { play(context: TransitionContext): Promise<void> }
