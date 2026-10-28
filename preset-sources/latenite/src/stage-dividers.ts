import type { WindowRect } from './window-geometry.ts';

function edge(rect: WindowRect, x1: number, y1: number, x2: number, y2: number): string {
  const radians = rect.angle * Math.PI / 180;
  const cos = Math.cos(radians), sin = Math.sin(radians);
  const point = (x: number, y: number): string => {
    const dx = x - rect.width / 2, dy = y - rect.height / 2;
    const globalX = rect.x + rect.width / 2 + dx * cos - dy * sin;
    const globalY = rect.y + rect.height / 2 + dx * sin + dy * cos;
    return `${Math.round(globalX * 10000) / 10000} ${Math.round(globalY * 10000) / 10000}`;
  };
  return `M${point(x1, y1)} L${point(x2, y2)}`;
}

/** Four open partitions, independent of panel inversion and panel backgrounds. */
export function stageDividerPaths(stream: WindowRect, spectrum: WindowRect, waveform: WindowRect): Record<string, string> {
  return {
    'main-top': edge(stream, 0, 0, stream.width, 0),
    'main-bottom': edge(stream, 0, stream.height, stream.width, stream.height),
    'audio-split': edge(waveform, 0, 0, 0, waveform.height),
    'audio-bottom': `${edge(spectrum, 0, spectrum.height, spectrum.width, spectrum.height)} ${edge(waveform, 0, waveform.height, waveform.width, waveform.height)}`,
  };
}
