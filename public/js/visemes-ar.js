/**
 * خريطة الحروف العربية -> Oculus visemes (اللي بيشحنها Ready Player Me).
 *
 * دي الحاجة اللي كانت ناقصة تمامًا في الأكواد الجاهزة: جداول الـ visemes بتاعتها
 * لاتينية بالكامل، وكل الحروف العربية بتقع في شرط واحد افتراضي وبتاخد نفس شكل الفم.
 * النتيجة إن الفم بيرفرف مش بينطق.
 *
 * هنا كل حرف عربي متربوط بمخرجه الفعلي في النطق المصري:
 *   ب م  -> شفايف مقفولة (PP)
 *   ف    -> شفة تحت على السنان (FF)
 *   و    -> شفايف مدوّرة (U)
 *   ش ج  -> شفايف بارزة (CH)
 *   س ص ز -> شفايف مفرودة وضيقة (SS)
 *   ا ع ح ه ء -> فم مفتوح (aa)
 *   ... إلخ
 */

/** المجموعة الكاملة اللي RPM بيصدّرها مع morphTargets=Oculus Visemes */
export const VISEMES = [
  "sil", "PP", "FF", "TH", "DD", "kk", "CH",
  "SS", "nn", "RR", "aa", "E", "I", "O", "U",
];

/**
 * شكل كل viseme:
 *   jaw   = فتحة الفك        (jawOpen)
 *   round = تدوير الشفايف    (mouthFunnel / mouthPucker)
 *   wide  = فرد الشفايف      (mouthSmile*)
 *   close = ضغط الشفايف      (mouthClose)
 * القيم دي بتشتغل كطبقة تانية فوق الـ blendshape نفسه، عشان الفم يبان
 * مجسّم حتى لو الأفاتار عنده viseme واحد بس شغّال.
 */
export const SHAPE = {
  sil: { jaw: 0.00, round: 0.00, wide: 0.00, close: 0.00 },
  PP:  { jaw: 0.02, round: 0.10, wide: 0.00, close: 1.00 },
  FF:  { jaw: 0.14, round: 0.05, wide: 0.25, close: 0.30 },
  TH:  { jaw: 0.22, round: 0.00, wide: 0.30, close: 0.00 },
  DD:  { jaw: 0.24, round: 0.00, wide: 0.25, close: 0.00 },
  kk:  { jaw: 0.28, round: 0.05, wide: 0.15, close: 0.00 },
  CH:  { jaw: 0.20, round: 0.60, wide: 0.00, close: 0.00 },
  SS:  { jaw: 0.12, round: 0.00, wide: 0.55, close: 0.00 },
  nn:  { jaw: 0.16, round: 0.00, wide: 0.20, close: 0.00 },
  RR:  { jaw: 0.24, round: 0.35, wide: 0.10, close: 0.00 },
  aa:  { jaw: 0.82, round: 0.00, wide: 0.15, close: 0.00 },
  E:   { jaw: 0.40, round: 0.00, wide: 0.60, close: 0.00 },
  I:   { jaw: 0.26, round: 0.00, wide: 0.90, close: 0.00 },
  O:   { jaw: 0.52, round: 0.75, wide: 0.00, close: 0.00 },
  U:   { jaw: 0.28, round: 1.00, wide: 0.00, close: 0.00 },
};

/* ─────────────────────────── الحروف العربية ─────────────────────────── */

const ARABIC = {
  // همزات وألفات — كلها فم مفتوح
  "ء": "aa", "أ": "aa", "إ": "aa", "آ": "aa", "ٱ": "aa",
  "ئ": "aa", "ؤ": "U",  "ا": "aa", "ى": "aa",

  "ب": "PP",                    // شفايف مقفولة
  "ت": "DD", "ط": "DD",         // لسان على اللثة
  "ث": "TH", "ذ": "TH",         // لسان بين السنان
  "ج": "kk",                    // في المصري /g/ — مخرج خلفي
  "ح": "aa", "ع": "aa", "ه": "aa",  // حلقية — الفم مفتوح
  "خ": "kk", "غ": "kk", "ق": "kk", "ك": "kk",
  "د": "DD", "ض": "DD",
  "ر": "RR",
  "ز": "SS", "س": "SS", "ص": "SS",
  "ظ": "SS",                    // في المصري /zˤ/ مش /ðˤ/
  "ش": "CH",                    // شفايف بارزة
  "ف": "FF",                    // شفة تحت على السنان
  "ل": "nn", "ن": "nn",
  "م": "PP",                    // شفايف مقفولة
  "ه‍": "aa", "ة": "aa",
  "و": "U",                     // شفايف مدوّرة
  "ي": "I",                     // شفايف مفرودة

  // حروف معرّبة/دخيلة بتظهر في أسماء ومصطلحات
  "پ": "PP", "چ": "CH", "ڤ": "FF", "ڥ": "FF", "گ": "kk", "ژ": "CH",
};

