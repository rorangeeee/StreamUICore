export const PIXEL_FONT_FAMILIES = { en: '"StreamUI Retro Pixel", monospace', zh: '"StreamUI Pixel Chinese", sans-serif' } as const;
export type TextLanguage = keyof typeof PIXEL_FONT_FAMILIES;
export interface MixedTextRun { language: TextLanguage; text: string }

export function mixedTextRuns(text: string): MixedTextRun[] {
  const runs: MixedTextRun[] = [];
  for (const character of text) {
    const language = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\u3000-\u303f\uff00-\uffef]/u.test(character) ? 'zh' : 'en';
    if (runs.at(-1)?.language === language) runs.at(-1)!.text += character;
    else runs.push({ language, text: character });
  }
  return runs;
}
