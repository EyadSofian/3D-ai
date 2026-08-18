/**
 * اختيار مزوّد الموديل.
 *
 *   LLM_PROVIDER=openai     -> OpenAI (gpt-…)
 *   LLM_PROVIDER=anthropic  -> Claude
 *   مش متحدّد               -> اللي مفتاحه موجود (OpenAI الأول)
 *
 * الاتنين بيرجّعوا نفس الحاجة: نص متدفّق + جمل جاهزة للـ TTS.
 */

import { systemPrompt, makeSentenceSplitter } from "./prompt.js";
import { VOICE } from "./voice.js";

const wanted = (process.env.LLM_PROVIDER || "").toLowerCase();
const hasOpenAI = !!process.env.OPENAI_API_KEY?.startsWith("sk-");
const hasClaude = !!process.env.ANTHROPIC_API_KEY?.startsWith("sk-ant-")
  && !process.env.ANTHROPIC_API_KEY.startsWith("sk-ant-xxx");

export const PROVIDER =
  wanted === "openai" || wanted === "anthropic" ? wanted
  : hasOpenAI ? "openai"
  : hasClaude ? "anthropic"
  : "openai";

const mod = await (PROVIDER === "anthropic"
  ? import("./claude.js")
  : import("./openai.js"));

export const MODEL_ID = mod.MODEL_ID;
export const hasKey = PROVIDER === "anthropic" ? hasClaude : hasOpenAI;

/**
 * onDelta(text)    -> حتة نص جاية من الموديل
 * onSentence(text) -> جملة كاملة جاهزة للنطق
 */
const PROMPT = systemPrompt(VOICE === "elevenlabs");

export function streamReply(messages, opts) {
  return mod.streamReply(messages, PROMPT, makeSentenceSplitter(), opts);
}