/** الحركات — بتحدد شكل الفم أكتر من الحرف نفسه */
const HARAKAT = {
  "َ": "aa", // فتحة
  "ً": "aa", // فتحتين
  "ِ": "I",  // كسرة
  "ٍ": "I",  // كسرتين
  "ُ": "U",  // ضمة
  "ٌ": "U",  // ضمتين
  "ٰ": "aa", // ألف خنجرية
  "ٓ": "aa", // مدّة
};

/** علامات مبتغيّرش شكل الفم — بتمدّ أو بتسكّن اللي قبلها */
const SILENT = new Set([
  "ْ", // سكون
  "ّ", // شدّة
  "ٔ", "ٕ", // همزة فوق/تحت
  "ـ", // تطويل ـــ
  "‌", "‍", "‎", "‏", // محارف اتجاه/وصل
]);

/* ─────────────────────────── حروف لاتينية ─────────────────────────── */
/* للنصوص المختلطة (أسماء، مصطلحات تقنية) */

const LATIN = {
  a: "aa", e: "E", i: "I", o: "O", u: "U", y: "I",
  b: "PP", p: "PP", m: "PP",
  f: "FF", v: "FF",
  w: "U",
  r: "RR",
  l: "nn", n: "nn",
  s: "SS", z: "SS", c: "SS", x: "SS",
  d: "DD", t: "DD",
  k: "kk", g: "kk", q: "kk",
  j: "CH",
  h: "aa",
};

const PUNCT = /[\s.,!?;:'"()\[\]{}«»…\-–—/\\|@#$%^&*_+=~`،؛؟٪]/;

/**
 * حرف واحد -> اسم viseme، أو null يعني "مفيش تغيير" (امسك الشكل الحالي).
 */
export function visemeForChar(ch) {
  if (!ch) return null;
  if (SILENT.has(ch)) return null;
  if (PUNCT.test(ch)) return "sil";

  const har = HARAKAT[ch];
  if (har) return har;

  const ar = ARABIC[ch];
  if (ar) return ar;

  const lat = LATIN[ch.toLowerCase()];
  if (lat) return lat;

  // أرقام — ElevenLabs بيفكّها لكلمات في normalized_alignment، بس لو فضلت رقم
  // خلّيها فم مفتوح بدل ما تبقى سكوت.
  if (/[0-9٠-٩]/.test(ch)) return "aa";

  return null;
}

/**
 * alignment من ElevenLabs -> جدول زمني بالـ visemes بتوقيت حقيقي بالثواني.
 *
 * alignment = { characters, character_start_times_seconds, character_end_times_seconds }
 * الناتج    = [{ viseme, t0, t1 }, ...] مرتّب زمنيًا ومدموم فيه المتكرر.
 */
export function buildVisemeTimeline(alignment) {
  const chars = alignment?.characters || [];
  const starts = alignment?.character_start_times_seconds || [];
  const ends = alignment?.character_end_times_seconds || [];
  const out = [];

  let held = null; // آخر viseme اتحدد — بنمسكه خلال السواكن والشدّات
  let inTag = 0;   // جوّه وسم أداء؟

  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];

    // وسوم الأداء ([بهدوء]، [يضحك] …) تعليمات للـ TTS مش كلام بيتنطق، بس
    // ElevenLabs بيرجّع توقيت لحروفها زي أي حرف تاني. لو مشيناها هنا الفم
    // هينطق "بهدوء" حرف حرف في أول الجملة.
    if (ch === "[") { inTag++; continue; }
    if (ch === "]") { inTag = Math.max(0, inTag - 1); continue; }
    if (inTag) continue;

    const t0 = starts[i];
    const t1 = ends[i];
    if (typeof t0 !== "number" || typeof t1 !== "number" || t1 < t0) continue;

    let v = visemeForChar(ch);
    if (v === null) v = held;      // حرف مبيغيّرش الشكل -> كمّل باللي قبله
    if (v === null) continue;      // لسه مفيش شكل من الأصل
    held = v;

    const prev = out[out.length - 1];
    if (prev && prev.viseme === v && t0 - prev.t1 < 0.035) {
      prev.t1 = Math.max(prev.t1, t1);   // ادمج المتكرر المتلاصق
    } else {
      out.push({ viseme: v, t0, t1: Math.max(t1, t0 + 0.02) });
    }
  }

  // اقفل الفم في الآخر
  if (out.length) {
    const last = out[out.length - 1];
    out.push({ viseme: "sil", t0: last.t1, t1: last.t1 + 0.12 });
  }
  return out;
}


