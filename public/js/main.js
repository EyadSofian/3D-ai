/**
 * التنسيق العام: مايك → نص → Claude → صوت → شفايف.
 *
 * الحلقة الكاملة:
 *   Mic + VAD  →  /api/stt  →  /api/converse (SSE)
 *                                  ├─ delta   → ترجمة على الشاشة
 *                                  └─ speech  → صوت + توقيتات
 *                                                 ├─ AudioEngine (تشغيل + تحليل)
 *                                                 └─ LipSync (شكل الفم)
 *                                                        → Avatar
 */

import { Avatar } from "./avatar.js";
import { AudioEngine } from "./audio.js";
import { LipSync } from "./lipsync.js";
import { Mic } from "./mic.js";
import { buildVisemeTimeline, estimateAlignment, stripTags } from "./visemes-ar.js";
import * as api from "./api.js";

const $ = (s) => document.querySelector(s);

const el = {
  stage: $("#stage"),
  mount: $("#avatarMount"),
  boot: $("#boot"),
  bootText: $("#bootText"),
  state: $("#stateLabel"),
  dot: $("#stateDot"),
  caption: $("#caption"),
  log: $("#log"),
  micBtn: $("#micBtn"),
  micLabel: $("#micLabel"),
  meter: $("#meter"),
  textForm: $("#textForm"),
  textInput: $("#textInput"),
  diag: $("#diag"),
  diagBody: $("#diagBody"),
  diagToggle: $("#diagToggle"),
};

const avatar = new Avatar(el.mount);
const audio = new AudioEngine();
const lips = new LipSync();
const mic = new Mic();

/** تاريخ المحادثة بصيغة Anthropic. */
const history = [];
let turn = null;          // AbortController للدور الحالي
let state = "idle";
let listening = false;

/* ───────────────────────────── واجهة ───────────────────────────── */

const LABELS = {
  idle: "جاهز",
  listening: "بسمعك",
  thinking: "بفكّر",
  speaking: "بتكلّم",
};

function setState(next) {
  if (state === next) return;
  state = next;
  avatar.setState(next);
  el.state.textContent = LABELS[next] || next;
  el.dot.dataset.state = next;
  el.stage.dataset.state = next;
}

function caption(text) {
  el.caption.textContent = text || "";
  el.caption.classList.toggle("show", !!text);
}

function log(text, who) {
  const d = document.createElement("div");
  d.className = `msg ${who}`;
  d.textContent = text;
  el.log.appendChild(d);
  el.log.scrollTop = el.log.scrollHeight;
  return d;
}

function fail(text) {
  log(text, "err");
  caption("");
  setState("idle");
}

/* ─────────────────────────── دورة الكلام ─────────────────────────── */

/**
 * جملة جاهزة من السيرفر → جدول visemes + طابور الصوت.
 *
 * ElevenLabs بيبعت توقيت لكل حرف => بنستخدمه على طول (أدق حاجة).
 * OpenAI مبيبعتش => بنفك تشفير الصوت الأول عشان نعرف **مدته الحقيقية**
 * ونوزّع الحروف عليها. الفرق إن الجملة بتخلص مع الصوت بالظبط.
 */
async function playSentence(ev) {
  let alignment = ev.alignment;
  let buffer = null;

  if (!alignment) {
    buffer = await audio.decode(ev.audio);
    alignment = estimateAlignment(ev.text, buffer.duration);
  }
  await audio.enqueue({
    audio: ev.audio, buffer,
    timeline: buildVisemeTimeline(alignment),
    text: stripTags(ev.text),
  });
}

async function respondTo(userText) {
  history.push({ role: "user", content: userText });
  log(userText, "me");

  setState("thinking");
  caption("");

  turn?.abort();
  turn = new AbortController();

  let botLine = null;
  let shown = "";
  let sawAudio = false;

  try {
    await api.converse(history, (ev) => {
      switch (ev.type) {
        case "delta":
          shown += ev.text;
          if (!botLine) botLine = log("", "bot");
          botLine.textContent = stripTags(shown);
          el.log.scrollTop = el.log.scrollHeight;
          break;

        case "speech":
          sawAudio = true;
          playSentence(ev).catch((e) => console.warn("[audio]", e));
          break;

        case "speech_error":
          console.warn("[tts]", ev.message);
          break;

        case "refusal":
          log("(الموديل رفض يرد على دي)", "err");
          break;

        case "error":
          fail("خطأ: " + ev.message);
          break;

        case "done":
          if (ev.reply) history.push({ role: "assistant", content: ev.reply });
          if (!sawAudio) setState("idle");
          break;
      }
    }, turn.signal);
  } catch (err) {
    if (err.name !== "AbortError") fail("مقدرتش أوصل للسيرفر: " + err.message);
  }
}

/* ───────────────────── الصوت → الشفايف كل frame ───────────────────── */

audio.onClipStart = (clip) => {
  lips.setTimeline(clip.timeline);
  setState("speaking");
  caption(clip.text);
};

audio.onDrained = () => {
  lips.clear();
  avatar.applyLipSync(null);
  caption("");
  setState(listening ? "listening" : "idle");
};

