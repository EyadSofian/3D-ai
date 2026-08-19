#!/usr/bin/env python3
"""
تحسين أفاتار Ready Player Me — على مستوى التكستشر والمواد.

أفاتارات RPM بتيجي مسطّحة عن قصد: تكستشر الجلد رسمة ناعمة من غير أي مسام،
ومن غير normal map خالص. النتيجة وش "باهت" مهما ظبطت الإضاءة.

الأداة دي بتشتغل على الحاجات اللي فعلاً بتتحسّن من غير 3D artist:

  --logo        شيل لوجو "READY PLAYER ME" المطبوع على التيشيرت
  --beard N     ارسم دقن على تكستشر الجلد (0..1 كثافة)
                  RPM نفسها بترسم الدقون على التكستشر مش كـ geometry،
                  فدي نفس الطريقة الأصلية مش حيلة.
  --normal N    ولّد normal map للجلد من الألوان (0..1 قوة)
                  بيدّي إحساس سطح بدل السطح الأملس تمامًا.
  --no-glasses  احذف النضارة

    python3 tools/polish_avatar.py in.glb out.glb --logo --beard 0.8 --normal 0.6
"""
import argparse, io, json, struct
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter


# ── قراءة/كتابة GLB ──────────────────────────────────────────────────────
def read_glb(path):
    d = Path(path).read_bytes()
    jl = struct.unpack("<I", d[12:16])[0]
    gltf = json.loads(d[20:20 + jl])
    o, blob = 20 + jl, b""
    while o < len(d):
        clen, ctype = struct.unpack_from("<II", d, o)
        if ctype == 0x004E4942:
            blob = d[o + 8:o + 8 + clen]
        o += 8 + clen
    return gltf, bytearray(blob)


def write_glb(gltf, blob, path):
    gltf["buffers"] = [{"byteLength": len(blob)}]
    js = json.dumps(gltf, separators=(",", ":")).encode()
    js += b" " * ((-len(js)) % 4)
    blob += b"\0" * ((-len(blob)) % 4)
    out = (struct.pack("<III", 0x46546C67, 2, 12 + 8 + len(js) + 8 + len(blob))
           + struct.pack("<II", len(js), 0x4E4F534A) + js
           + struct.pack("<II", len(blob), 0x004E4942) + bytes(blob))
    Path(path).write_bytes(out)
    return len(out)


def img_of(gltf, blob, idx):
    bv = gltf["bufferViews"][gltf["images"][idx]["bufferView"]]
    s = bv.get("byteOffset", 0)
    return Image.open(io.BytesIO(bytes(blob[s:s + bv["byteLength"]])))


def put_img(gltf, blob, idx, pil, fmt="JPEG", quality=94):
    b = io.BytesIO()
    pil.convert("RGB").save(b, fmt, quality=quality)
    raw = b.getvalue()
    while len(blob) % 4:
        blob.append(0)
    gltf["bufferViews"].append({"buffer": 0, "byteOffset": len(blob), "byteLength": len(raw)})
    blob += raw
    gltf["images"][idx] = {"bufferView": len(gltf["bufferViews"]) - 1,
                           "mimeType": "image/jpeg" if fmt == "JPEG" else "image/png"}


def find_image(gltf, material_name, slot="base"):
    for m in gltf.get("materials", []):
        if m.get("name") != material_name:
            continue
        pbr = m.get("pbrMetallicRoughness", {})
        ref = {"base": pbr.get("baseColorTexture"),
               "normal": m.get("normalTexture"),
               "mr": pbr.get("metallicRoughnessTexture")}[slot]
        if ref:
            return gltf["textures"][ref["index"]]["source"]
    return None