/* ══════════════════ توقيت تقديري مربوط بالمدة الحقيقية ══════════════════ */

/**
 * وسوم ElevenLabs الانفعالية — [يهمس] [يضحك] [excited] … دي تعليمات أداء
 * للصوت، مش كلام بيتنطق. لازم تتشال قبل أي حساب للشفايف وقبل العرض على الشاشة،
 * وإلا الفم هينطق كلمة "يهمس" حرف حرف.
 */
export const AUDIO_TAG = /\[[^\]\n]{1,40}\]/g;

export function stripTags(text) {
  return (text || "").replace(AUDIO_TAG, " ").replace(/\s{2,}/g, " ").trim();
}

const SILENT_SET = new Set(["ْ", "ّ", "ٔ", "ٕ", "ـ"]);
const MADD = new Set([..."اويآإأى"]);
const VOWEL = new Set([..."َِuaeio"]);

/** وزن زمني تقريبي لكل حرف — المدّ والصوائت بتاخد وقت أطول من السواكن. */
function charWeight(ch) {
  if (/\s/.test(ch)) return 0.55;
  if (/[.!?؟۔]/.test(ch)) return 3.2;      // وقفة كاملة
  if (/[،,؛;:]/.test(ch)) return 1.9;      // وقفة قصيرة
  if (/["'«»()\[\]{}…\-–—]/.test(ch)) return 0.30;
  if (SILENT_SET.has(ch)) return 0.20;
  if (MADD.has(ch)) return 1.45;            // حروف مدّ
  if (VOWEL.has(ch)) return 1.05;           // حركات وصوائت
  return 1.0;
}

/**
 * لما الـ TTS مبيرجعش توقيتات لكل حرف (زي OpenAI)، بنبني alignment
 * بنفس شكل ElevenLabs — بس **المدة الكلية حقيقية** (مقروءة من الصوت نفسه
 * بعد فك تشفيره)، والتوزيع جوّاها بالأوزان.
 *
 * الفرق عن التخمين الكامل: هنا الجملة بتخلص بالظبط مع الصوت، فمفيش تراكم
 * خطأ ولا drift. وطبقة السعة بتصحّح الباقي لحظيًا.
 */
export function estimateAlignment(text, duration) {
  const clean = stripTags(text);
  const chars = [...clean];
  if (!chars.length || !(duration > 0)) {
    return { characters: [], character_start_times_seconds: [], character_end_times_seconds: [] };
  }

  const w = chars.map(charWeight);
  const total = w.reduce((a, b) => a + b, 0) || 1;

  // سكوت صغير في الأول والآخر — كل الأصوات بتبدأ بيه
  const lead = Math.min(0.12, duration * 0.04);
  const tail = Math.min(0.10, duration * 0.03);
  const span = Math.max(0.05, duration - lead - tail);

  const starts = [], ends = [];
  let t = lead;
  for (let i = 0; i < chars.length; i++) {
    const d = (w[i] / total) * span;
    starts.push(t);
    ends.push(t + d);
    t += d;
  }
  return {
    characters: chars,
    character_start_times_seconds: starts,
    character_end_times_seconds: ends,
  };
}
