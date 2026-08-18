#!/usr/bin/env python3
"""
Microsoft RocketBox (FBX) ➜ GLB جاهز للـ lip sync.

ليه الأداة دي أصلاً: RocketBox فيه ١١٣ شخصية بترخيص MIT (يعني مجاني حتى
تجاريًا) وجواها ٥٢ ARKit blendshape + ١٥ Oculus viseme — بس بصيغة FBX
بتاعة Unity. مفيش Blender على الجهاز، فبنقرا الـ FBX ونكتب الـ GLB بإيدنا.

    # ينزّل الشخصية وتكستشراتها ويحوّلها في أمر واحد
    python3 tools/rocketbox_to_glb.py --fetch Male_Adult_19 public/models/majed.glb

    # أو من ملفات عندك
    python3 tools/rocketbox_to_glb.py X_facial.fbx out.glb --tex-dir <مجلد>

شخصيات فيها دقن ولبس عربي: Male_Adult_15 · Male_Adult_19 · Male_Adult_21

بيتعمل إيه بالظبط:
  • مثلثات + normals + UV من الـ FBX (كلها ByPolygonVertex فبنفكّها ونعيد فهرستها)
  • تحويل المحاور: Max بتاعت Z-up بالسنتيمتر ➜ glTF بـ Y-up بالمتر
  • الأسماء بتترجم لللي الكود بيدوّر عليه: AA_VI_01_PP ➜ viseme_PP
                                            AK_25_JawOpen ➜ jawOpen
  • TGA ➜ JPEG (الأصل ١٢ ميجا للواحدة، مستحيل تتبعت للمتصفح)
"""
import argparse, base64, json, os, re, struct, sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from fbx import parse as fbx_parse

CM_TO_M = 0.01

# ── ترجمة الأسماء ────────────────────────────────────────────────────────
# viseme kk و sil بحروف صغيرة — دي تسمية Oculus/RPM، وهي اللي
# visemes-ar.js بيدوّر عليها. الباقي زي ما هو (PP, FF, SS…).
_VIS = re.compile(r"^AA_VI_\d+_(\w+)$")
_ARK = re.compile(r"^AK_\d+_(\w+)$")


def morph_name(raw):
    raw = raw.split("\x00")[0].split(".")[-1]
    m = _VIS.match(raw)
    if m:
        v = m.group(1)
        v = {"Sil": "sil", "KK": "kk"}.get(v, v)
        return "viseme_" + v
    m = _ARK.match(raw)
    if m:
        a = m.group(1)
        return a[0].lower() + a[1:]
    return None


def _name(node):
    return node.props[1].split("\x00")[0] if len(node.props) > 1 else ""


