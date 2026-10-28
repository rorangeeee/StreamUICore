import type { SavedLayout } from './layout.ts';

export const STAGE_WIDTH = 3840;
export const STAGE_HEIGHT = 2160;
export const STAGE_LAYOUT_VERSION = 3;
export const STAGE_MODES = ['21:9', '16:9'] as const;
export type StageMode = typeof STAGE_MODES[number];
export const isStageMode = (value: unknown): value is StageMode => STAGE_MODES.includes(value as StageMode);
export const PANEL_IDS = ['stream-window', 'spectrogram-window', 'waveform-window', 'chat-window', 'wordmark-window', 'wordmark-blur-window'];

/** Visible coordinates from STREAMUI_v2_21-9.svg, with shared panel edges aligned. */
export function defaultStageLayout(mode: StageMode = '21:9'): SavedLayout {
  const rectangles = mode === '16:9' ? [
    [0, 0, 3840, 2160],
    [0, 1883.99, 2972.7, 218.615],
    [2972.7, 1883.99, 867.3, 218.615],
    [3313.5, 138, 504, 1884],
    [0, 299.669182, 190.318, 1560.663],
    [(STAGE_WIDTH - 710) / 2, 0, 710, 276.2784],
  ] : [
    [0, 276.2784, 3840, 1607.7116],
    [0, 1883.99, 2972.7, 218.615],
    [2972.7, 1883.99, 867.3, 218.615],
    [3273.54208, 0, 566.45792, 276.2784],
    [2265.558, 0, 940.99008, 276.2784],
    [0, 0, 2265.558, 276.2784],
  ];
  return {
    order: [...PANEL_IDS],
    windows: Object.fromEntries(PANEL_IDS.map((id, index) => {
      const [x, y, width, height] = rectangles[index];
      return [id, { x: x / STAGE_WIDTH, y: y / STAGE_HEIGHT, width: width / STAGE_WIDTH, height: height / STAGE_HEIGHT, angle: 0, inverted: id === 'waveform-window' }];
    })),
  };
}
