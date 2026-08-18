#!/usr/bin/env python3
"""
rig_avatar.py — بياخد موديل GLB ساكن (Meshy / أي سكان) وبيطلّع نسخة
فيها blendshapes حقيقية للنطق: 15 Oculus viseme + أسماء ARKit.

الفكرة: بنحدد منطقة الفم من الـ texture نفسها (الشفايف والسنان المرسومة)،
وبنبني منها ٤ تشوّهات أساسية — فتح الفك، تدوير الشفايف، فردها، ضمّها —
وبعدين كل viseme = خلطة من الأربعة دول بنفس النِسَب اللي في visemes-ar.js.

    python3 tools/rig_avatar.py <input.glb> <output.glb>
"""
import sys, io, json, struct, array
import numpy as np
from PIL import Image

# نفس جدول الأشكال اللي في public/js/visemes-ar.js — لازم يفضلوا متطابقين
SHAPE = {
    "sil": (0.00, 0.00, 0.00, 0.00),
    "PP":  (0.02, 0.10, 0.00, 1.00),
    "FF":  (0.14, 0.05, 0.25, 0.30),
    "TH":  (0.22, 0.00, 0.30, 0.00),
    "DD":  (0.24, 0.00, 0.25, 0.00),
    "kk":  (0.28, 0.05, 0.15, 0.00),
    "CH":  (0.20, 0.60, 0.00, 0.00),
    "SS":  (0.12, 0.00, 0.55, 0.00),
    "nn":  (0.16, 0.00, 0.20, 0.00),
    "RR":  (0.24, 0.35, 0.10, 0.00),
    "aa":  (0.90, 0.00, 0.15, 0.00),
    "E":   (0.45, 0.00, 0.60, 0.00),
    "I":   (0.26, 0.00, 0.90, 0.00),
    "O":   (0.58, 0.75, 0.00, 0.00),
    "U":   (0.28, 1.00, 0.00, 0.00),
}

JAW_ANGLE = 0.115  # راديان عند فتح كامل (صغيرة عن قصد — شوف ملاحظة السنان تحت)
ROUND_AMT = 0.042  # وحدات — بنعوّض بشكل الشفايف بدل الفتحة
WIDE_AMT  = 0.044
CLOSE_AMT = 0.020


def smooth(t):
    t = np.clip(t, 0, 1)
    return t * t * (3 - 2 * t)


# ─────────────────────────── قراءة GLB ───────────────────────────

def load_glb(path):
    d = open(path, "rb").read()
    magic, ver, total = struct.unpack("<III", d[:12])
    assert magic == 0x46546C67, "مش ملف GLB"
    off, js, bin_ = 12, None, b""
    while off < total:
        clen, ctype = struct.unpack("<II", d[off:off + 8])
        chunk = d[off + 8: off + 8 + clen]
        if ctype == 0x4E4F534A: js = json.loads(chunk.decode("utf-8"))
        elif ctype == 0x004E4942: bin_ = chunk
        off += 8 + clen
    return js, bytearray(bin_)


def read_accessor(J, BIN, idx):
    a = J["accessors"][idx]
    bv = J["bufferViews"][a["bufferView"]]
    o = bv.get("byteOffset", 0) + a.get("byteOffset", 0)
    ncomp = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4}[a["type"]]
    fmt = {5126: "f", 5125: "I", 5123: "H", 5121: "B"}[a["componentType"]]
    arr = array.array(fmt)
    arr.frombytes(BIN[o: o + a["count"] * ncomp * arr.itemsize])
    return np.array(arr).reshape(-1, ncomp)


def add_vec3_accessor(J, BIN, data):
    """يزوّد bufferView + accessor لمصفوفة VEC3 ويرجّع رقم الـ accessor."""
    raw = np.asarray(data, dtype="<f4").tobytes()
    while len(BIN) % 4:            # glTF عايز محاذاة 4 بايت
        BIN += b"\x00"
    off = len(BIN)
    BIN += raw
    J["bufferViews"].append({"buffer": 0, "byteOffset": off, "byteLength": len(raw)})
    J["accessors"].append({
        "bufferView": len(J["bufferViews"]) - 1,
        "componentType": 5126, "count": len(data), "type": "VEC3",
        "min": [float(x) for x in np.min(data, 0)],
        "max": [float(x) for x in np.max(data, 0)],
    })
    return len(J["accessors"]) - 1


def write_glb(path, J, BIN):
    J["buffers"] = [{"byteLength": len(BIN)}]
    js = json.dumps(J, separators=(",", ":")).encode("utf-8")
    js += b" " * ((4 - len(js) % 4) % 4)
    bn = bytes(BIN) + b"\x00" * ((4 - len(BIN) % 4) % 4)
    total = 12 + 8 + len(js) + 8 + len(bn)
    with open(path, "wb") as f:
        f.write(struct.pack("<III", 0x46546C67, 2, total))
        f.write(struct.pack("<II", len(js), 0x4E4F534A)); f.write(js)
        f.write(struct.pack("<II", len(bn), 0x004E4942)); f.write(bn)
    return total