def build(fbx_path, tex_dir, tex_size, keep_normals=True):
    ver, root = fbx_parse(fbx_path)
    objs = root.find("Objects")

    # ── الاتصالات: ابن -> [آباء] ─────────────────────────────────────────
    parents = {}
    for c in root.find("Connections").children:
        if c.props[0] == "OO":
            parents.setdefault(c.props[1], []).append(c.props[2])
    children = {}
    for kid, ps in parents.items():
        for p in ps:
            children.setdefault(p, []).append(kid)

    mesh = next(g for g in objs.findall("Geometry") if g.props[2] == "Mesh")
    shapes = {g.props[0]: g for g in objs.findall("Geometry") if g.props[2] == "Shape"}
    mats = objs.findall("Material")

    V = mesh.find("Vertices").props[0]
    PVI = mesh.find("PolygonVertexIndex").props[0]
    NRM = mesh.find("LayerElementNormal").find("Normals").props[0]
    uvel = mesh.find("LayerElementUV")
    UV = uvel.find("UV").props[0]
    UVI = uvel.find("UVIndex").props[0]
    MATS = mesh.find("LayerElementMaterial").find("Materials").props[0]

    # ── فك المضلعات لمثلثات ──────────────────────────────────────────────
    # آخر index في كل مضلع مكتوب بالـ bitwise NOT — دي علامة نهاية المضلع.
    polys, cur = [], []
    for pv, idx in enumerate(PVI):
        end = idx < 0
        cur.append((pv, ~idx if end else idx))
        if end:
            polys.append(cur)
            cur = []

    # ── إعادة الفهرسة: glTF عايز (pos,normal,uv) متجمعين في vertex واحد ──
    uniq, remap, orig_of = {}, [], []
    tris_by_mat = {}

    def vert(pv, vi):
        n = NRM[3 * pv:3 * pv + 3]
        uvi = UVI[pv]
        uv = UV[2 * uvi:2 * uvi + 2]
        key = (vi, n, uv)
        got = uniq.get(key)
        if got is None:
            got = uniq[key] = len(remap)
            x, y, z = V[3 * vi], V[3 * vi + 1], V[3 * vi + 2]
            nx, ny, nz = n
            remap.append((
                (x * CM_TO_M, z * CM_TO_M, -y * CM_TO_M),   # Z-up ➜ Y-up
                (nx, nz, -ny),
                (uv[0], 1.0 - uv[1]),                        # UV مقلوبة رأسيًا
            ))
            orig_of.append(vi)
        return got

    for pi, poly in enumerate(polys):
        mat = MATS[pi] if pi < len(MATS) else 0
        ids = [vert(pv, vi) for pv, vi in poly]
        tl = tris_by_mat.setdefault(mat, [])
        for k in range(1, len(ids) - 1):          # مروحة — كلها مثلثات هنا أصلاً
            tl += [ids[0], ids[k], ids[k + 1]]

    nvert = len(remap)
    # فهرس معكوس: vertex أصلي -> كل الـ vertices الجديدة اللي طلعت منه
    from collections import defaultdict
    spawn = defaultdict(list)
    for new, old in enumerate(orig_of):
        spawn[old].append(new)

    # ── الـ blendshapes ──────────────────────────────────────────────────
    targets, tnames = [], []
    for ch in objs.findall("Deformer"):
        if ch.props[2] != "BlendShapeChannel":
            continue
        nm = morph_name(_name(ch))
        if not nm or nm in tnames:
            continue
        sh = next((shapes[k] for k in children.get(ch.props[0], []) if k in shapes), None)
        if sh is None:
            continue
        idxs = sh.find("Indexes").props[0] if sh.find("Indexes") else ()
        dv = sh.find("Vertices").props[0] if sh.find("Vertices") else ()
        deltas = [(0.0, 0.0, 0.0)] * nvert
        for k, oi in enumerate(idxs):
            dx, dy, dz = dv[3 * k], dv[3 * k + 1], dv[3 * k + 2]
            d = (dx * CM_TO_M, dz * CM_TO_M, -dy * CM_TO_M)
            for nv in spawn.get(oi, ()):
                deltas[nv] = d
        targets.append(deltas)
        tnames.append(nm)

    return dict(remap=remap, tris=tris_by_mat, targets=targets, tnames=tnames,
                mats=[_name(m) for m in mats], objs=objs, children=children)


# ── التكستشرات ───────────────────────────────────────────────────────────
def load_textures(tex_dir, mats, size):
    """TGA ➜ JPEG. الأصل 2048² غير مضغوطة (١٢ ميجا للواحدة)."""
    from PIL import Image
    out = {}
    for m in mats:
        part = m.split("_")[-1]                    # m250_head ➜ head
        for cand in (f"{m}_color.tga", f"m250_{part}_color.tga"):
            p = Path(tex_dir) / cand
            if p.exists():
                im = Image.open(p).convert("RGB")
                if max(im.size) > size:
                    im = im.resize((size, size), Image.LANCZOS)
                import io
                b = io.BytesIO()
                im.save(b, "JPEG", quality=90, optimize=True)
                out[m] = b.getvalue()
                break
    return out


