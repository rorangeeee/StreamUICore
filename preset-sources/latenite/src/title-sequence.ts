/** Each language advances its own list, even when the two lists have different lengths. */
export function titleAtStep(step: number, englishCount: number, chineseCount: number): { language: 'en' | 'zh'; index: number; layerIndex: number } {
  const current = Math.max(0, Math.floor(step));
  const language = current % 2 === 0 ? 'en' : 'zh';
  const index = Math.floor(current / 2) % (language === 'en' ? englishCount : chineseCount);
  return { language, index, layerIndex: index + (language === 'zh' ? englishCount : 0) };
}
