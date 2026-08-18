/**
 * تعبيرات الوش — الطبقة اللي بتفرّق بين "فم بيتحرك" و"حد بيتكلم".
 *
 * الفكرة: وسوم الأداء اللي بنبعتها لـ ElevenLabs عشان تلوّن الصوت
 * ([يضحك]، [بهدوء]، [متحمس] …) هي نفسها اللي بتسوق الوش. مصدر واحد،
 * فالصوت والتعبير بيطلعوا متزامنين بدل ما كل واحد يشتغل لوحده.
 *
 * تقسيم المسؤوليات مهم:
 *   • الـ visemes بتملك الفم — التعبير بيلمسه بخفة بس (`mouthBias`)
 *   • التعبير بيملك فوق الوش: حواجب، عينين، خدود، مناخير
 * من غير التقسيم ده الابتسامة بتاكل النطق والعكس.
 *
 * ملاحظة على الابتسامة: الابتسامة الحقيقية بتشد الخدود وتضيّق العينين
 * (Duchenne). ابتسامة بالفم لوحده بتبان مزيّفة — عشان كده `cheekSquint`
 * و`eyeSquint` موجودين في كل تعبير فيه فرح.
 */

/** كل تعبير = أوزان ARKit. القيم متعمّدة واطية — الوش الحقيقي بيتحرك قليل. */
export const EMOTIONS = {
  neutral: {},

  happy: {
    mouthSmileLeft: 0.55, mouthSmileRight: 0.55,
    mouthDimpleLeft: 0.30, mouthDimpleRight: 0.30,
    cheekSquintLeft: 0.45, cheekSquintRight: 0.45,
    eyeSquintLeft: 0.28, eyeSquintRight: 0.28,
    browInnerUp: 0.12,
  },

  laugh: {
    mouthSmileLeft: 0.80, mouthSmileRight: 0.80,
    mouthDimpleLeft: 0.40, mouthDimpleRight: 0.40,
    cheekSquintLeft: 0.70, cheekSquintRight: 0.70,
    eyeSquintLeft: 0.55, eyeSquintRight: 0.55,
    browOuterUpLeft: 0.25, browOuterUpRight: 0.25,
    mouthBias: 0.25,           // الفم بيميل للفتح شوية
  },

  excited: {
    eyeWideLeft: 0.40, eyeWideRight: 0.40,
    browInnerUp: 0.45, browOuterUpLeft: 0.40, browOuterUpRight: 0.40,
    mouthSmileLeft: 0.40, mouthSmileRight: 0.40,
    cheekSquintLeft: 0.20, cheekSquintRight: 0.20,
    mouthBias: 0.15,
  },

  calm: {
    eyeSquintLeft: 0.14, eyeSquintRight: 0.14,
    browDownLeft: 0.10, browDownRight: 0.10,
    mouthSmileLeft: 0.14, mouthSmileRight: 0.14,
    mouthBias: -0.12,          // فم أهدى
  },

  whisper: {
    eyeSquintLeft: 0.30, eyeSquintRight: 0.30,
    browInnerUp: 0.25,
    mouthPressLeft: 0.20, mouthPressRight: 0.20,
    cheekSquintLeft: 0.15, cheekSquintRight: 0.15,
    mouthBias: -0.30,          // شفايف أقرب لبعض
  },

  curious: {
    browOuterUpLeft: 0.55, browInnerUp: 0.30,   // حاجب واحد — دي علامة الفضول
    eyeWideLeft: 0.20, eyeWideRight: 0.20,
    mouthSmileLeft: 0.16, mouthSmileRight: 0.10,
    headTilt: 0.55,
  },

  thinking: {
    browDownLeft: 0.35, browDownRight: 0.35,
    eyeSquintLeft: 0.30, eyeSquintRight: 0.30,
    mouthPressLeft: 0.30, mouthPressRight: 0.30,
    mouthLeft: 0.20,
    headTilt: -0.35,
  },

  surprised: {
    eyeWideLeft: 0.70, eyeWideRight: 0.70,
    browInnerUp: 0.70, browOuterUpLeft: 0.60, browOuterUpRight: 0.60,
    mouthBias: 0.35,
  },

  sad: {
    browInnerUp: 0.60,
    mouthFrownLeft: 0.45, mouthFrownRight: 0.45,
    eyeSquintLeft: 0.20, eyeSquintRight: 0.20,
    mouthShrugLower: 0.25,
    headTilt: -0.25,
  },

  serious: {
    browDownLeft: 0.30, browDownRight: 0.30,
    eyeSquintLeft: 0.15, eyeSquintRight: 0.15,
    mouthPressLeft: 0.22, mouthPressRight: 0.22,
  },

  sorry: {
    browInnerUp: 0.50,
    mouthFrownLeft: 0.22, mouthFrownRight: 0.22,
    mouthShrugUpper: 0.20,
    eyeSquintLeft: 0.18, eyeSquintRight: 0.18,
    headTilt: -0.20,
  },
};

