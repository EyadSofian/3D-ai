/**
 * الأفاتار — مشهد three.js + موديل فيه blendshapes أصلية.
 *
 * الافتراضي شخصية RocketBox (MIT): 52 ARKit + 15 Oculus viseme معمولين
 * بإيد فنان، وسنان ولسان geometry منفصلة — الفم بيتفتح على تجويف حقيقي.
 * الكود بيشتغل مع أي موديل بنفس التسمية (Avaturn، RPM قديم، …).
 *
 * حاجة مهمة: نفس الـ morph target بيبقى موجود على أكتر من mesh
 * (الوش + السنان + الدقن + العينين). لازم نغيّرهم كلهم مع بعض،
 * وإلا الفم هيفتح والسنان هتفضل مكانها.
 */

import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { SMAAPass } from "three/addons/postprocessing/SMAAPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { EMOTIONS } from "./expressions.js";

const VISEME_PREFIX = "viseme_";

/**
 * معايرة الحركة. القيم دي هي الفرق بين "فم بينطّ" و"حد بيتكلم".
 *
 * أهم اتنين:
 *  • smooth  — سرعة سحب كل morph لهدفه. من غيرها الشفايف بتقفز كل frame
 *              وبتبان ميكانيكية. القيمة أعلى = أسرع وأحدّ.
 *  • jawGain — الفك بيتفتح قد إيه. الكلام العادي بيفتح ثلث الفتحة تقريبًا،
 *              مش على الآخر. القيمة العالية بتخلي الأفاتار كإنه بيزعّق.
 */
const LIP = {
  smooth: 21,      // تنعيم الشفايف والفك (1/ثانية)
  faceSmooth: 7,   // التعبيرات بتتحرك أبطأ من الشفايف
  emoSmooth: 2.6,  // الانتقال بين المشاعر — بطيء عشان يبان طبيعي
  jawGain: 0.52,
  closeGain: 0.75,
  roundGain: 0.55,
  wideGain: 0.30,
  visemeGain: 0.72,
};

/** أسماء ARKit اللي بنشتغل عليها كطبقة تانية فوق الـ visemes. */
const ARKIT = {
  jaw: ["jawOpen"],
  close: ["mouthClose"],
  round: ["mouthFunnel", "mouthPucker"],
  wide: ["mouthSmileLeft", "mouthSmileRight"],
  blink: ["eyeBlinkLeft", "eyeBlinkRight"],
  browUp: ["browInnerUp"],
  browDown: ["browDownLeft", "browDownRight"],
};

/** الشفايف بتتحرك أسرع من باقي الوش، والرمشة أسرع من الاتنين. */
const LIP_MORPHS = new Set([
  ...ARKIT.jaw, ...ARKIT.close, ...ARKIT.round, ...ARKIT.wide,
]);
const BLINK_MORPHS = new Set(ARKIT.blink);

/**
 * لمسة الإنهاء. الحاجات دي هي اللي بتفرّق بين "رندر ويب" و"صورة متصوّرة":
 *  • vignette  — بيسحب عين المتفرج لوش الأفاتار
 *  • حبيبات    — بتكسر التدرّجات الرقمية النضيفة أوي
 *  • دفا خفيف  — الجلد بيبان ميت من غير مِيل للدفا
 */
const GRADE = {
  bloom: 0.0,        // متخليهاش فوق 0.15 مع لبس فاتح
  vignette: 0.30,
  grain: 0.012,
  warmth: 0.015,
  saturation: 1.05,
};

const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    vignette: { value: GRADE.vignette },
    grain: { value: GRADE.grain },
    warmth: { value: GRADE.warmth },
    saturation: { value: GRADE.saturation },
    time: { value: 0 },
  },
  vertexShader: `varying vec2 vUv;
    void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform float vignette, grain, warmth, saturation, time;
    varying vec2 vUv;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    void main(){
      vec4 t = texture2D(tDiffuse, vUv);
      vec3 c = t.rgb;

      c.r += warmth; c.b -= warmth * 0.7;              // دفا
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      c = mix(vec3(l), c, saturation);                  // تشبّع

      vec2 d = vUv - 0.5;
      c *= 1.0 - vignette * dot(d, d) * 0.85;           // vignette

      // الحبيبات على الأفاتار بس. لو اتحطت على البكسلات الفاضية بتبان
      // كضوضاء فوق خلفية الصفحة.
      c += (hash(vUv * 1024.0 + time) - 0.5) * grain * t.a;

      gl_FragColor = vec4(c, t.a);   // ← الشفافية لازم تعدّي زي ما هي
    }`,
};

