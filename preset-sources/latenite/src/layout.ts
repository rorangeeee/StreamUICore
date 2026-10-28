import type { WindowRect } from './window-geometry.ts';

export interface WindowState extends WindowRect { inverted: boolean }
export interface SavedLayout { order: string[]; windows: Record<string, WindowState> }

export function parseLayout(input: unknown, ids: string[]): SavedLayout | null {
  if (!input || typeof input !== 'object') return null;
  const layout = input as SavedLayout;
  if (!Array.isArray(layout.order) || layout.order.length !== ids.length || new Set(layout.order).size !== ids.length || layout.order.some(id => !ids.includes(id))) return null;
  if (!layout.windows || Object.keys(layout.windows).length !== ids.length) return null;
  for (const id of ids) {
    const r = layout.windows[id];
    if (!r || ![r.x, r.y, r.width, r.height, r.angle].every(Number.isFinite) || typeof r.inverted !== 'boolean'
      || Math.abs(r.x) > 2 || Math.abs(r.y) > 2 || r.width <= 0 || r.width > 2 || r.height <= 0 || r.height > 2 || Math.abs(r.angle) > 360) return null;
  }
  return layout;
}