# ───────────────────── تحديد الفم من الـ texture ─────────────────────

def find_mouth(J, BIN, P, UV):
    """يرجّع (مركز الفم, نصف عرضه) من ألوان الشفايف/السنان المرسومة."""
    tex_i = J["materials"][0]["pbrMetallicRoughness"]["baseColorTexture"]["index"]
    img_i = J["textures"][tex_i]["source"]
    bv = J["bufferViews"][J["images"][img_i]["bufferView"]]
    o = bv.get("byteOffset", 0)
    im = Image.open(io.BytesIO(bytes(BIN[o: o + bv["byteLength"]]))).convert("RGB")
    T = np.asarray(im); H, W, _ = T.shape

    u = np.clip((UV[:, 0] % 1.0) * (W - 1), 0, W - 1).astype(int)
    v = np.clip((1 - UV[:, 1] % 1.0) * (H - 1), 0, H - 1).astype(int)
    C = T[v, u].astype(float)
    R, G, B = C[:, 0], C[:, 1], C[:, 2]
    mx, mn = C.max(1), C.min(1)
    sat = np.where(mx > 0, (mx - mn) / np.maximum(mx, 1), 0)

    ymin, ymax = P[:, 1].min(), P[:, 1].max()
    span = ymax - ymin
    # طرف المناخير = أبعد نقطة لقدّام في النص العلوي من الوش
    upper = (P[:, 1] > ymin + 0.45 * span) & (np.abs(P[:, 0]) < 0.15 * (P[:, 0].max() - P[:, 0].min()))
    nose_y = P[upper][np.argmax(P[upper][:, 2])][1] if upper.sum() else ymin + 0.6 * span
    zfront = np.percentile(P[:, 2], 97)

    zone = ((P[:, 1] < nose_y - 0.01) & (P[:, 1] > nose_y - 0.40 * span) &
            (P[:, 2] > 0.62 * zfront) & (np.abs(P[:, 0]) < 0.24 * span))

    teeth = zone & (mx > 200) & (sat < 0.16)
    lips  = zone & (R > G + 14) & (R > B + 20) & (sat > 0.20) & (mx < 235)
    sel = teeth | lips
    if sel.sum() < 8:
        sel = zone
    pts = P[sel]
    centre = np.array([0.0, np.median(pts[:, 1]), np.percentile(pts[:, 2], 80)])
    half_w = max(np.percentile(np.abs(pts[:, 0]), 90), 0.06 * span)
    return centre, half_w, nose_y, sel.sum(), teeth


# ──────────────────────────── التشوّهات ────────────────────────────

def build_deforms(P, mouth, half_w, teeth_mask=None):
    mx_, my_, mz_ = mouth
    ymin = P[:, 1].min()
    chin = my_ - 0.20 * (P[:, 1].max() - ymin)

    # وزن الفك: من تحت الشفة العليا لحد الذقن، ويختفي في الرقبة وورا الراسة
    w_jaw = smooth((my_ + 0.045 - P[:, 1]) / 0.13)
    w_jaw *= smooth((P[:, 1] - (chin - 0.16)) / 0.14)
    w_jaw *= smooth((P[:, 2] + 0.05) / 0.30)
    w_jaw = np.clip(w_jaw, 0, 1)

    # السنان مرسومة على الـ texture مش geometry — لو سبناها تتشوّه مع الفك
    # هتتمطّ زي المطاط. بنثبّتها (وجيرانها بتدرّج ناعم) فتفضل صلبة.
    if teeth_mask is not None and teeth_mask.sum() > 4:
        tp = P[teeth_mask]
        dist = np.linalg.norm(P[:, None, :] - tp[None, :, :], axis=2).min(1)
        rigid = 1.0 - smooth((dist - 0.010) / 0.055)   # 1 عند السنان -> 0 بعيد عنها
        w_jaw = w_jaw * (1.0 - 0.88 * rigid)

    # وزن الشفايف: كرة حوالين الفم، قدّام بس
    dx = (P[:, 0] - mx_) / (half_w * 1.5)
    dy = (P[:, 1] - my_) / (half_w * 1.1)
    dz = (P[:, 2] - mz_) / (half_w * 2.2)
    w_lip = smooth(1.0 - np.sqrt(dx**2 + dy**2 + dz**2))
    w_lip *= smooth((P[:, 2] - 0.35 * mz_) / (0.4 * mz_))
    w_lip = np.clip(w_lip, 0, 1)
    if teeth_mask is not None and teeth_mask.sum() > 4:
        w_lip = w_lip * (1.0 - 0.75 * rigid)

    # 1) فتح الفك — دوران حوالين مفصل خلف الوش
    piv = np.array([0.0, my_ + 0.17, mz_ - 0.63])
    rel = P - piv
    c, s = np.cos(JAW_ANGLE), np.sin(JAW_ANGLE)
    rot = np.stack([rel[:, 0], rel[:, 1] * c - rel[:, 2] * s,
                    rel[:, 1] * s + rel[:, 2] * c], 1)
    d_jaw = (rot + piv - P) * w_jaw[:, None]

    # 2) تدوير الشفايف — لجوه على المحور X ولقدّام
    d_round = np.zeros_like(P)
    d_round[:, 0] = -(P[:, 0] - mx_) * 0.55 * ROUND_AMT / max(half_w, 1e-6) * w_lip
    d_round[:, 2] = ROUND_AMT * w_lip
    d_round[:, 1] = -(P[:, 1] - my_) * 0.30 * w_lip

    # 3) فرد الشفايف — الأركان لبرّه وشوية لورا
    d_wide = np.zeros_like(P)
    corner = np.clip(np.abs(P[:, 0] - mx_) / max(half_w, 1e-6), 0, 1)
    d_wide[:, 0] = np.sign(P[:, 0] - mx_) * WIDE_AMT * corner * w_lip
    d_wide[:, 2] = -WIDE_AMT * 0.35 * w_lip
    d_wide[:, 1] = np.where(P[:, 1] > my_, 1, -1) * WIDE_AMT * 0.10 * w_lip

    # 4) ضمّ الشفايف — العليا لتحت والسفلى لفوق
    d_close = np.zeros_like(P)
    d_close[:, 1] = -np.sign(P[:, 1] - my_) * CLOSE_AMT * w_lip
    d_close[:, 2] = CLOSE_AMT * 0.4 * w_lip

    return dict(jaw=d_jaw, round=d_round, wide=d_wide, close=d_close), w_jaw, w_lip