# ── ١) شيل اللوجو ────────────────────────────────────────────────────────
def remove_logo(im):
    """
    اللوجو مطبوع فاتح على قماش غامق. بندوّر على البقعة الفاتحة في نص
    الصدر ونملاها بنسيج من حواليها بدل ما نحط لون مصمت (اللي بيبان كرقعة).
    """
    a = np.asarray(im.convert("RGB")).astype(np.float32)
    h, w, _ = a.shape
    # نطاق البحث: نص الصدر تقريبًا
    y0, y1 = int(h * 0.44), int(h * 0.60)
    x0, x1 = int(w * 0.28), int(w * 0.48)
    box = a[y0:y1, x0:x1]
    lum = box.mean(2)
    thr = lum.mean() + 2.1 * lum.std()
    mask = lum > thr
    if mask.sum() < 12:
        return im, 0
    ys, xs = np.nonzero(mask)
    py0, py1 = max(0, ys.min() - 6), min(box.shape[0], ys.max() + 7)
    px0, px1 = max(0, xs.min() - 6), min(box.shape[1], xs.max() + 7)

    ph, pw = py1 - py0, px1 - px0
    # منطقة نضيفة بنفس المقاس من تحت اللوجو — نفس القماش ونفس التدرّج
    sy = min(box.shape[0] - ph, py1 + 8)
    patch = box[sy:sy + ph, px0:px1].copy()
    if patch.shape[:2] != (ph, pw):
        patch = np.repeat(np.repeat(box[py1:py1 + 1, px0:px1], ph, 0), 1, 1)

    # امزج بحافة ناعمة عشان الرقعة متبانش
    fy = np.minimum(np.arange(ph), ph - 1 - np.arange(ph))[:, None] / max(1, ph * 0.28)
    fx = np.minimum(np.arange(pw), pw - 1 - np.arange(pw))[None, :] / max(1, pw * 0.28)
    blend = np.clip(np.minimum(fy, fx), 0, 1)[:, :, None]
    box[py0:py1, px0:px1] = box[py0:py1, px0:px1] * (1 - blend) + patch * blend
    a[y0:y1, x0:x1] = box
    return Image.fromarray(a.clip(0, 255).astype(np.uint8)), int(mask.sum())


# ── ٢) ارسم دقن ──────────────────────────────────────────────────────────
def paint_beard(im, strength=0.8, color=(38, 27, 22)):
    """
    الدقن بيتحدد بقناع على شكل حدوة حوالين الفك + شنب فوق الشفة.
    الإحداثيات نسبية عشان تشتغل مع أي مقاس تكستشر — تخطيط UV بتاع RPM
    ثابت لكل الأفاتارات، فالنسب دي بتنطبق عليهم كلهم.
    """
    im = im.convert("RGB")
    W, H = im.size
    a = np.asarray(im).astype(np.float32)
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    u, v = xx / W, yy / H

    cx = 0.50                       # محور الوش
    def ell(ux, vy, rx, ry):
        return (((u - ux) / rx) ** 2 + ((v - vy) / ry) ** 2)

    # الفك والدقن — بيضاوي كبير من تحت الأنف لآخر الدقن
    jaw = 1.0 - np.clip(ell(cx, 0.545, 0.190, 0.115), 0, 1)
    # نشيل منطقة الفم نفسها
    mouth = 1.0 - np.clip(ell(cx, 0.478, 0.085, 0.032), 0, 1)
    # الشنب فوق الشفة العليا
    mus = 1.0 - np.clip(ell(cx, 0.452, 0.098, 0.028), 0, 1)
    # السوالف — بتوصل الدقن بالشعر
    sbL = 1.0 - np.clip(ell(0.335, 0.415, 0.045, 0.115), 0, 1)
    sbR = 1.0 - np.clip(ell(0.665, 0.415, 0.045, 0.115), 0, 1)

    m = np.clip(jaw + mus * 0.95 + sbL * 0.75 + sbR * 0.75, 0, 1)
    m = np.clip(m - mouth * 1.25, 0, 1)
    # فوق خط الشفة العليا مفيش دقن غير الشنب
    m *= np.clip((v - 0.40) / 0.05, 0, 1)

    # نعّم الحافة
    m = np.asarray(Image.fromarray((m * 255).astype(np.uint8))
                   .filter(ImageFilter.GaussianBlur(W / 190))).astype(np.float32) / 255.0

    # حبيبات — الدقن المصمت بيبان كرقعة دهان
    rng = np.random.default_rng(7)
    grain = rng.random((H, W)).astype(np.float32)
    grain = np.asarray(Image.fromarray((grain * 255).astype(np.uint8))
                       .filter(ImageFilter.GaussianBlur(0.7))).astype(np.float32) / 255.0
    m = np.clip(m * (0.55 + 0.75 * grain), 0, 1) * strength

    col = np.array(color, dtype=np.float32)
    out = a * (1 - m[:, :, None]) + col * m[:, :, None]
    # ظل خفيف تحت الدقن بيدّي عمق
    return Image.fromarray(out.clip(0, 255).astype(np.uint8)), float(m.mean())


