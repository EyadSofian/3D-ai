/**
 * ElevenLabs — TTS with character-level timestamps, and Scribe STT.
 *
 * الفكرة الأساسية: /with-timestamps بيرجّع الصوت + توقيت كل حرف بالثانية.
 * دا اللي بيخلّي الـ lip sync مبني على توقيت حقيقي مش تخمين من عدد الحروف.
 */

import { stripTags } from "./tags.js";

const BASE = "https://api.elevenlabs.io/v1";

export const NAME = "elevenlabs";

function key() {
  const k = process.env.ELEVENLABS_API_KEY;
  if (!k || k.startsWith("sk_xxx")) {
    throw new Error("ELEVENLABS_API_KEY مش متظبط في .env");
  }
  return k;
}

/** يرمي error فيه تفاصيل الرد بدل "fetch failed" المبهم. */
async function fail(res, what) {
  let body = "";
  try { body = (await res.text()).slice(0, 400); } catch {}
  throw new Error(`ElevenLabs ${what} ${res.status}: ${body}`);
}

/**
 * text -> { audioBase64, mime, alignment }
 * alignment = { characters[], character_start_times_seconds[], character_end_times_seconds[] }
 */
export async function synthesize(text, { signal } = {}) {
  return synthesizeWith(text, process.env.ELEVENLABS_TTS_MODEL || "eleven_v3", signal);
}

async function synthesizeWith(text, model, signal) {
  const voice = process.env.ELEVENLABS_VOICE_ID;

  const res = await fetch(
    `${BASE}/text-to-speech/${voice}/with-timestamps?output_format=mp3_44100_128`,
    {
      method: "POST",
      signal,
      headers: { "xi-api-key": key(), "Content-Type": "application/json" },
      body: JSON.stringify({
        text,
        model_id: model,
        language_code: "ar",
        voice_settings: {
          stability: 0.45,
          similarity_boost: 0.8,
          style: 0.15,
          use_speaker_boost: true,
        },
      }),
    }
  );
  if (!res.ok) {
    // لو الموديل المطلوب مش متاح للحساب، جرّب الموديل المستقر مرة واحدة
    if (res.status === 400 || res.status === 404) {
      const body = await res.text().catch(() => "");
      if (/model/i.test(body) && model !== "eleven_multilingual_v2") {
        console.warn(`[tts] ${model} مش متاح — بنرجع لـ eleven_multilingual_v2`);
        return synthesizeWith(text, "eleven_multilingual_v2", signal);
      }
      throw new Error(`ElevenLabs TTS ${res.status}: ${body.slice(0, 300)}`);
    }
    await fail(res, "TTS");
  }

  const data = await res.json();
  // normalized_alignment بيوصف النص بعد التطبيع (الأرقام بتتفك لكلمات) —
  // وهو اللي بيتنطق فعلًا، فهو الأدق للـ visemes.
  const alignment = data.normalized_alignment || data.alignment || null;
  // بعض الموديلات (زي v3) ممكن ترجّع صوت من غير توقيتات — مش خطأ.
  // الواجهة ساعتها بتبني التوقيت من مدة الصوت الحقيقية.
  return {
    audioBase64: data.audio_base64,
    mime: "audio/mpeg",
    alignment: alignment?.characters?.length ? alignment : null,
  };
}

/** audio Buffer -> نص عربي */
export async function transcribe(buffer, filename = "speech.webm", mimeType = "audio/webm") {
  const form = new FormData();
  form.append("file", new Blob([buffer], { type: mimeType }), filename);
  form.append("model_id", process.env.ELEVENLABS_STT_MODEL || "scribe_v1");
  form.append("language_code", "ara");
  form.append("tag_audio_events", "false");
  form.append("diarize", "false");

  const res = await fetch(`${BASE}/speech-to-text`, {
    method: "POST",
    headers: { "xi-api-key": key() },
    body: form,
  });
  if (!res.ok) await fail(res, "STT");

  const data = await res.json();
  return (data.text || "").trim();
}
