/**
 * المايك + VAD (كشف الكلام).
 *
 * حاجتين بيتنسوا وبيبوّظوا كل حاجة:
 *  1. echoCancellation — من غيرها الأفاتار بيسمع صوت نفسه من السماعات ويرد على نفسه.
 *  2. إن الميكروفون يتوقف وقت ما الأفاتار بيتكلم. هنا بنعمل barge-in بدل السكوت:
 *     لو اتكلمت وهو بيتكلم، بنقاطعه — زي البني آدمين بالظبط.
 *
 * الـ VAD مبني على طاقة الإشارة مع أرضية ضوضاء بتتعاير أوتوماتيك،
 * فبيشتغل في أوضة هادية وفي مكتب فيه دوشة من غير ما تظبّط حاجة.
 */

const SILENCE_MS = 850;     // سكوت كام قبل ما نعتبر الكلام خلص
const MIN_SPEECH_MS = 280;  // أقصر من كده = كحّة أو صوت طرقعة
const MAX_SPEECH_MS = 25000;
const ONSET_MS = 130;       // لازم يعدّي العتبة المدة دي قبل ما نقول "بيتكلم"
const IDLE_RESET_MS = 1600; // نعيد تشغيل المسجّل كل شوية عشان السكوت الأول ميطولش

function pickMime() {
  const opts = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4",       // Safari
    "audio/ogg;codecs=opus",
  ];
  return opts.find((m) => window.MediaRecorder?.isTypeSupported?.(m)) || "";
}

export class Mic {
  constructor() {
    this.stream = null;
    this.ctx = null;
    this.analyser = null;
    this.buf = null;

    this.recorder = null;
    this.chunks = [];
    this.mime = "";

    this.listening = false;
    this.speaking = false;
    this.level = 0;
    this.floor = 0.01;

    this._onsetAt = 0;
    this._silenceAt = 0;
    this._speechStartAt = 0;
    this._recStartAt = 0;
    this._raf = null;

    this.onSpeechStart = null;   // () =>
    this.onSpeechEnd = null;     // (Blob) =>
    this.onLevel = null;         // (0..1) =>
    this.onError = null;         // (Error) =>
  }

  get supported() {
    return !!(navigator.mediaDevices?.getUserMedia && window.MediaRecorder);
  }

  async init() {
    if (this.stream) return;
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,   // ← من غير دي الأفاتار بيسمع نفسه
        noiseSuppression: true,
        autoGainControl: true,
        channelCount: 1,
      },
    });

    const AC = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AC();
    if (this.ctx.state === "suspended") await this.ctx.resume();

    const src = this.ctx.createMediaStreamSource(this.stream);
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 1024;
    this.analyser.smoothingTimeConstant = 0.1;
    src.connect(this.analyser);
    this.buf = new Uint8Array(this.analyser.fftSize);

    this.mime = pickMime();
  }

  _startRecorder() {
    if (!this.stream) return;
    this.chunks = [];
    try {
      this.recorder = new MediaRecorder(
        this.stream,
        this.mime ? { mimeType: this.mime, audioBitsPerSecond: 64000 } : undefined
      );
    } catch (err) {
      this.onError?.(err);
      return;
    }
    this.recorder.ondataavailable = (e) => {
      if (e.data?.size > 0) this.chunks.push(e.data);
    };
    this.recorder.start(120);
    this._recStartAt = performance.now();
  }

  /** يوقف المسجّل ويرجّع الـ Blob (أو null لو مفيش حاجة). */
  _stopRecorder() {
    return new Promise((resolve) => {
      const rec = this.recorder;
      if (!rec || rec.state === "inactive") return resolve(null);
      rec.onstop = () => {
        const blob = this.chunks.length
          ? new Blob(this.chunks, { type: this.mime || "audio/webm" })
          : null;
        this.chunks = [];
        resolve(blob);
      };
      try { rec.stop(); } catch { resolve(null); }
    });
  }

  async start() {
    if (this.listening) return;
    await this.init();
    this.listening = true;
    this.speaking = false;
    this.floor = 0.01;
    this._startRecorder();
    this._tick();
  }

  async stop() {
    this.listening = false;
    this.speaking = false;
    cancelAnimationFrame(this._raf);
    await this._stopRecorder();
    this.recorder = null;
  }

  release() {
    this.stop();
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.ctx?.close();
    this.ctx = null;
  }

  _rms() {
    this.analyser.getByteTimeDomainData(this.buf);
    let sum = 0;
    for (let i = 0; i < this.buf.length; i++) {
      const v = (this.buf[i] - 128) / 128;
      sum += v * v;
    }
    return Math.sqrt(sum / this.buf.length);
  }

  _tick = () => {
    if (!this.listening) return;
    this._raf = requestAnimationFrame(this._tick);

    const rms = this._rms();
    this.level = this.level + (rms - this.level) * 0.35;
    this.onLevel?.(Math.min(1, this.level * 4));

    const now = performance.now();

    // عايرة أرضية الضوضاء وقت السكوت بس، وببطء
    if (!this.speaking) {
      this.floor = this.floor * 0.995 + rms * 0.005;
    }
    const threshold = Math.max(this.floor * 2.8, 0.011);
    const loud = rms > threshold;

    if (!this.speaking) {
      if (loud) {
        if (!this._onsetAt) this._onsetAt = now;
        if (now - this._onsetAt >= ONSET_MS) {
          this.speaking = true;
          this._speechStartAt = now;
          this._silenceAt = 0;
          this.onSpeechStart?.();
        }
      } else {
        this._onsetAt = 0;
        // إعادة تشغيل دورية عشان السكوت اللي قبل الكلام ميتراكمش
        if (now - this._recStartAt > IDLE_RESET_MS) {
          this._stopRecorder().then(() => {
            if (this.listening && !this.speaking) this._startRecorder();
          });
        }
      }
      return;
    }

    // بيتكلم — نستنى السكوت
    const tooLong = now - this._speechStartAt > MAX_SPEECH_MS;
    if (loud) {
      this._silenceAt = 0;
    } else if (!this._silenceAt) {
      this._silenceAt = now;
    }

    if (tooLong || (this._silenceAt && now - this._silenceAt >= SILENCE_MS)) {
      const dur = now - this._speechStartAt;
      this.speaking = false;
      this._onsetAt = 0;
      this._silenceAt = 0;

      this._stopRecorder().then((blob) => {
        if (this.listening) this._startRecorder();
        if (blob && dur >= MIN_SPEECH_MS) this.onSpeechEnd?.(blob);
      });
    }
  };
}