/**
 * وسوم الأداء ➜ تعبير.
 * بنطابق بالاحتواء عشان الموديل بيكتبها بصيغ مختلفة ([يضحك]، [بيضحك]،
 * [ضاحكًا] …) وكمان بيخلط عربي بإنجليزي.
 */
const TAG_MAP = [
  [["يضحك", "ضاحك", "بيضحك", "laugh", "chuckl", "giggl"], "laugh"],
  [["يهمس", "هامس", "بيهمس", "whisper"], "whisper"],
  [["متحمس", "بحماس", "حماس", "excited", "enthusiast"], "excited"],
  [["بهدوء", "هادئ", "بهدو", "calm", "gentle", "softly", "soft"], "calm"],
  [["متفاجئ", "مندهش", "استغراب", "surprise", "shock", "gasp"], "surprised"],
  [["يفكر", "بتفكير", "مفكر", "think", "ponder", "hmm"], "thinking"],
  [["فضول", "مستغرب", "سؤال", "curious", "question", "wonder"], "curious"],
  [["حزين", "بحزن", "أسف", "آسف", "sad", "sorry", "apolog"], "sorry"],
  [["جاد", "بجدية", "serious", "firm", "stern"], "serious"],
  [["مبسوط", "سعيد", "بابتسامة", "فرح", "happy", "smil", "warm", "cheer"], "happy"],
];

/** نص الوسم الجوّاني ➜ اسم تعبير (أو null). */
export function emotionForTag(inner) {
  const s = (inner || "").toLowerCase().trim();
  if (!s) return null;
  for (const [keys, emo] of TAG_MAP) {
    for (const k of keys) if (s.includes(k)) return emo;
  }
  return null;
}

/**
 * بيطلّع من الجملة: التعبير + مكانه في النص المنطوق (بعد شيل الوسوم).
 * بنرجّع نسبة مئوية مش ثواني، لأن مدة الصوت لسه مش معروفة وقت التحليل.
 *
 *   "[بهدوء] أهلاً. [يضحك] تمام!"
 *     -> [{ emotion:"calm", at:0 }, { emotion:"laugh", at:0.5 }]
 */
export function emotionCues(text) {
  const cues = [];
  let spoken = 0, total = 0;
  const re = /\[([^\]\n]{1,40})\]/g;
  let last = 0, m;
  const parts = [];
  while ((m = re.exec(text)) !== null) {
    parts.push({ before: text.slice(last, m.index), tag: m[1] });
    last = m.index + m[0].length;
  }
  parts.push({ before: text.slice(last), tag: null });
  for (const p of parts) total += p.before.length;
  if (!total) total = 1;
  for (const p of parts) {
    spoken += p.before.length;
    if (!p.tag) continue;
    const emo = emotionForTag(p.tag);
    if (emo) cues.push({ emotion: emo, at: spoken / total });
  }
  return cues;
}

/**
 * لو الموديل نسي يحط وسم، نستنتج حاجة خفيفة من علامات الترقيم والكلمات.
 * الهدف مش الدقة — الهدف إن الوش ميفضلش ميت لو الوسوم غابت.
 */
export function inferEmotion(text) {
  const t = (text || "").trim();
  if (!t) return null;
  if (/[!]{1}/.test(t) && /(رائع|جميل|ممتاز|تمام|أهلا|أهلاً|مبروك|حلو)/.test(t)) return "happy";
  if (/\?|؟/.test(t)) return "curious";
  if (/(آسف|أسف|للأسف|مش قادر|معلش)/.test(t)) return "sorry";
  if (/(مهم|لازم|خلي بالك|تحذير|خطر)/.test(t)) return "serious";
  if (/!/.test(t)) return "excited";
  return null;
}