# ── ٣) normal map من الألوان ─────────────────────────────────────────────
def make_normal(im, strength=0.6):
    """
    مفيش معلومات ارتفاع حقيقية في تكستشر لون، بس تغيّر السطوع بيقرّب
    التضاريس (الدقن، الشفايف، الحواجب). Sobel على الإضاءة ➜ normal.
    """
    g = np.asarray(im.convert("L")).astype(np.float32) / 255.0
    g = np.asarray(Image.fromarray((g * 255).astype(np.uint8))
                   .filter(ImageFilter.GaussianBlur(1.1))).astype(np.float32) / 255.0
    dx = np.zeros_like(g); dy = np.zeros_like(g)
    dx[:, 1:-1] = (g[:, 2:] - g[:, :-2]) * 0.5
    dy[1:-1, :] = (g[2:, :] - g[:-2, :]) * 0.5
    s = 8.0 * strength
    nx, ny, nz = -dx * s, -dy * s, np.ones_like(g)
    ln = np.sqrt(nx * nx + ny * ny + nz * nz)
    rgb = np.stack([(nx / ln * 0.5 + 0.5), (ny / ln * 0.5 + 0.5), (nz / ln * 0.5 + 0.5)], -1)
    return Image.fromarray((rgb * 255).clip(0, 255).astype(np.uint8))


def attach_normal(gltf, blob, material_name, pil):
    put = len(gltf["images"])
    gltf["images"].append({})
    put_img(gltf, blob, put, pil, "PNG")
    gltf.setdefault("samplers", [{"wrapS": 10497, "wrapT": 10497}])
    gltf["textures"].append({"sampler": 0, "source": put})
    for m in gltf["materials"]:
        if m.get("name") == material_name:
            m["normalTexture"] = {"index": len(gltf["textures"]) - 1, "scale": 1.0}
            return True
    return False


# ── ٤) احذف mesh ────────────────────────────────────────────────────────
def drop_mesh(gltf, name):
    idx = [i for i, m in enumerate(gltf["meshes"]) if m.get("name") == name]
    if not idx:
        return False
    keep = set(idx)
    for n in gltf.get("nodes", []):
        if n.get("mesh") in keep:
            n.pop("mesh", None)
            n["name"] = n.get("name", "") + "_removed"
    return True


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("src"); ap.add_argument("out")
    ap.add_argument("--logo", action="store_true")
    ap.add_argument("--beard", type=float, default=0.0)
    ap.add_argument("--normal", type=float, default=0.0)
    ap.add_argument("--no-glasses", action="store_true")
    ap.add_argument("--skin-mat", default="Wolf3D_Skin")
    ap.add_argument("--top-mat", default="Wolf3D_Outfit_Top")
    a = ap.parse_args()

    g, blob = read_glb(a.src)

    if a.logo:
        i = find_image(g, a.top_mat, "base")
        if i is None:
            print("  ⚠ ملقتش تكستشر التيشيرت")
        else:
            im, n = remove_logo(img_of(g, blob, i))
            put_img(g, blob, i, im)
            print(f"  ✅ اللوجو اتشال ({n} pixel)")

    skin_i = find_image(g, a.skin_mat, "base")
    if a.beard > 0:
        if skin_i is None:
            print("  ⚠ ملقتش تكستشر الجلد")
        else:
            im, cov = paint_beard(img_of(g, blob, skin_i), a.beard)
            put_img(g, blob, skin_i, im)
            print(f"  ✅ الدقن اترسم (تغطية {cov*100:.1f}% من التكستشر)")

    if a.normal > 0 and skin_i is not None:
        nm = make_normal(img_of(g, blob, skin_i), a.normal)
        ok = attach_normal(g, blob, a.skin_mat, nm)
        print(f"  {'✅' if ok else '⚠'} normal map للجلد")

    if a.no_glasses:
        print(f"  {'✅' if drop_mesh(g, 'Wolf3D_Glasses') else '⚠'} النضارة اتشالت")

    mb = write_glb(g, blob, a.out) / 1048576
    print(f"\n✅ {a.out}  ({mb:.1f} MB)")


if __name__ == "__main__":
    main()
