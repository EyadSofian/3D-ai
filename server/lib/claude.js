/**
 * Claude — streaming reply, مقطوع لجمل عشان الـ TTS يبدأ قبل ما الرد يخلص.
 *
 * ملاحظات مهمة على Claude Opus 5:
 *  • الـ thinking شغال by default (مش زي Opus 4.8). سايبينه شغال مع effort:"low"
 *    لأن تعطيله على الموديل دا ليه مشاكل معروفة (tool calls كنص + تسريب <thinking>).
 *  • max_tokens بيتقسم بين الـ thinking والرد — فلازم يبقى فيه هامش.
 *  • Opus 5 بيكتب ردود طويلة by default، و effort مش هو اللي بيقصّرها — الـ prompt هو.
 *  • بنفعّل server-side fallbacks عشان لو الـ classifiers رفضت الطلب ميقفش الأفاتار.
 */

import Anthropic from "@anthropic-ai/sdk";

let _client = null;
function api() {
  if (!_client) {
    if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY مش متظبط في .env");
    _client = new Anthropic();
  }
  return _client;
}

const MODEL = process.env.ANTHROPIC_MODEL || "claude-opus-5";
const FALLBACK_BETA = "server-side-fallback-2026-07-01";

let fallbacksSupported = true; // بيتقفل لوحده لو الـ API رفض الـ beta

function buildParams(messages, system) {
  return {
    model: MODEL,
    max_tokens: 4096,
    system,
    messages,
    // effort منخفض = زمن استجابة أقل، وهو المناسب لمحادثة صوتية.
    output_config: { effort: "low" },
  };
}

/**
 * onDelta(text)    -> كل حتة نص جاية من الموديل (للترجمة المكتوبة على الشاشة)
 * onSentence(text) -> جملة كاملة جاهزة تتبعت للـ TTS
 * بيرجّع { reply, stopReason }
 */
export async function streamReply(messages, system, splitter, { onDelta, onSentence, signal } = {}) {
  let reply = "";

  const run = async (withFallbacks) => {
    const params = buildParams(messages, system);
    const stream = withFallbacks
      ? api().beta.messages.stream(
          { ...params, betas: [FALLBACK_BETA], fallbacks: "default" },
          { signal }
        )
      : api().messages.stream(params, { signal });

    for await (const ev of stream) {
      if (ev.type !== "content_block_delta" || ev.delta.type !== "text_delta") continue;
      const piece = ev.delta.text;
      reply += piece;
      onDelta?.(piece);
      for (const s of splitter.push(piece)) onSentence?.(s);
    }
    return stream.finalMessage();
  };

  let final;
  try {
    final = await run(fallbacksSupported);
  } catch (err) {
    // لو الـ SDK/الحساب مش شايف الـ beta، اشتغل من غيره بدل ما نقع.
    const msg = String(err?.message || "");
    if (fallbacksSupported && /fallback|beta/i.test(msg) && err?.status === 400) {
      console.warn("[claude] server-side fallbacks مش متاح — بنكمل من غيره:", msg);
      fallbacksSupported = false;
      reply = "";
      final = await run(false);
    } else {
      throw err;
    }
  }

  for (const s of splitter.flush()) onSentence?.(s);
  return { reply: reply.trim(), stopReason: final?.stop_reason ?? null };
}

export const MODEL_ID = MODEL;