# ── كتابة الـ GLB ────────────────────────────────────────────────────────
def write_glb(data, out_path, tex_dir=None, tex_size=2048):
    remap, tris, targets, tnames = data["remap"], data["tris"], data["targets"], data["tnames"]
    mats = data["mats"]

    bin_parts, views, accs = [], [], []
    off = 0

    def add(raw, target=None, stride=None):
        nonlocal off
        pad = (-len(raw)) % 4
        bin_parts.append(raw + b"\0" * pad)
        v = {"buffer": 0, "byteOffset": off, "byteLength": len(raw)}
        if target:
            v["target"] = target
        if stride:
            v["byteStride"] = stride
        views.append(v)
        off += len(raw) + pad
        return len(views) - 1

    def acc(view, ctype, count, atype, mn=None, mx=None):
        a = {"bufferView": view, "componentType": ctype, "count": count, "type": atype}
        if mn is not None:
            a["min"], a["max"] = mn, mx
        accs.append(a)
        return len(accs) - 1

    n = len(remap)
    pos = b"".join(struct.pack("<3f", *v[0]) for v in remap)
    nrm = b"".join(struct.pack("<3f", *v[1]) for v in remap)
    uv = b"".join(struct.pack("<2f", *v[2]) for v in remap)
    xs = [v[0][0] for v in remap]; ys = [v[0][1] for v in remap]; zs = [v[0][2] for v in remap]
    a_pos = acc(add(pos, 34962), 5126, n, "VEC3",
                [min(xs), min(ys), min(zs)], [max(xs), max(ys), max(zs)])
    a_nrm = acc(add(nrm, 34962), 5126, n, "VEC3")
    a_uv = acc(add(uv, 34962), 5126, n, "VEC2")

    # الـ morph targets — POSITION بس. الـ normals هتفضل بتاعة الوش الساكن،
    # وده مقبول بصريًا وبيوفّر نص الحجم.
    t_accs = []
    for deltas in targets:
        raw = b"".join(struct.pack("<3f", *d) for d in deltas)
        dxs = [d[0] for d in deltas]; dys = [d[1] for d in deltas]; dzs = [d[2] for d in deltas]
        t_accs.append(acc(add(raw, 34962), 5126, n, "VEC3",
                          [min(dxs), min(dys), min(dzs)], [max(dxs), max(dys), max(dzs)]))

    texdata = load_textures(tex_dir, mats, tex_size) if tex_dir else {}
    images, samplers, textures, gmats = [], [{"magFilter": 9729, "minFilter": 9987,
                                              "wrapS": 10497, "wrapT": 10497}], [], []
    mat_index = {}
    for i, m in enumerate(mats):
        pbr = {"metallicFactor": 0.0, "roughnessFactor": 0.72,
               "baseColorFactor": [1, 1, 1, 1]}
        if m in texdata:
            iv = add(texdata[m])
            images.append({"bufferView": iv, "mimeType": "image/jpeg"})
            textures.append({"sampler": 0, "source": len(images) - 1})
            pbr["baseColorTexture"] = {"index": len(textures) - 1}
        gmats.append({"name": m, "pbrMetallicRoughness": pbr, "doubleSided": False})
        mat_index[i] = len(gmats) - 1

    prims = []
    for mi, idx in sorted(tris.items()):
        raw = b"".join(struct.pack("<I", i) for i in idx)
        a_idx = acc(add(raw, 34963), 5125, len(idx), "SCALAR")
        p = {"attributes": {"POSITION": a_pos, "NORMAL": a_nrm, "TEXCOORD_0": a_uv},
             "indices": a_idx, "mode": 4}
        if mi in mat_index:
            p["material"] = mat_index[mi]
        if t_accs:
            p["targets"] = [{"POSITION": t} for t in t_accs]
            p["extras"] = {"targetNames": tnames}
        prims.append(p)

    gltf = {
        "asset": {"version": "2.0", "generator": "rocketbox_to_glb.py"},
        "scene": 0,
        "scenes": [{"nodes": [0]}],
        "nodes": [{"mesh": 0, "name": "Avatar"}],
        "meshes": [{"name": "Avatar", "primitives": prims,
                    "weights": [0.0] * len(t_accs),
                    "extras": {"targetNames": tnames}}],
        "materials": gmats,
        "accessors": accs,
        "bufferViews": views,
        "buffers": [{"byteLength": off}],
    }
    if images:
        gltf["images"], gltf["textures"], gltf["samplers"] = images, textures, samplers

    blob = b"".join(bin_parts)
    js = json.dumps(gltf, separators=(",", ":")).encode()
    js += b" " * ((-len(js)) % 4)
    glb = (struct.pack("<III", 0x46546C67, 2, 12 + 8 + len(js) + 8 + len(blob))
           + struct.pack("<II", len(js), 0x4E4F534A) + js
           + struct.pack("<II", len(blob), 0x004E4942) + blob)
    Path(out_path).write_bytes(glb)
    return dict(verts=n, tris=sum(len(v) for v in tris.values()) // 3,
                morphs=len(tnames), names=tnames, mb=len(glb) / 1048576)


