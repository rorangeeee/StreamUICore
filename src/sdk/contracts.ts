export interface SceneSlot {
  id: string; name: string; entry: string; width: number; height: number;
  transition: string; settingsPage: string; defaults: string;
  presetId?: string; sceneId?: string; view?: string; runtimeGroup?: string;
  role?: 'scene' | 'overlay';
}
export interface PluginInfo {
  id: string; name: string; version: string; capabilities: string[];
  settingsPage: string; enabled: boolean; state: string; error: string | null;
  topics: Record<string, unknown>;
}
export interface ScenePlayback { id: string; startedAt: number; animate: boolean }
export interface SceneState { activeId: string | null; previousId: string | null; revision: number; playback: ScenePlayback | null }
export interface PublicState {
  apiVersion: 2; scenes: SceneSlot[]; scene: SceneState; preview: boolean;
  preset: { id: string; name: string; version: string; description: string; settingsPage: string; sidebarPage: string; requiredPlugins: string[] } | null;
  presetError: string | null; plugins: PluginInfo[]; outputUrl: string; configUrl: string; startup: boolean;
}
export interface PresetInfo {
  id: string; name: string; version: string; description: string; sceneCount: number;
  plugins: { id: string; minimumVersion: string; required: boolean }[]; available: boolean; error: string | null;
}
export interface CoreSettings { enabledPlugins: string[] }
export interface SceneSelection { animate?: boolean; cue?: string; startedAt?: number }
export interface TransitionContext { container: HTMLElement; from: SceneSlot | null; to: SceneSlot; signal: AbortSignal; covered(): void }
export interface TransitionModule { play(context: TransitionContext): Promise<void> }
