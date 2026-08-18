/**
 * اختيار مزوّد الصوت.
 *
 *   VOICE_PROVIDER=elevenlabs -> أحلى صوت عربي + وسوم أداء ([يهمس]، [يضحك])
 *                                + توقيت لكل حرف => أدق lip sync ممكن
 *   VOICE_PROVIDER=openai     -> شغّال على نفس مفتاح الموديل، من غير توقيتات
 *   مش متحدّد                  -> ElevenLabs لو مفتاحه موجود، وإلا OpenAI
 */

const wanted = (process.env.VOICE_PROVIDER || "").toLowerCase();
const hasEleven = !!process.env.ELEVENLABS_API_KEY?.startsWith("sk_")
  && !process.env.ELEVENLABS_API_KEY.startsWith("sk_xxx");

export const VOICE = wanted === "elevenlabs" || wanted === "openai"
  ? wanted
  : hasEleven ? "elevenlabs" : "openai";

const mod = await (VOICE === "elevenlabs"
  ? import("./elevenlabs.js")
  : import("./openai-voice.js"));

export const synthesize = mod.synthesize;
export const transcribe = mod.transcribe;
export const hasVoiceKey = VOICE === "elevenlabs" ? hasEleven : !!process.env.OPENAI_API_KEY;
/** ElevenLabs بس هو اللي بيدي توقيت لكل حرف. */
export const hasTimestamps = VOICE === "elevenlabs";