const lerp = (a, b, t) => a + (b - a) * t;
const damp = (a, b, l, dt) => lerp(a, b, 1 - Math.exp(-l * dt));
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** أوضاع الجسم لكل حالة */
const POSES = {
  idle:      { lean: 0.00, tilt: 0.00, brow: 0.00, breathe: 1.00, blinkRate: 4.2, gaze: 1.0 },
  listening: { lean: 0.07, tilt: 0.08, brow: 0.30, breathe: 0.85, blinkRate: 3.0, gaze: 0.3 },
  thinking:  { lean: -0.05, tilt: -0.07, brow: -0.28, breathe: 1.10, blinkRate: 5.2, gaze: 0.0 },
  speaking:  { lean: 0.04, tilt: 0.02, brow: 0.16, breathe: 0.80, blinkRate: 3.6, gaze: 0.6 },
};

export class Avatar {
  constructor(mount) {
    this.mount = mount;
    this.ready = false;
    this.state = "idle";
    this.report = null;   // تشخيص: إيه اللي اتلاقى في الموديل

    this.morphs = new Map();   // اسم -> [{mesh, index}]
    this.bones = {};
    this.rest = {};

    this.pointer = { x: 0, y: 0 };
    this.anim = {
      lean: 0, tilt: 0, brow: 0, breathe: 1,
      blink: 0, nextBlink: 2.5,
      gazeX: 0, gazeY: 0, gazeTX: 0, gazeTY: 0, nextGaze: 2.5,
      jaw: 0, round: 0, wide: 0, close: 0,
      visemes: Object.create(null),
      emo: Object.create(null),       // أوزان التعبير الحالية (بتتمزج بالتدريج)
      emoTarget: Object.create(null), // اللي رايحين ليه
      mouthBias: 0,                   // التعبير بيفتح/يقفل الفم شوية
      headTilt: 0,
      micro: 0, nextMicro: 3,         // تعبيرات دقيقة عشوائية
    };
    this.skinMaterials = [];
    /** القيمة المطبّقة حاليًا لكل morph — دي أساس التنعيم. */
    this._applied = new Map();
    this.emotion = "neutral";

    this._onPointer = (e) => {
      const r = this.mount.getBoundingClientRect();
      this.pointer.x = ((e.clientX - r.left) / r.width) * 2 - 1;
      this.pointer.y = ((e.clientY - r.top) / r.height) * 2 - 1;
    };
    this._onResize = () => this.resize();
  }

  /* ─────────────────────────── التحميل ─────────────────────────── */

  async load(url) {
    this._buildScene();

    const gltf = await new Promise((res, rej) =>
      new GLTFLoader().load(url, res, undefined, rej)
    );

    this.model = gltf.scene;
    this.model.traverse((o) => {
      if (!(o.isMesh || o.isSkinnedMesh)) return;
      o.frustumCulled = false;           // بيمنع اختفاء الراسة عند زوايا معيّنة
      o.castShadow = false;
      const m = o.material;
      if (!m) return;
      m.envMapIntensity = 1.15;

      // الجلد: three.js مفيهاش SSS حقيقي، بس الـ sheen بيدّي نفس الإحساس —
      // هالة دافية على الحواف زي ما الضوء بيعدّي جوه الجلد ويخرج. من غيرها
      // الوش بيبان بلاستيك مهما كانت الإضاءة مظبوطة.
      if (/skin|head|body/i.test(m.name || "") && m.isMeshStandardMaterial) {
        const sk = new THREE.MeshPhysicalMaterial();
        THREE.MeshStandardMaterial.prototype.copy.call(sk, m);
        sk.sheen = 0.55;
        sk.sheenColor = new THREE.Color(0xff9d7a);
        sk.sheenRoughness = 0.72;
        sk.roughness = Math.min(0.82, (m.roughness ?? 0.7) + 0.06);
        sk.envMapIntensity = 1.25;
        o.material = sk;
        this.skinMaterials.push(sk);
      }
    });
    this.scene.add(this.model);

    this._indexMorphs();
    this._indexBones();
    this._frameHead();

    this.report = this._diagnose();
    this.ready = true;

    this.mount.addEventListener("pointermove", this._onPointer);
    window.addEventListener("resize", this._onResize);
    this._loop();

    return this.report;
  }

