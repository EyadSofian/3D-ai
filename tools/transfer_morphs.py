#!/usr/bin/env python3
"""
نقل الـ blendshapes من موديل GLB لموديل تاني بنفس التوبولوجي.

ليه: كل أفاتارات Ready Player Me مبنية على نفس الـ base mesh
(`Wolf3D_Head` = 2162 vertex، `Wolf3D_Teeth` = 84 …) بنفس ترتيب الـ vertices
بالظبط. الاختلاف بينهم في الشكل والتكستشر بس. يعني لو حد صدّر أفاتار من
RPM من غير ما يطلب الـ morph targets (وده بيحصل كتير لأنها باراميتر
اختياري في الرابط)، نقدر ناخدهم من أي أفاتار RPM تاني ونركّبهم عليه —
والنتيجة مضبوطة مش تقريبية، لأن دي نفس الـ deltas اللي RPM نفسها بتوزّعها.

    python3 tools/transfer_morphs.py <المصدر.glb> <الهدف.glb> <الناتج.glb>

الأداة بتتأكد من التطابق الأول (عدد vertices + الـ indices + الـ UV)
وبتقف لو الموديلين مش نفس القاعدة.
"""
import argparse, json, struct, sys
from pathlib import Path

CT = {5120: ("b", 1), 5121: ("B", 1), 5122: ("h", 2),
      5123: ("H", 2), 5125: ("I", 4), 5126: ("f", 4)}
NC = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4, "MAT4": 16}


def read_glb(path):
    d = Path(path).read_bytes()
    if d[:4] != b"glTF":
        raise ValueError(f"{path}: مش GLB")
    jl = struct.unpack("<I", d[12:16])[0]
    gltf = json.loads(d[20:20 + jl])
    o = 20 + jl
    blob = b""
    while o < len(d):
        clen, ctype = struct.unpack_from("<II", d, o)
        if ctype == 0x004E4942:
            blob = d[o + 8:o + 8 + clen]
        o += 8 + clen
    return gltf, blob


def accessor_bytes(gltf, blob, ai):
    """يرجّع الـ accessor كـ float32 متلاصقة (بيفك أي stride أو sparse)."""
    a = gltf["accessors"][ai]
    n, nc = a["count"], NC[a["type"]]
    f, sz = CT[a["componentType"]]
    vals = [[0.0] * nc for _ in range(n)]
    if "bufferView" in a:
        bv = gltf["bufferViews"][a["bufferView"]]
        start = bv.get("byteOffset", 0) + a.get("byteOffset", 0)
        stride = bv.get("byteStride") or sz * nc
        for i in range(n):
            vals[i] = list(struct.unpack_from("<%d%s" % (nc, f), blob, start + i * stride))
    sp = a.get("sparse")
    if sp:
        ia = sp["indices"]; va = sp["values"]
        ibv = gltf["bufferViews"][ia["bufferView"]]
        vbv = gltf["bufferViews"][va["bufferView"]]
        i_f, i_sz = CT[ia["componentType"]]
        ioff = ibv.get("byteOffset", 0) + ia.get("byteOffset", 0)
        voff = vbv.get("byteOffset", 0) + va.get("byteOffset", 0)
        for k in range(sp["count"]):
            idx = struct.unpack_from("<" + i_f, blob, ioff + k * i_sz)[0]
            vals[idx] = list(struct.unpack_from("<%d%s" % (nc, f), blob, voff + k * sz * nc))
    return b"".join(struct.pack("<%df" % nc, *v) for v in vals), n, a["type"]


def mesh_map(gltf):
    out = {}
    for m in gltf.get("meshes", []):
        pr = m["primitives"][0]
        out[m.get("name", "")] = (m, pr, gltf["accessors"][pr["attributes"]["POSITION"]]["count"])
    return out


