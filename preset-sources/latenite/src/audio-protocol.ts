export interface AudioFrame {
  frequency: Float32Array<ArrayBuffer>;
  waveform: Float32Array<ArrayBuffer>;
  sampleRate: number;
}

/** SUIA v1: magic, sample rate, frequency count, waveform count; then little-endian float32 arrays. */
export function decodeAudioFrame(buffer: ArrayBuffer): AudioFrame | null {
  if (buffer.byteLength < 16 || buffer.byteLength % 4) return null;
  const header = new DataView(buffer);
  const sampleRate = header.getUint32(4, true);
  const bins = header.getUint32(8, true);
  const samples = header.getUint32(12, true);
  if (header.getUint32(0, true) !== 0x41495553 || sampleRate < 8000 || sampleRate > 384000 || bins !== 4096 || samples !== 8192 || buffer.byteLength !== 16 + (bins + samples) * 4) return null;
  const frequency = new Float32Array(buffer, 16, bins);
  const waveform = new Float32Array(buffer, 16 + bins * 4, samples);
  if (!frequency.every(Number.isFinite) || !waveform.every(Number.isFinite)) return null;
  return { frequency, waveform, sampleRate };
}