  _buildScene() {
    const w = this.mount.clientWidth || 480;
    const h = this.mount.clientHeight || 560;

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
    this.renderer.setSize(w, h);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.16;
    this.mount.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();

    // إضاءة بيئية من RoomEnvironment — بتدي بشرة واقعية من غير أي ملفات خارجية
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();

    // إضاءة تلات نقط. الـ rim هو اللي بيفصل الأفاتار عن الخلفية الغامقة —
    // من غيره الحواف بتدوب في السواد والصورة بتبان مسطّحة.
    const key = new THREE.DirectionalLight(0xfff2e4, 2.35);
    key.position.set(1.4, 2.4, 2.2);
    this.scene.add(key);

    const fill = new THREE.DirectionalLight(0xd4e4ff, 0.85);
    fill.position.set(-2.0, 0.8, 1.2);
    this.scene.add(fill);

    const rim = new THREE.DirectionalLight(0xffd2a0, 1.75);
    rim.position.set(-1.1, 1.9, -2.4);
    this.scene.add(rim);

    const rim2 = new THREE.DirectionalLight(0xa9c6ff, 0.95);
    rim2.position.set(1.6, 1.2, -2.0);
    this.scene.add(rim2);

    // ارتداد من تحت — الضوء اللي بينط من الصدر على الدقن والفك.
    // حيلة قديمة في تصوير البورتريه وبتفرق جدًا في الوش الثلاثي الأبعاد.
    const bounce = new THREE.DirectionalLight(0xffd9c4, 0.55);
    bounce.position.set(0, -1.4, 1.8);
    this.scene.add(bounce);

    this.camera = new THREE.PerspectiveCamera(26, w / h, 0.05, 60);
    this.clock = new THREE.Clock();
    this._buildComposer(w, h);
  }

  /**
   * سلسلة الإنهاء. الرندر الخام في three.js بيطلع نضيف أوي وحاد أوي —
   * والعين بتقراه كـ "جرافيك" مش كـ صورة. التلات خطوات دول بيقفلوا
   * الفرق ده من غير ما يكلفوا كتير على الأداء.
   */
  _buildComposer(w, h) {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    this.composer = new EffectComposer(this.renderer);
    this.composer.setPixelRatio(dpr);
    this.composer.setSize(w, h);

    // الخلفية بتاعة الصفحة بتبان من ورا الأفاتار، فالسلسلة كلها لازم
    // تحافظ على القناة الرابعة — أي pass بيكتب alpha=1 بيمسحها.
    const rp = new RenderPass(this.scene, this.camera);
    rp.clearAlpha = 0;
    this.composer.addPass(rp);

    // مفيش bloom افتراضيًا. جرّبناه وطلع ضار هنا: الغترة بيضا، وأي عتبة
    // بتلمسها بتحوّلها للمبة. سيبناه متاح لو الموديل اتغيّر للبس غامق.
    if (GRADE.bloom > 0) {
      this.composer.addPass(
        new UnrealBloomPass(new THREE.Vector2(w, h), GRADE.bloom, 0.4, 0.995));
    }

    this.grade = new ShaderPass(GradeShader);
    this.composer.addPass(this.grade);

    // الحواف المتدرّجة أهم حاجة في وش قريب من الكاميرا
    if (dpr < 2) this.composer.addPass(new SMAAPass(w * dpr, h * dpr));

    this.composer.addPass(new OutputPass());
  }

  /** يبني فهرس: اسم الـ morph -> كل الـ meshes اللي عندها الاسم دا. */
  _indexMorphs() {
    this.model.traverse((o) => {
      if (!o.morphTargetDictionary || !o.morphTargetInfluences) return;
      for (const [name, idx] of Object.entries(o.morphTargetDictionary)) {
        if (!this.morphs.has(name)) this.morphs.set(name, []);
        this.morphs.get(name).push({ mesh: o, index: idx });
      }
    });
  }

  _indexBones() {
    this.model.traverse((o) => {
      if (!o.isBone) return;
      const n = o.name;
      if (!this.bones.head && /^head$/i.test(n)) this.bones.head = o;
      else if (!this.bones.neck && /^neck$/i.test(n)) this.bones.neck = o;
      else if (!this.bones.spine && /^spine2$/i.test(n)) this.bones.spine = o;
      else if (!this.bones.eyeL && /^lefteye$/i.test(n)) this.bones.eyeL = o;
      else if (!this.bones.eyeR && /^righteye$/i.test(n)) this.bones.eyeR = o;
    });
    for (const [k, b] of Object.entries(this.bones)) {
      this.rest[k] = { x: b.rotation.x, y: b.rotation.y, z: b.rotation.z };
    }
  }