# ──────────────────────────────── main ────────────────────────────────

def main(src, dst):
    J, BIN = load_glb(src)
    prim = J["meshes"][0]["primitives"][0]
    assert "targets" not in prim, "الموديل دا فيه morph targets أصلاً"

    P = read_accessor(J, BIN, prim["attributes"]["POSITION"]).astype(float)
    UV = read_accessor(J, BIN, prim["attributes"]["TEXCOORD_0"]).astype(float)

    mouth, half_w, nose_y, nsel, teeth_mask = find_mouth(J, BIN, P, UV)
    print(f"  المناخير عند y={nose_y:+.3f}")
    print(f"  الفم عند   ({mouth[0]:+.3f}, {mouth[1]:+.3f}, {mouth[2]:+.3f})  نصف العرض {half_w:.3f}  من {nsel} vertex")

    D, w_jaw, w_lip = build_deforms(P, mouth, half_w, teeth_mask)
    print(f"  منطقة الفك: {(w_jaw>0.05).sum()} vertex   منطقة الشفايف: {(w_lip>0.05).sum()} vertex")

    targets, names = [], []

    def add(name, delta):
        mag = np.linalg.norm(delta, axis=1).max()
        targets.append({"POSITION": add_vec3_accessor(J, BIN, delta.astype("float32"))})
        names.append(name)
        return mag

    # الـ 15 viseme — كل واحد خلطة بنفس نِسَب محرّك الشفايف
    for v, (j, r, wd, cl) in SHAPE.items():
        delta = D["jaw"] * j + D["round"] * r + D["wide"] * wd + D["close"] * cl
        m = add("viseme_" + v, delta)
        print(f"    viseme_{v:<4s} أقصى إزاحة {m:.4f}")

    # أسماء ARKit — الطبقة التانية في avatar.js
    add("jawOpen",         D["jaw"])
    add("mouthClose",      D["close"])
    add("mouthFunnel",     D["round"])
    add("mouthPucker",     D["round"] * 0.8)
    add("mouthSmileLeft",  np.where((P[:, 0] < mouth[0])[:, None], D["wide"], 0))
    add("mouthSmileRight", np.where((P[:, 0] > mouth[0])[:, None], D["wide"], 0))

    prim["targets"] = targets
    J["meshes"][0]["weights"] = [0.0] * len(targets)
    J["meshes"][0].setdefault("extras", {})["targetNames"] = names
    J.setdefault("asset", {})["generator"] = "rig_avatar.py (Arabic visemes)"

    size = write_glb(dst, J, BIN)
    print(f"\n  ✅ {len(names)} morph target اتكتبوا -> {dst}  ({size/1024/1024:.1f} MB)")
    return 0


if __name__ == "__main__":
    if len(sys.argv) != 3:
        print(__doc__); sys.exit(1)
    sys.exit(main(sys.argv[1], sys.argv[2]))
