/**
 * Majed 3D — backend.
 *
 *   /api/stt       صوت المستخدم  -> نص           (ElevenLabs Scribe)
 *   /api/converse  نص المحادثة   -> SSE فيه:
 *                                     delta   : نص متدفّق للشاشة
 *                                     speech  : صوت جملة + توقيت كل حرف (للـ lip sync)
 *                                     done    : الرد كامل
 *   /api/config    إعدادات الواجهة (رابط الأفاتار)
 *
 * الـ API keys كلها هنا على السيرفر — المتصفح مبيشوفش ولا واحد منها.
 */

import "dotenv/config";
import express from "express";
import multer from "multer";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { transcribe, synthesize, VOICE, hasVoiceKey, hasTimestamps } from "./lib/voice.js";
import { streamReply, MODEL_ID, PROVIDER, hasKey } from "./lib/llm.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, "..", "public");

const app = express();
app.use(express.json({ limit: "1mb" }));
app.use(express.static(PUBLIC_DIR));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 }, // 25MB — أطول من أي جملة منطوقة
});

/* ────────────────────────────── config ────────────────────────────── */

app.get("/api/config", (_req, res) => {
  // الافتراضي = الموديل بتاعك بعد ما اترّكب عليه الشفايف (tools/rig_avatar.py).
  // محلّي بالكامل — مفيش أي اعتماد على خدمة أفاتار برّه.
  const avatarUrl = process.env.AVATAR_URL || "/models/majed.glb";
  res.json({
    avatarUrl,
    avatarConfigured: !!avatarUrl && !avatarUrl.includes("YOUR_AVATAR_ID"),
    model: MODEL_ID,
    provider: PROVIDER,
    voice: VOICE,
    hasVoiceKey,
    hasTimestamps,
    hasLlmKey: hasKey,
  });
});

/* ──────────────────────────────── STT ─────────────────────────────── */

app.post("/api/stt", upload.single("audio"), async (req, res) => {
  try {
    if (!req.file?.buffer?.length) {
      return res.status(400).json({ error: "مفيش ملف صوت" });
    }
    const text = await transcribe(
      req.file.buffer,
      req.file.originalname || "speech.webm",
      req.file.mimetype || "audio/webm"
    );
    res.json({ text });
  } catch (err) {
    console.error("[stt]", err);
    res.status(500).json({ error: err.message });
  }
});

/* ────────────────────────────── converse ──────────────────────────── */

app.post("/api/converse", async (req, res) => {
  const messages = Array.isArray(req.body?.messages) ? req.body.messages : null;
  if (!messages?.length) {
    return res.status(400).json({ error: "messages مطلوبة" });
  }

  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  const send = (type, data) => {
    if (!res.writableEnded) res.write(`data: ${JSON.stringify({ type, ...data })}\n\n`);
  };

  // لو المستخدم قفل الصفحة أو قاطع، بنلغي الشغل الجاري.
  //
  // لازم res مش req: على Express 5، req بيطلّع "close" أول ما جسم الطلب
  // يخلص قراءة (يعني فورًا بعد express.json) — مش لما العميل يفصل.
  // استخدام req هنا كان بيلغي كل دور قبل ما يبدأ، وفي صمت تام.
  const abort = new AbortController();
  res.on("close", () => abort.abort());

  // كل جملة بتروح للـ TTS فورًا (بالتوازي) — بس بتتبعت للمتصفح بالترتيب.
  //
  // بنستخدم سلسلة promises مش حلقة على مصفوفة: الحلقة كانت بتبدأ والطابور
  // لسه فاضي فبتخرج على طول. السلسلة بتستنى اللي قبلها وتضيف اللي بعده،
  // فالتوازي محفوظ والترتيب مضمون.
  let index = 0;
  let chain = Promise.resolve();

  const enqueue = (text) => {
    const i = index++;
    const job = synthesize(text, { signal: abort.signal })
      .then((audio) => ({ i, text, audio }))
      .catch((err) => ({ i, text, error: err.message }));

    chain = chain
      .then(() => job)
      .then((item) => {
        if (abort.signal.aborted) return;
        if (item.error) {
          console.error("[tts]", item.error);
          send("speech_error", { index: item.i, text: item.text, message: item.error });
        } else {
          send("speech", {
            index: item.i,
            text: item.text,
            audio: item.audio.audioBase64,
            mime: item.audio.mime,
            alignment: item.audio.alignment,
          });
        }
      });
  };

  try {
    const { reply, stopReason } = await streamReply(messages, {
      signal: abort.signal,
      onDelta: (text) => send("delta", { text }),
      onSentence: enqueue,
    });

    await chain;   // استنى كل الجمل تتبعت بالترتيب

    if (stopReason === "refusal") {
      send("refusal", {});
    }
    send("done", { reply });
  } catch (err) {
    if (!abort.signal.aborted) {
      console.error("[converse]", err);
      send("error", { message: err.message });
    }
  } finally {
    if (!res.writableEnded) res.end();
  }
});

/* ─────────────────────────────── start ────────────────────────────── */

const PORT = Number(process.env.PORT) || 5178;
app.listen(PORT, () => {
  console.log(`\n  ماجد شغال على  http://localhost:${PORT}`);
  console.log(`  الموديل: ${MODEL_ID}  (${PROVIDER})`);
  console.log(`  الصوت:   ${VOICE}${hasTimestamps ? "  (توقيت لكل حرف)" : "  (توقيت من مدة الصوت)"}`);
  if (!hasVoiceKey) {
    console.warn(`  ⚠  مفتاح ${VOICE === "elevenlabs" ? "ELEVENLABS" : "OPENAI"} مش متظبط — الصوت مش هيشتغل`);
  }
  if (!hasKey) {
    const which = PROVIDER === "anthropic" ? "ANTHROPIC_API_KEY" : "OPENAI_API_KEY";
    console.warn(`  ⚠  ${which} مش متظبط — الردود مش هتشتغل`);
  }

  console.log("");
});