function driveLips() {
  requestAnimationFrame(driveLips);
  if (!avatar.ready) return;
  if (audio.isPlaying) {
    avatar.applyLipSync(lips.sample(audio.playbackTime, audio.envelope));
  } else if (lips.active) {
    avatar.applyLipSync(null);
  }
}

/* ──────────────────────────── المايك ──────────────────────────── */

mic.onLevel = (v) => {
  el.meter.style.setProperty("--level", v.toFixed(3));
};

mic.onSpeechStart = () => {
  // barge-in: لو اتكلمت وهو بيتكلم، اقطع عليه — زي الكلام الطبيعي
  if (audio.isPlaying) {
    audio.stop();
    lips.clear();
    avatar.applyLipSync(null);
    turn?.abort();
    caption("");
  }
  setState("listening");
};

mic.onSpeechEnd = async (blob) => {
  setState("thinking");
  try {
    const text = await api.transcribe(blob);
    if (!text) { setState(listening ? "listening" : "idle"); return; }
    await respondTo(text);
  } catch (err) {
    fail("مقدرتش أفهم الصوت: " + err.message);
  }
};

mic.onError = (err) => fail("مشكلة في المايك: " + err.message);

async function toggleMic() {
  if (listening) {
    listening = false;
    await mic.stop();
    el.micBtn.classList.remove("on");
    el.micLabel.textContent = "ابدأ الكلام";
    el.meter.style.setProperty("--level", "0");
    if (!audio.isPlaying) setState("idle");
    return;
  }
  try {
    await audio.unlock();          // لازم من داخل ضغطة
    await mic.start();
    listening = true;
    el.micBtn.classList.add("on");
    el.micLabel.textContent = "إيقاف المايك";
    setState("listening");
  } catch (err) {
    fail(
      err.name === "NotAllowedError"
        ? "لازم تسمح بالمايك من المتصفح."
        : "مقدرتش أفتح المايك: " + err.message
    );
  }
}

/* ──────────────────────────── الإقلاع ──────────────────────────── */

function renderDiagnostics(report, cfg) {
  const rows = [
    ["الموديل", cfg.model],
    ["المزوّد", cfg.provider],
    [cfg.provider === "anthropic" ? "Anthropic key" : "OpenAI key",
      cfg.hasLlmKey ? "✅" : "❌ ناقص"],
    ["الصوت", cfg.voice],
    ["مفتاح الصوت", cfg.hasVoiceKey ? "✅" : "❌ ناقص"],
    ["توقيت الشفايف", cfg.hasTimestamps ? "لكل حرف (الأدق)" : "من مدة الصوت"],
    ["morph targets", report ? report.totalMorphs : "—"],
    ["visemes", report ? (report.visemes.length || "❌ مفيش") : "—"],
    ["ARKit shapes", report ? report.arkit.length : "—"],
    ["عضم", report ? report.bones.join(", ") || "❌ مفيش" : "—"],
    ["lip sync", report ? (report.canLipSync ? "✅ شغّال" : "❌ الموديل مالوش شفايف") : "—"],
  ];
  el.diagBody.innerHTML = rows
    .map(([k, v]) => `<div class="drow"><span>${k}</span><b>${v}</b></div>`)
    .join("") +
    (report?.visemes?.length
      ? `<div class="dlist">${report.visemes.join(" · ")}</div>`
      : "");
}

async function boot() {
  driveLips();

  let cfg;
  try {
    cfg = await api.getConfig();
  } catch {
    el.bootText.textContent = "السيرفر مش شغّال";
    return;
  }

  if (!cfg.avatarConfigured) {
    el.bootText.innerHTML =
      "لسه محطتش الأفاتار.<br><small>اعمل واحد على readyplayer.me وحط الـ URL في AVATAR_URL جوه .env</small>";
    renderDiagnostics(null, cfg);
    el.diag.hidden = false;
    return;
  }

  el.bootText.textContent = "بحمّل الأفاتار…";
  try {
    const report = await avatar.load(cfg.avatarUrl);
    renderDiagnostics(report, cfg);
    el.boot.classList.add("gone");

    if (!report.canLipSync) {
      log(
        "الأفاتار اتحمّل بس مفيهوش visemes — الشفايف مش هتتحرك. " +
        "زوّد ?morphTargets=ARKit,Oculus%20Visemes على رابط الـ GLB.",
        "err"
      );
    }
    if (!mic.supported) {
      log("المتصفح دا مبيدعمش تسجيل الصوت — استخدم الكتابة.", "err");
      el.micBtn.disabled = true;
    }
    setState("idle");
  } catch (err) {
    el.bootText.innerHTML =
      "فشل تحميل الأفاتار.<br><small>" + (err.message || err) + "</small>";
    renderDiagnostics(null, cfg);
    el.diag.hidden = false;
  }
}

/* ───────────────────────────── ربط ───────────────────────────── */

// مقبض للتشخيص من الـ console — بيسهّل اختبار الشفايف من غير مفاتيح API
window.__majed = { avatar, audio, lips, mic, history, setState, buildVisemeTimeline };

el.micBtn.addEventListener("click", toggleMic);

el.textForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const text = el.textInput.value.trim();
  if (!text) return;
  el.textInput.value = "";
  await audio.unlock();
  await respondTo(text);
});

el.diagToggle.addEventListener("click", () => {
  el.diag.hidden = !el.diag.hidden;
});

boot();
