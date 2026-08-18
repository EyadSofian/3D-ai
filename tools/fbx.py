"""
قارئ FBX binary — بيطلّع الشجرة كاملة من غير أي مكتبة برّه.

الصيغة: هيدر 27 بايت، وبعدين records متداخلة. كل record:
  EndOffset · NumProperties · PropertyListLen   (uint32 لو الإصدار < 7500، وإلا uint64)
  NameLen (uint8) · Name · Properties · Nested…
وبينتهي بـ record فاضي كله أصفار.
"""
import struct, zlib

_ARRAY = {b"f": ("f", 4), b"d": ("d", 8), b"l": ("q", 8), b"i": ("i", 4), b"b": ("b", 1)}
_SCALAR = {b"Y": ("h", 2), b"C": ("?", 1), b"I": ("i", 4), b"F": ("f", 4), b"D": ("d", 8), b"L": ("q", 8)}


class Node:
    __slots__ = ("name", "props", "children")

    def __init__(self, name, props, children):
        self.name, self.props, self.children = name, props, children

    def find(self, name):
        """أول ابن بالاسم دا."""
        for c in self.children:
            if c.name == name:
                return c
        return None

    def findall(self, name):
        return [c for c in self.children if c.name == name]

    def __repr__(self):
        return f"<{self.name} props={len(self.props)} kids={len(self.children)}>"


def _read_prop(d, o):
    t = d[o:o + 1]; o += 1
    if t in _SCALAR:
        f, n = _SCALAR[t]
        return struct.unpack_from("<" + f, d, o)[0], o + n
    if t in _ARRAY:
        f, n = _ARRAY[t]
        cnt, enc, clen = struct.unpack_from("<III", d, o); o += 12
        raw = d[o:o + clen]; o += clen
        if enc == 1:
            raw = zlib.decompress(raw)
        return struct.unpack_from("<%d%s" % (cnt, f), raw, 0), o
    if t in (b"S", b"R"):
        (n,) = struct.unpack_from("<I", d, o); o += 4
        v = d[o:o + n]; o += n
        return (v.decode("utf-8", "replace") if t == b"S" else v), o
    raise ValueError("prop type %r @%d" % (t, o - 1))


def _read_node(d, o, w):
    """w = 4 أو 8 حسب الإصدار. بيرجّع (Node|None, offset_بعده)."""
    if w == 8:
        end, nprop, plen = struct.unpack_from("<QQQ", d, o); o += 24
    else:
        end, nprop, plen = struct.unpack_from("<III", d, o); o += 12
    (nlen,) = struct.unpack_from("<B", d, o); o += 1
    if end == 0:                       # الـ record الفاضي = نهاية القايمة
        return None, o
    name = d[o:o + nlen].decode("utf-8", "replace"); o += nlen
    props = []
    for _ in range(nprop):
        v, o = _read_prop(d, o)
        props.append(v)
    kids = []
    while o < end:
        k, o = _read_node(d, o, w)
        if k is None:
            break
        kids.append(k)
    return Node(name, props, kids), end


def parse(path):
    d = open(path, "rb").read()
    if not d.startswith(b"Kaydara FBX Binary"):
        raise ValueError("مش FBX binary")
    (ver,) = struct.unpack_from("<I", d, 23)
    w = 8 if ver >= 7500 else 4
    o, roots = 27, []
    while o < len(d) - 16:
        n, o = _read_node(d, o, w)
        if n is None:
            break
        roots.append(n)
    return ver, Node("__root__", [], roots)