  /**
   * يظبّط الكاميرا على الراسة والكتاف — بيتحسب من أبعاد الموديل نفسه،
   * فبيشتغل مع أفاتار كامل الجسم (RPM) ومع تمثال نصفي (Meshy) على السواء.
   */
  _frameHead() {
    this.model.updateWorldMatrix(true, true);
    const box = new THREE.Box3().setFromObject(this.model);
    const size = box.getSize(new THREE.Vector3());
    const mid = box.getCenter(new THREE.Vector3());

    let target, viewH;
    const mouth = this._findMouth();
    if (this.bones.head) {
      target = this.bones.head.getWorldPosition(new THREE.Vector3());
      target.y += size.y * 0.02;
      viewH = size.y * 0.30;                 // موديل كامل: راسة + كتاف
    } else if (mouth) {
      // مفيش عضم بس فيه visemes — الفم نفسه بيحدّد الكادر. دي أضبط طريقة
      // لأنها مبتفترضش إن الموديل نص ولا كامل: من الفم لأعلى نقطة = الراسة.
      target = new THREE.Vector3(mouth.x, mouth.y + (box.max.y - mouth.y) * 0.34, mouth.z);
      viewH = Math.max(0.12, (box.max.y - mouth.y) * 2.45);
    } else {
      target = new THREE.Vector3(mid.x, box.max.y - size.y * 0.30, mid.z);
      viewH = size.y * 0.62;                 // تمثال نصفي: الجزء العلوي
    }

    const fov = THREE.MathUtils.degToRad(this.camera.fov);
    const dist = (viewH / 2) / Math.tan(fov / 2);
    this.camera.position.set(target.x, target.y, box.max.z + dist);
    this.camera.lookAt(target);
    this.lookTarget = target.clone();

    // موديل من غير عضم (سكان/Meshy): محصلش رِجّ، فبنحرّك الموديل كله
    // حوالين نقطة عند قاعدة الرقبة. بيدّي نفس إحساس التفاتة الراسة.
    if (!this.bones.head) {
      this.pivot = new THREE.Group();
      const neckY = mouth ? mouth.y - (box.max.y - mouth.y) * 1.15
                          : box.max.y - size.y * 0.72;
      this.pivot.position.set(mid.x, neckY, mid.z);
      this.scene.remove(this.model);
      this.model.position.sub(this.pivot.position);
      this.pivot.add(this.model);
      this.scene.add(this.pivot);
    }
  }

  /**
   * فين الفم؟ الـ morph targets بتحرّك vertices الوش بس، فمركز أكتر
   * النقط اللي بتتحرك في `jawOpen`/`viseme_aa` هو الفم — من غير ما نفترض
   * حاجة عن شكل الموديل ولا نعتمد على أسماء meshes.
   */
  _findMouth() {
    for (const key of ["jawOpen", "viseme_aa", "mouthFunnel"]) {
      const list = this.morphs.get(key);
      if (!list) continue;
      for (const { mesh, index } of list) {
        const attr = mesh.geometry?.morphAttributes?.position?.[index];
        if (!attr) continue;
        let best = 0;
        for (let i = 0; i < attr.count; i++) {
          const d = Math.hypot(attr.getX(i), attr.getY(i), attr.getZ(i));
          if (d > best) best = d;
        }
        if (best <= 1e-6) continue;
        const cut = best * 0.35, p = mesh.geometry.attributes.position;
        const c = new THREE.Vector3();
        let n = 0;
        for (let i = 0; i < attr.count; i++) {
          if (Math.hypot(attr.getX(i), attr.getY(i), attr.getZ(i)) < cut) continue;
          c.x += p.getX(i); c.y += p.getY(i); c.z += p.getZ(i); n++;
        }
        if (!n) continue;
        return mesh.localToWorld(c.divideScalar(n));
      }
    }
    return null;
  }

  /**
   * التعبير الحالي. الانتقال بيحصل بالتدريج في الحلقة، مش فجأة.
   * intensity بتسمح بنفس التعبير بشدة مختلفة (مثلاً ابتسامة خفيفة).
   */
  setEmotion(name, intensity = 1) {
    const e = EMOTIONS[name] ? name : "neutral";
    this.emotion = e;
    const t = Object.create(null);
    for (const [k, v] of Object.entries(EMOTIONS[e])) t[k] = v * intensity;
    this.anim.emoTarget = t;
  }