RAW = "https://raw.githubusercontent.com/microsoft/Microsoft-Rocketbox/master/Assets/Avatars"


def fetch(name, dest):
    """ينزّل الـ FBX بتاع الوش + تكستشرات الألوان من ريبو RocketBox."""
    import urllib.request
    dest = Path(dest); dest.mkdir(parents=True, exist_ok=True)
    group = "Children" if "Child" in name else (
        "Adults" if ("Adult" in name or "Party" in name) else "Professions")
    base = f"{RAW}/{group}/{name}"

    fbx = dest / f"{name}_facial.fbx"
    if not fbx.exists():
        print(f"⬇  {name}_facial.fbx …")
        urllib.request.urlretrieve(f"{base}/Export/{name}_facial.fbx", fbx)

    # اسم التكستشر جوه الـ FBX مالوش علاقة باسم الشخصية (m250_head_color…)،
    # فبنقراه من الملف نفسه بدل ما نخمّن.
    _, root = fbx_parse(str(fbx))
    want = set()
    for t in root.find("Objects").findall("Texture"):
        rel = t.find("RelativeFilename")
        if rel:
            f = rel.props[0].replace("\\", "/").split("/")[-1]
            if "_color" in f:
                want.add(f)
    for f in sorted(want):
        out = dest / f
        if out.exists():
            continue
        print(f"⬇  {f} …")
        urllib.request.urlretrieve(f"{base}/Textures/{f}", out)
    return str(fbx), str(dest)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("fbx", help="ملف FBX، أو اسم الشخصية مع --fetch")
    ap.add_argument("out")
    ap.add_argument("--fetch", action="store_true",
                    help="نزّل الشخصية من ريبو RocketBox الأول")
    ap.add_argument("--tex-dir"); ap.add_argument("--tex-size", type=int, default=2048)
    a = ap.parse_args()
    if a.fetch:
        cache = Path(a.out).parent / ".rocketbox" / a.fbx
        a.fbx, a.tex_dir = fetch(a.fbx, cache)
    d = build(a.fbx, a.tex_dir, a.tex_size)
    r = write_glb(d, a.out, a.tex_dir, a.tex_size)
    print(f"✅ {a.out}  {r['mb']:.1f} MB")
    print(f"   {r['verts']:,} vertices · {r['tris']:,} triangles · {r['morphs']} morph targets")
    vis = [x for x in r["names"] if x.startswith("viseme_")]
    print(f"   visemes: {len(vis)}/15  {' '.join(sorted(vis))}")


if __name__ == "__main__":
    main()
