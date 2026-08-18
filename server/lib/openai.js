/**
 * OpenAI — نفس واجهة claude.js بالظبط، عشان الاتنين يتبدّلوا من غير ما
 * أي حاجة تانية في المشروع تتغيّر.
 */

import OpenAI from "openai";

const MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

// كسول عن قصد: الـ SDK بيرمي error وقت الإنشاء لو مفيش مفتاح،
// وده كان بيمنع السيرفر إنه يقوم أصلاً ويوريك صفحة التشخيص.
let _client = null;
function api() {
  if (!_client) {
    if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY مش متظبط في .env");
    _client = new OpenAI();
  }
  return _client;
}

export const MODEL_ID = MODEL;

export async function streamReply(messages, system, splitter, { onDelta, onSentence, signal } = {}) {
  let reply = "";

  const stream = await api().chat.completions.create(
    {
      model: MODEL,
      stream: true,
      max_completion_tokens: 700,
      messages: [{ role: "system", content: system }, ...messages],
    },
    { signal }
  );

  for await (const part of stream) {
    const piece = part.choices?.[0]?.delta?.content;
    if (!piece) continue;
    reply += piece;
    onDelta?.(piece);
    for (const s of splitter.push(piece)) onSentence?.(s);
  }

  return { reply: reply.trim(), stopReason: null };
}