  /** تشخيص واضح: الموديل فيه إيه فعلًا؟ */
  _diagnose() {
    const all = [...this.morphs.keys()];
    const visemes = all.filter((n) => n.startsWith(VISEME_PREFIX));
    const arkit = Object.values(ARKIT).flat().filter((n) => this.morphs.has(n));
    const meshes = new Set();
    for (const list of this.morphs.values()) for (const m of list) meshes.add(m.mesh.name);

    return {
      totalMorphs: all.length,
      visemes: visemes.sort(),
      arkit: arkit.sort(),
      meshesWithMorphs: [...meshes],
      bones: Object.keys(this.bones),
      canLipSync: visemes.length > 0 || this.morphs.has("jawOpen"),
      rigged: Object.keys(this.bones).length > 0,
    };
  }

  /* ─────────────────────────── التحكّم ─────────────────────────── */

  setState(name) {
    if (POSES[name]) this.state = name;
  }

  /** الناتج من LipSync.sample() */
  applyLipSync(frame) {
    const a = this.anim;
    if (!frame) {
      a.visemes = Object.create(null);
      a.jaw = a.round = a.wide = a.close = 0;
      return;
    }
    a.visemes = frame.weights;
    a.jaw = frame.jaw;
    a.round = frame.round;
    a.wide = frame.wide;
    a.close = frame.close;
  }

  /** يحط قيمة على كل الـ meshes اللي عندها الـ morph دا (وش + سنان + دقن). */
  _setMorph(name, value) {
    const list = this.morphs.get(name);
    if (!list) return false;
    const v = clamp01(value);
    for (const { mesh, index } of list) mesh.morphTargetInfluences[index] = v;
    return true;
  }

  _setMorphGroup(names, value) {
    let hit = false;
    for (const n of names) hit = this._setMorph(n, value) || hit;
    return hit;
  }

  /* ──────────────────────────── الحلقة ──────────────────────────── */

