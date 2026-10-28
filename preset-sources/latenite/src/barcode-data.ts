export const BARCODE_CONTENT = 'LATENITE';
export const BARCODE_CODEWORDS = [104, 44, 33, 52, 37, 46, 41, 52, 37, 6, 106] as const;
// Code 128 B: start, eight payload symbols, modulo-103 checksum, stop.
// Width patterns were generated and checked with ReportLab's Code128 encoder.
const PATTERNS = ['211214', '132131', '111323', '213311', '132113', '113321', '231311', '213311', '132113', '122213', '2331112'];
export const BARCODE_QUIET_ZONE = 10;
export interface BarcodeBar { x: number; width: number }
export const BARCODE_BARS: BarcodeBar[] = [];
let cursor = BARCODE_QUIET_ZONE;
for (const pattern of PATTERNS) {
  [...pattern].forEach((width, index) => {
    const modules = Number(width);
    if (index % 2 === 0) BARCODE_BARS.push({ x: cursor, width: modules });
    cursor += modules;
  });
}
export const BARCODE_WIDTH = cursor + BARCODE_QUIET_ZONE;
