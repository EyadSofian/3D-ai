/**
 * وسوم الأداء بتاعة ElevenLabs — [يهمس] [يضحك] [excited] …
 * دي تعليمات للصوت مش كلام بيتنطق، فبتتشال قبل أي حساب للشفايف
 * وقبل ما تتعرض على الشاشة.
 */
export const AUDIO_TAG = /\[[^\]\n]{1,40}\]/g;

export function stripTags(text) {
  return (text || "").replace(AUDIO_TAG, " ").replace(/\s{2,}/g, " ").trim();
}
