/**
 * محرّك الـ lip sync — طبقتين.
 *
 *   طبقة (أ): جدول زمني للـ visemes مبني على توقيتات ElevenLabs الحقيقية.
 *             دي بتحدد *شكل* الفم.
 *   طبقة (ب): مغلّف الصوت (RMS) جاي من AnalyserNode على الموجة اللي بتتشغّل.
 *             دي بتحدد *مقدار* الفتح لحظة بلحظة.
 *
 * ليه الاتنين؟ الطبقة (أ) لوحدها بتدي أشكال صح بس حركة ميتة.
 * الطبقة (ب) لوحدها بتدي حركة حيّة بس الفم مبيعرفش ينطق الحروف.
 * ومع بعض: مستحيل يحصل drift، لأن الاتنين مربوطين بنفس الصوت.
 */

import { SHAPE } from "./visemes-ar.js";

const ATTACK = 0.045;  // ثانية — الفم بيوصل للشكل قبل الصوت بشوية (coarticulation)
const RELEASE = 0.070; // ثانية — وبيسيبه بعده بشوية

function smoothstep(x) {
  x = x < 0 ? 0 : x > 1 ? 1 : x;
  return x * x * (3 - 2 * x);
}

export class LipSync {
  constructor() {
    this.timeline = [];
    this.cursor = 0;
    this.active = false;
    this.lastT = 0;
  }

  setTimeline(timeline) {
    this.timeline = timeline || [];
    this.cursor = 0;
    this.lastT = 0;
    this.active = this.timeline.length > 0;
  }

  clear() {
    this.timeline = [];
    this.cursor = 0;
    this.lastT = 0;
    this.active = false;
  }

  get duration() {
    const last = this.timeline[this.timeline.length - 1];
    return last ? last.t1 : 0;
  }

  /**
   * t   = ثواني من بداية تشغيل المقطع (من AudioContext.currentTime — مفيش تخمين)
   * env = مغلّف السعة 0..1 من الـ analyser
   */
  sample(t, env = 1) {
    const weights = Object.create(null);
    let jaw = 0, round = 0, wide = 0, close = 0, total = 0;

    if (this.active) {
      // المؤشر بيتقدّم بس. لو الوقت رجع لورا (إعادة تشغيل / تقديم يدوي)
      // نرجّعه من الأول، وإلا هيفضل بعد المقطع المطلوب ويرجّع فم فاضي.
      if (t < this.lastT) this.cursor = 0;
      this.lastT = t;

      while (
        this.cursor < this.timeline.length - 1 &&
        this.timeline[this.cursor].t1 + RELEASE < t
      ) this.cursor++;

      // شوف المقاطع القريبة من الوقت الحالي وامزجها
      for (let i = Math.max(0, this.cursor - 1); i < this.timeline.length; i++) {
        const seg = this.timeline[i];
        if (seg.t0 - ATTACK > t) break;
        if (seg.t1 + RELEASE < t) continue;

        let w;
        if (t < seg.t0) w = smoothstep((t - (seg.t0 - ATTACK)) / ATTACK);
        else if (t <= seg.t1) w = 1;
        else w = 1 - smoothstep((t - seg.t1) / RELEASE);
        if (w <= 0.001) continue;

        const s = SHAPE[seg.viseme] || SHAPE.sil;
        weights[seg.viseme] = (weights[seg.viseme] || 0) + w;
        jaw += s.jaw * w;
        round += s.round * w;
        wide += s.wide * w;
        close += s.close * w;
        total += w;
      }
    }

    if (total > 0) {
      // طبّع عشان مجموع الأوزان ميعديش 1 وقت التداخل
      for (const k in weights) weights[k] /= total;
      jaw /= total; round /= total; wide /= total; close /= total;
    }

    // طبقة (ب): السعة الحقيقية بتعدّل الفتح.
    // الأرضية 0.55 عشان السواكن (اللي طاقتها واطية) تفضل باينة.
    const gain = 0.55 + 0.45 * Math.min(1, env);
    jaw *= gain;

    // رعشة صغيرة جدًا — بتشيل الإحساس الميكانيكي من غير ما تبوّظ النطق
    if (jaw > 0.05) {
      const n = performance.now();
      jaw += (Math.sin(n * 0.021) * 0.012 + Math.sin(n * 0.047) * 0.008);
    }

    return {
      weights,
      jaw: Math.max(0, Math.min(1, jaw)),
      round: Math.max(0, Math.min(1, round)),
      wide: Math.max(0, Math.min(1, wide)),
      close: Math.max(0, Math.min(1, close)),
    };
  }
}
