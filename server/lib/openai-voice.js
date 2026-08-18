/**
 * صوت OpenAI — بديل جاهز لو مفتاح ElevenLabs مش متوفّر.
 *
 * الفرق الوحيد: OpenAI مبيرجّعش توقيت لكل حرف. عشان كده بنرجّع alignment=null،
 * والواجهة بتبني التوقيت من **المدة الحقيقية للصوت** بعد فك تشفيره
 * (estimateAlignment في visemes-ar.js) — فالجملة بتخلص مع الصوت بالظبط.
 */

import OpenAI from "openai";
import { stripTags } from "./tags.js";

let _c = null;
function api() {
  if (!_c) {
    if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY مش متظبط");
    _c = new OpenAI();
  }
  return _c;
}

export const NAME = "openai";

export async function synthesize(text, { signal } = {}) {
  const clean = stripTags(text);           // OpenAI مبيفهمش وسوم ElevenLabs
  const res = await api().audio.speech.create(
    {
      model: process.env.OPENAI_TTS_MODEL || "gpt-4o-mini-tts",
      voice: process.env.OPENAI_TTS_VOICE || "onyx",
      input: clean,
      response_format: "mp3",
      instructions: "تكلّم بعامية مصرية طبيعية، بإيقاع محادثة هادي وودود.",
    },
    { signal }
  );
  const buf = Buffer.from(await res.arrayBuffer());
  return { audioBase64: buf.toString("base64"), mime: "audio/mpeg", alignment: null };
}

export async function transcribe(buffer, filename = "speech.webm", mimeType = "audio/webm") {
  const res = await api().audio.transcriptions.create({
    file: new File([buffer], filename, { type: mimeType }),
    model: process.env.OPENAI_STT_MODEL || "gpt-4o-transcribe",
    language: "ar",
  });
  return (res.text || "").trim();
}
