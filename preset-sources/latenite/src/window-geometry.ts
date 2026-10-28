export interface WindowRect { x: number; y: number; width: number; height: number; angle: number }
export interface ResizeEdges { left?: boolean; right?: boolean; top?: boolean; bottom?: boolean }
export const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
export const normalizeAngle = (angle: number) => ((angle + 180) % 360 + 360) % 360 - 180;

export function localPoint(rect: WindowRect, x: number, y: number): { x: number; y: number } {
  const angle = rect.angle * Math.PI / 180;
  const dx = x - rect.x - rect.width / 2;
  const dy = y - rect.y - rect.height / 2;
  return { x: dx * Math.cos(angle) + dy * Math.sin(angle) + rect.width / 2, y: -dx * Math.sin(angle) + dy * Math.cos(angle) + rect.height / 2 };
}

export function resizeRect(rect: WindowRect, edges: ResizeEdges, dx: number, dy: number, minWidth = 220, minHeight = 120): WindowRect {
  const angle = rect.angle * Math.PI / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const localX = dx * cos + dy * sin;
  const localY = -dx * sin + dy * cos;
  const width = Math.max(minWidth, rect.width + (edges.right ? localX : edges.left ? -localX : 0));
  const height = Math.max(minHeight, rect.height + (edges.bottom ? localY : edges.top ? -localY : 0));
  const shiftX = (width - rect.width) / 2 * (edges.left ? -1 : edges.right ? 1 : 0);
  const shiftY = (height - rect.height) / 2 * (edges.top ? -1 : edges.bottom ? 1 : 0);
  return {
    x: rect.x + (rect.width - width) / 2 + shiftX * cos - shiftY * sin,
    y: rect.y + (rect.height - height) / 2 + shiftX * sin + shiftY * cos,
    width, height, angle: rect.angle,
  };
}

export function fitRect(rect: WindowRect, viewportWidth: number, viewportHeight: number, minWidth = 220, minHeight = 120): void {
  const centerX = rect.x + rect.width / 2;
  const centerY = rect.y + rect.height / 2;
  rect.width = clamp(rect.width, Math.min(minWidth, viewportWidth), viewportWidth);
  rect.height = clamp(rect.height, Math.min(minHeight, viewportHeight), viewportHeight);
  const angle = rect.angle * Math.PI / 180;
  const halfWidth = (Math.abs(Math.cos(angle)) * rect.width + Math.abs(Math.sin(angle)) * rect.height) / 2;
  const halfHeight = (Math.abs(Math.sin(angle)) * rect.width + Math.abs(Math.cos(angle)) * rect.height) / 2;
  // Oversized rotated bounds stay centered so the window remains reachable.
  rect.x = (halfWidth * 2 > viewportWidth ? viewportWidth / 2 : clamp(centerX, halfWidth, viewportWidth - halfWidth)) - rect.width / 2;
  rect.y = (halfHeight * 2 > viewportHeight ? viewportHeight / 2 : clamp(centerY, halfHeight, viewportHeight - halfHeight)) - rect.height / 2;
}
