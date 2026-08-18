/**
 * تشغيل الصوت عن طريق Web Audio API.
 *
 * ليه مش <audio> عادي؟ عشان حاجتين:
 *  1. AudioContext.currentTime بيدينا موضع التشغيل بدقة عالية —
 *     فالـ lip sync بيتقرأ من الصوت نفسه، مش من مؤقّت جنبه. الـ drift مستحيل.
 *  2. AnalyserNode بيدينا السعة اللحظية — دي طبقة (ب) في محرّك الشفايف.
 *
 * (ودي بالظبط الحاجة اللي speechSynthesis مبيسمحش بيها: مبيديكش أي stream
 *  تقدر تحلله، فمفيش قدامك غير إنك تخمّن التوقيت من عدد الحروف.)
 */

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.analyser = null;
    this.gainNode = null;
    this.buf = null;

    this.queue = [];        // [{ buffer, timeline, text }]
    this.source = null;
    this.current = null;
    this.startedAt = 0;
    this.playing = false;

    this._env = 0;

    this.onClipStart = null;  // (clip) =>
    this.onDrained = null;    // () => خلصت كل الجمل
  }

  /** لازم تتنادى من داخل حدث لمسة/ضغطة — سياسة المتصفحات. */
  async unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AC({ latencyHint: "interactive" });
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 1024;
      this.analyser.smoothingTimeConstant = 0.25;
      this.gainNode = this.ctx.createGain();
      this.analyser.connect(this.gainNode);
      this.gainNode.connect(this.ctx.destination);
      this.buf = new Uint8Array(this.analyser.fftSize);
    }
    if (this.ctx.state === "suspended") await this.ctx.resume();
    return this.ctx;
  }

  async decode(base64) {
    await this.unlock();
    const bin = atob(base64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return this.ctx.decodeAudioData(bytes.buffer);
  }

  /** ضيف جملة للطابور — بتشتغل لوحدها لو مفيش حاجة شغالة. */
  async enqueue({ audio, timeline, text, buffer }) {
    if (!buffer) buffer = await this.decode(audio);
    this.queue.push({ buffer, timeline, text });
    if (!this.playing) this._next();
  }

  _next() {
    const clip = this.queue.shift();
    if (!clip) {
      this.playing = false;
      this.current = null;
      this.onDrained?.();
      return;
    }

    const src = this.ctx.createBufferSource();
    src.buffer = clip.buffer;
    src.connect(this.analyser);

    this.source = src;
    this.current = clip;
    this.playing = true;
    this.startedAt = this.ctx.currentTime;

    src.onended = () => {
      if (this.source !== src) return; // اتلغى واتبدل
      this.source = null;
      this._next();
    };
    src.start();
    this.onClipStart?.(clip);
  }

  /** ثواني من بداية المقطع الشغّال — من ساعة الصوت نفسها. */
  get playbackTime() {
    if (!this.playing || !this.ctx) return 0;
    return this.ctx.currentTime - this.startedAt;
  }

  get timeline() {
    return this.current?.timeline || null;
  }

  get isPlaying() {
    return this.playing;
  }

  /** مغلّف السعة 0..1، مع attack سريع و release أبطأ عشان ميرفرفش. */
  get envelope() {
    if (!this.analyser || !this.playing) {
      this._env *= 0.82;
      return this._env;
    }
    this.analyser.getByteTimeDomainData(this.buf);
    let sum = 0;
    for (let i = 0; i < this.buf.length; i++) {
      const v = (this.buf[i] - 128) / 128;
      sum += v * v;
    }
    const rms = Math.sqrt(sum / this.buf.length);
    const level = Math.min(1, rms * 3.2); // كلام عادي RMS بيقع حوالي 0.05–0.3
    this._env = level > this._env
      ? this._env + (level - this._env) * 0.55   // attack
      : this._env + (level - this._env) * 0.14;  // release
    return this._env;
  }

  /** قطع فوري — للمقاطعة (barge-in). */
  stop() {
    this.queue.length = 0;
    if (this.source) {
      const s = this.source;
      this.source = null;
      try { s.onended = null; s.stop(); } catch {}
    }
    this.playing = false;
    this.current = null;
    this._env = 0;
  }
}