  _loop = () => {
    this._raf = requestAnimationFrame(this._loop);
    const dt = Math.min(this.clock.getDelta(), 0.1);
    const t = this.clock.elapsedTime;
    const a = this.anim;
    const pose = POSES[this.state];

    /* الوضعية العامة */
    a.lean = damp(a.lean, pose.lean, 3.2, dt);
    a.tilt = damp(a.tilt, pose.tilt, 3.0, dt);
    a.brow = damp(a.brow, pose.brow, 4.0, dt);
    a.breathe = damp(a.breathe, pose.breathe, 2.0, dt);

    /* الرمش */
    a.nextBlink -= dt;
    if (a.nextBlink <= 0) {
      a.blink = 1;
      a.nextBlink = pose.blinkRate * (0.6 + Math.random() * 0.9);
    }
    a.blink = Math.max(0, a.blink - dt * 11);
    const blink = Math.sin(Math.min(1, a.blink) * Math.PI);

    /* النظرة — بتتبع الماوس وبتسرح لوحدها */
    a.nextGaze -= dt;
    if (a.nextGaze <= 0) {
      a.gazeTX = (Math.random() - 0.5) * 0.5 * pose.gaze;
      a.gazeTY = (Math.random() - 0.5) * 0.3 * pose.gaze;
      a.nextGaze = 1.6 + Math.random() * 2.6;
    }
    a.gazeX = damp(a.gazeX, a.gazeTX + this.pointer.x * 0.30, 3.0, dt);
    a.gazeY = damp(a.gazeY, a.gazeTY - this.pointer.y * 0.18, 3.0, dt);

    /* عضم الراسة والرقبة والجذع */
    const breath = Math.sin(t * 1.15 * a.breathe) * 0.014;
    const sway = Math.sin(t * 0.42) * 0.028 + Math.sin(t * 0.27) * 0.018;

    if (this.pivot) {
      // مفيش عضم — بنلوي الجذع كله بشكل خفيف حوالين قاعدة الرقبة
      this.pivot.rotation.y = a.gazeX * 0.30 + sway * 0.8;
      this.pivot.rotation.x = a.gazeY * 0.18 + a.lean * 0.30 + breath;
      this.pivot.rotation.z = (a.tilt + a.headTilt * 0.35) * 0.30;
    }
    if (this.bones.head) {
      const r = this.rest.head;
      this.bones.head.rotation.y = r.y + a.gazeX * 0.42 + sway;
      this.bones.head.rotation.x = r.x + a.gazeY * 0.30 + a.lean * 0.5 + breath;
      this.bones.head.rotation.z = r.z + a.tilt * 0.5;
    }
    if (this.bones.neck) {
      const r = this.rest.neck;
      this.bones.neck.rotation.y = r.y + a.gazeX * 0.20 + sway * 0.5;
      this.bones.neck.rotation.x = r.x + a.gazeY * 0.14 + a.lean * 0.35;
      this.bones.neck.rotation.z = r.z + a.tilt * 0.28;
    }
    if (this.bones.spine) {
      const r = this.rest.spine;
      this.bones.spine.rotation.x = r.x + breath * 0.7 + a.lean * 0.2;
      this.bones.spine.rotation.y = r.y + sway * 0.3;
    }
    for (const eye of [this.bones.eyeL, this.bones.eyeR]) {
      if (!eye) continue;
      const k = eye === this.bones.eyeL ? "eyeL" : "eyeR";
      eye.rotation.y = this.rest[k].y + a.gazeX * 0.34;
      eye.rotation.x = this.rest[k].x + a.gazeY * 0.24;
    }

    /* ─── التعبير: امزج ناحية الهدف بالتدريج، مش قفزة ─── */
    const emo = a.emo, tgt = a.emoTarget;
    for (const k in tgt) if (!(k in emo)) emo[k] = 0;
    for (const k in emo) emo[k] = damp(emo[k], tgt[k] || 0, LIP.emoSmooth, dt);
    a.mouthBias = emo.mouthBias || 0;
    a.headTilt = emo.headTilt || 0;

    /* تعبيرات دقيقة عشوائية — الوش الساكن تمامًا بيبان ميت حتى لو الفم شغال */
    a.nextMicro -= dt;
    if (a.nextMicro <= 0) {
      a.micro = 0.25 + Math.random() * 0.45;
      a.nextMicro = 2.2 + Math.random() * 4.5;
    }
    a.micro = Math.max(0, a.micro - dt * 0.8);

    /* ─── ابنِ هدف كل morph في مكان واحد ───
       لازم نجمّع مش نكتب فوق بعض: نفس الاسم ممكن ييجي من التعبير ومن
       الشفايف مع بعض (mouthSmile مثلاً). */
    const T = Object.create(null);
    const add = (n, v) => { if (v) T[n] = (T[n] || 0) + v; };
    const addAll = (names, v) => { for (const n of names) add(n, v); };

    for (const k in emo) {
      if (k === "mouthBias" || k === "headTilt") continue;
      add(k, emo[k]);
    }
    for (const [v, w] of Object.entries(a.visemes)) {
      add(VISEME_PREFIX + v, w * LIP.visemeGain);
    }
    addAll(ARKIT.jaw, clamp01(a.jaw + a.mouthBias * 0.30) * LIP.jawGain);
    addAll(ARKIT.close, a.close * LIP.closeGain);
    addAll(ARKIT.round, a.round * LIP.roundGain);
    addAll(ARKIT.wide, a.wide * LIP.wideGain);
    addAll(ARKIT.blink, blink);
    addAll(ARKIT.browUp, Math.max(0, a.brow) + a.micro * 0.22);
    addAll(ARKIT.browDown, Math.max(0, -a.brow));

    /* ─── طبّق — كل قيمة بتتسحب لهدفها بدل ما تقفز عليه ───
       دي أهم سطور في الملف. من غيرها الشفايف بتتغير فجأة كل frame
       وبتبان ميكانيكية مهما كان الجدول الزمني مظبوط. */
    for (const name of this.morphs.keys()) {
      const want = clamp01(T[name] || 0);
      const rate = BLINK_MORPHS.has(name) ? 45          // الرمشة لازم تفضل حادة
        : (name.startsWith(VISEME_PREFIX) || LIP_MORPHS.has(name)) ? LIP.smooth
        : LIP.faceSmooth;
      const cur = damp(this._applied.get(name) || 0, want, rate, dt);
      this._applied.set(name, cur < 1e-4 ? 0 : cur);
      this._setMorph(name, cur);
    }

    if (this.grade) this.grade.uniforms.time.value = t;
    (this.composer || this.renderer).render(this.scene, this.camera);
  };

  resize() {
    if (!this.renderer) return;
    const w = this.mount.clientWidth || 480;
    const h = this.mount.clientHeight || 560;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
    this.composer?.setSize(w, h);
  }

  dispose() {
    cancelAnimationFrame(this._raf);
    this.mount.removeEventListener("pointermove", this._onPointer);
    window.removeEventListener("resize", this._onResize);
    this.renderer?.dispose();
  }
}
