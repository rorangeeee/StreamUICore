import { parseLayout } from './layout.ts';
import type { SavedLayout } from './layout.ts';
import { defaultStageLayout, isStageMode, PANEL_IDS } from './stage-layout.ts';
import type { StageMode } from './stage-layout.ts';

/** Only visual settings travel to the render computer; connection credentials are excluded. */
export interface TransitionSettings {
  canvas: { width: number; height: number };
  titles: { english: string[]; chinese: string[] };
  layoutProfiles: Record<StageMode, SavedLayout | null>;
}
const record = (value: unknown): Record<string, unknown> | null => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
export function transitionSettings(input?: unknown): TransitionSettings {
  const root = record(input);
  const config = record(root?.config) ?? root;
  const canvas = record(config?.canvas);
  const width = Number(canvas?.width ?? 3840), height = Number(canvas?.height ?? 2160);
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 640 || width > 7680 || height < 360 || height > 4320)
    throw new Error('画布尺寸无效。');
  const titles = record(config?.titles);
  const lines = (value: unknown, fallback: string[]) => {
    if (value === undefined) return fallback;
    if (!Array.isArray(value) || value.length < 1 || value.length > 12 || value.some(line => typeof line !== 'string' || !line.trim() || line.length > 100))
      throw new Error('标题文案无效。');
    return value.map(line => String(line).trim());
  };
  const profiles = record(config?.layoutProfiles);
  const layoutProfiles = Object.fromEntries((['21:9', '16:9'] as const).map(mode => {
    const value = config?.layoutMode === mode ? config.layout : profiles?.[mode];
    if (value === null || value === undefined) return [mode, null];
    const layout = parseLayout(value, PANEL_IDS);
    if (!layout) throw new Error(`${mode} 布局数据无效。`);
    return [mode, layout];
  })) as TransitionSettings['layoutProfiles'];
  return { canvas: { width, height }, titles: { english: lines(titles?.english, ['TITLE']), chinese: lines(titles?.chinese, ['标题']) }, layoutProfiles };
}
export function transitionLayout(settings: TransitionSettings, mode: StageMode): SavedLayout {
  if (!isStageMode(mode)) throw new Error('无效的目标布局。');
  const layout = structuredClone(settings.layoutProfiles[mode] ?? defaultStageLayout(mode));
  if (mode === '16:9') {
    const title = layout.windows['wordmark-blur-window'];
    title.x = (1 - title.width) / 2;
  }
  return layout;
}
