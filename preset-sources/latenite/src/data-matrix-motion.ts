export const MATRIX_STEP = 60;
export const MATRIX_IDLE = 1600;
export const MATRIX_HOLD = 1000;

export interface MatrixFrame { phase: 'idle' | 'fill' | 'hold' | 'restore'; diagonal: number; highlighted: boolean }

/** Coordinates use the lower-left origin from the animation specification. */
export function matrixDiagonal(size: number, diagonal: number): { x: number; y: number }[] {
  const cells = [];
  for (let x = 0; x < size; x++) {
    const y = diagonal - x;
    if (y >= 0 && y < size) cells.push({ x, y });
  }
  return cells;
}

export function sampleMatrixSweep(time: number, size: number): Omit<MatrixFrame, 'highlighted'> {
  const last = 2 * (size - 1), sweep = last * MATRIX_STEP;
  const elapsed = Math.max(0, time) % (MATRIX_IDLE + 2 * sweep + MATRIX_HOLD);
  if (elapsed < MATRIX_IDLE) return { phase: 'idle', diagonal: -1 };
  if (elapsed < MATRIX_IDLE + sweep) return { phase: 'fill', diagonal: Math.floor((elapsed - MATRIX_IDLE) / MATRIX_STEP) };
  if (elapsed < MATRIX_IDLE + sweep + MATRIX_HOLD) return { phase: 'hold', diagonal: last };
  return { phase: 'restore', diagonal: Math.floor((elapsed - MATRIX_IDLE - sweep - MATRIX_HOLD) / MATRIX_STEP) };
}

export function matrixDiagonalFilled(frame: Omit<MatrixFrame, 'highlighted'>, diagonal: number): boolean {
  return frame.phase === 'hold' || (frame.phase === 'fill' && diagonal <= frame.diagonal) || (frame.phase === 'restore' && diagonal > frame.diagonal);
}

/** The rare color glitch is independent of the diagonal fill and never changes its progress. */
export class DataMatrixMotion {
  private nextGlitch: number;
  private glitchStart = -Infinity;
  private size: number;
  private random: () => number;
  constructor(size: number, random: () => number = Math.random) {
    this.size = size; this.random = random;
    this.nextGlitch = 7000 + this.random() * 8000;
  }
  sample(time: number): MatrixFrame {
    if (time >= this.nextGlitch) {
      this.glitchStart = time; this.nextGlitch = time + 240 + 12000 + this.random() * 14000;
    }
    const flashTime = time - this.glitchStart;
    const highlighted = (flashTime >= 0 && flashTime < 80) || (flashTime >= 160 && flashTime < 240);
    return { ...sampleMatrixSweep(time, this.size), highlighted };
  }
}
