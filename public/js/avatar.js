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

const VISEME_PREFIX = "viseme_";

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
    };

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
      if (o.isMesh || o.isSkinnedMesh) {
        o.frustumCulled = false;         // بيمنع اختفاء الراسة عند زوايا معيّنة
        o.castShadow = false;
        if (o.material) o.material.envMapIntensity = 0.9;
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
    this.renderer.toneMappingExposure = 1.05;
    this.mount.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();

    // إضاءة بيئية من RoomEnvironment — بتدي بشرة واقعية من غير أي ملفات خارجية
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();

    const key = new THREE.DirectionalLight(0xffffff, 2.1);
    key.position.set(1.4, 2.4, 2.2);
    this.scene.add(key);

    const fill = new THREE.DirectionalLight(0xd8e6ff, 0.7);
    fill.position.set(-2.0, 0.8, 1.2);
    this.scene.add(fill);

    const rim = new THREE.DirectionalLight(0xffd9b0, 1.1);
    rim.position.set(-0.6, 1.6, -2.4);
    this.scene.add(rim);

    this.camera = new THREE.PerspectiveCamera(26, w / h, 0.05, 60);
    this.clock = new THREE.Clock();
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
      this.pivot.rotation.z = a.tilt * 0.30;
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

    /* الشفايف: الـ visemes الأول، وبعدين ARKit فوقيها */
    for (const name of this.morphs.keys()) {
      if (name.startsWith(VISEME_PREFIX)) this._setMorph(name, 0);
    }
    for (const [v, w] of Object.entries(a.visemes)) {
      this._setMorph(VISEME_PREFIX + v, w);
    }
    this._setMorphGroup(ARKIT.jaw, a.jaw * 0.82);
    this._setMorphGroup(ARKIT.close, a.close * 0.7);
    this._setMorphGroup(ARKIT.round, a.round * 0.6);
    this._setMorphGroup(ARKIT.wide, a.wide * 0.35);
    this._setMorphGroup(ARKIT.blink, blink);
    this._setMorphGroup(ARKIT.browUp, Math.max(0, a.brow));
    this._setMorphGroup(ARKIT.browDown, Math.max(0, -a.brow));

    this.renderer.render(this.scene, this.camera);
  };

  resize() {
    if (!this.renderer) return;
    const w = this.mount.clientWidth || 480;
    const h = this.mount.clientHeight || 560;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  }

  dispose() {
    cancelAnimationFrame(this._raf);
    this.mount.removeEventListener("pointermove", this._onPointer);
    window.removeEventListener("resize", this._onResize);
    this.renderer?.dispose();
  }
}