def check(src, sblob, dst, dblob, name):
    """نفس عدد الـ vertices + نفس الـ indices + نفس الـ UV = نفس القاعدة."""
    sm, spr, sn = mesh_map(src)[name]
    dm, dpr, dn = mesh_map(dst)[name]
    if sn != dn:
        return False, f"عدد vertices مختلف ({sn} ≠ {dn})"
    for attr, getter in (("indices", lambda g, b, p: accessor_bytes(g, b, p["indices"])[0]),
                         ("TEXCOORD_0", lambda g, b, p: accessor_bytes(g, b, p["attributes"]["TEXCOORD_0"])[0])):
        try:
            if getter(src, sblob, spr) != getter(dst, dblob, dpr):
                return False, f"{attr} مختلفة"
        except KeyError:
            pass
    return True, "متطابقة"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("source", help="GLB فيه الـ blendshapes")
    ap.add_argument("target", help="GLB عايز تركّبهم عليه")
    ap.add_argument("out")
    ap.add_argument("--force", action="store_true", help="كمّل حتى لو التحقق فشل")
    a = ap.parse_args()

    src, sblob = read_glb(a.source)
    dst, dblob = read_glb(a.target)
    smap, dmap = mesh_map(src), mesh_map(dst)

    shared = [n for n in dmap if n in smap and smap[n][1].get("targets")]
    if not shared:
        sys.exit("❌ مفيش mesh مشتركة فيها morph targets")

    blob = bytearray(dblob)
    moved = 0
    for name in shared:
        ok, why = check(src, sblob, dst, dblob, name)
        print(f"  {name:22s} {'✅' if ok else '❌'} {why}")
        if not ok and not a.force:
            continue
        sm, spr, _ = smap[name]
        dm, dpr, _ = dmap[name]
        names = (sm.get("extras") or {}).get("targetNames") \
            or (src["meshes"][src["meshes"].index(sm)].get("extras") or {}).get("targetNames") or []

        targets = []
        for t in spr["targets"]:
            nt = {}
            for attr, ai in t.items():
                if attr not in ("POSITION", "NORMAL"):
                    continue
                raw, cnt, typ = accessor_bytes(src, sblob, ai)
                while len(blob) % 4:
                    blob.append(0)
                dst["bufferViews"].append({"buffer": 0, "byteOffset": len(blob), "byteLength": len(raw)})
                blob += raw
                v = [struct.unpack_from("<3f", raw, i * 12) for i in range(cnt)]
                dst["accessors"].append({
                    "bufferView": len(dst["bufferViews"]) - 1, "componentType": 5126,
                    "count": cnt, "type": typ,
                    "min": [min(x[i] for x in v) for i in range(3)],
                    "max": [max(x[i] for x in v) for i in range(3)]})
                nt[attr] = len(dst["accessors"]) - 1
            targets.append(nt)

        for pr in dm["primitives"]:
            pr["targets"] = targets
            pr.setdefault("extras", {})["targetNames"] = names
        dm["weights"] = [0.0] * len(targets)
        dm.setdefault("extras", {})["targetNames"] = names
        moved = len(targets)

    # الـ node لازم يشيل نفس عدد الأوزان وإلا three.js بيزعّق
    for nd in dst.get("nodes", []):
        if "mesh" in nd and dst["meshes"][nd["mesh"]].get("weights"):
            nd.pop("weights", None)

    dst["buffers"] = [{"byteLength": len(blob)}]
    js = json.dumps(dst, separators=(",", ":")).encode()
    js += b" " * ((-len(js)) % 4)
    blob += b"\0" * ((-len(blob)) % 4)
    glb = (struct.pack("<III", 0x46546C67, 2, 12 + 8 + len(js) + 8 + len(blob))
           + struct.pack("<II", len(js), 0x4E4F534A) + js
           + struct.pack("<II", len(blob), 0x004E4942) + bytes(blob))
    Path(a.out).write_bytes(glb)
    print(f"\n✅ {a.out}  ({len(glb)/1048576:.1f} MB) — اتنقل {moved} morph target")


if __name__ == "__main__":
    main()
