"""Reference data where nature has an exact shape: molecule 2D coordinates (built-in table, RDKit from SMILES,
PubChem name -> SMILES), cached on disk. Every lookup degrades gracefully to None."""
from __future__ import annotations

import json
import math
import os
import re
import urllib.parse
import urllib.request

import numpy as np

CACHE = os.environ.get("GM_REF_CACHE", "/tmp/gm-ref")

# (element, x, y) in bond-length units, bonds (i, j, order). Linear / bent geometries from the real bond angles.
_A = math.radians(104.5) / 2
BUILTIN = {
    "O": ([("O", 0, 0)], []), "N": ([("N", 0, 0)], []), "H": ([("H", 0, 0)], []), "C": ([("C", 0, 0)], []),
    "CO": ([("C", 0, 0), ("O", 1.13, 0)], [(0, 1, 3)]),
    "CO2": ([("O", -1.16, 0), ("C", 0, 0), ("O", 1.16, 0)], [(0, 1, 2), (1, 2, 2)]),
    "NO": ([("N", 0, 0), ("O", 1.15, 0)], [(0, 1, 2)]),
    "NO2": ([("O", -1.2 * math.sin(math.radians(67)), -0.5), ("N", 0, 0), ("O", 1.2 * math.sin(math.radians(67)), -0.5)], [(0, 1, 2), (1, 2, 1)]),
    "N2": ([("N", 0, 0), ("N", 1.1, 0)], [(0, 1, 3)]),
    "O2": ([("O", 0, 0), ("O", 1.21, 0)], [(0, 1, 2)]),
    "H2": ([("H", 0, 0), ("H", 0.74, 0)], [(0, 1, 1)]),
    "H2O": ([("H", -0.96 * math.sin(_A), -0.96 * math.cos(_A)), ("O", 0, 0), ("H", 0.96 * math.sin(_A), -0.96 * math.cos(_A))], [(0, 1, 1), (1, 2, 1)]),
}
ALIAS = {"carbon monoxide": "CO", "carbon dioxide": "CO2", "nitric oxide": "NO", "nitrogen monoxide": "NO", "nitrogen dioxide": "NO2",
         "nitrogen": "N2", "oxygen": "O2", "water": "H2O", "hydrogen": "H2", "propane": "CCC", "methane": "C", "octane": "CCCCCCCC",
         "glucose": "OC[C@H]1OC(O)[C@H](O)[C@@H](O)[C@@H]1O", "ethanol": "CCO", "c3h8": "CCC", "ch4": "C", "c8h18": "CCCCCCCC",
         "hydrocarbon": "CCC", "unburned fuel": "CCC", "hydrocarbons": "CCC", "nox": "NO", "c3h8 ": "CCC"}


def _rdkit(smiles: str):
    try:
        from rdkit import Chem
        from rdkit.Chem import AllChem
    except Exception:  # noqa: BLE001
        return None
    m = Chem.MolFromSmiles(smiles)
    if m is None:
        return None
    m = Chem.AddHs(m)
    AllChem.Compute2DCoords(m)
    conf = m.GetConformer()
    atoms = [(a.GetSymbol(), conf.GetAtomPosition(i).x / 1.5, conf.GetAtomPosition(i).y / 1.5) for i, a in enumerate(m.GetAtoms())]
    bonds = [(b.GetBeginAtomIdx(), b.GetEndAtomIdx(), int(b.GetBondTypeAsDouble()) or 1) for b in m.GetBonds()]
    return atoms, bonds


def _pubchem_smiles(name: str):
    os.makedirs(CACHE, exist_ok=True)
    fp = os.path.join(CACHE, "pc_" + re.sub(r"[^a-z0-9]+", "_", name.lower())[:60] + ".json")
    if os.path.exists(fp):
        return json.load(open(fp)).get("smiles")
    try:
        u = "https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/name/" + urllib.parse.quote(name) + "/property/IsomericSMILES,CanonicalSMILES/JSON"
        j = json.load(urllib.request.urlopen(u, timeout=8))
        p = j["PropertyTable"]["Properties"][0]
        smi = p.get("IsomericSMILES") or p.get("CanonicalSMILES") or p.get("SMILES")
    except Exception:  # noqa: BLE001
        smi = None
    json.dump({"smiles": smi}, open(fp, "w"))
    return smi


def molecule(name: str):
    """name / formula / SMILES -> {"atoms": [(el, x, y)], "bonds": [(i, j, order)], "source": ...} or None"""
    key = (name or "").strip()
    if not key:
        return None
    k2 = key.replace("₂", "2").replace("₃", "3").replace("₄", "4").replace("₈", "8")
    if k2 in BUILTIN:
        a, b = BUILTIN[k2]
        return {"atoms": a, "bonds": b, "source": "builtin"}
    smi = ALIAS.get(key.lower()) or ALIAS.get(k2.lower())
    if smi in BUILTIN:
        a, b = BUILTIN[smi]
        return {"atoms": a, "bonds": b, "source": "builtin"}
    cands = [smi] if smi else []
    if not smi and re.fullmatch(r"[A-Za-z0-9@+\-\[\]()=#\\/.]+", key) and (not re.search(r"\d", key) or re.search(r"[()=#\[]", key)):
        cands.append(key)  # looks like SMILES (formulas carry digits: C3H8 goes to PubChem by name)
    for s in cands:
        r = _rdkit(s)
        if r:
            return {"atoms": r[0], "bonds": r[1], "source": "rdkit"}
    smi = _pubchem_smiles(key)
    if smi:
        r = _rdkit(smi)
        if r:
            return {"atoms": r[0], "bonds": r[1], "source": "pubchem+rdkit"}
    return None


_ELEM = re.compile(r"([A-Z][a-z]?)(\d*)")


def formula_counts(f: str) -> dict:
    out: dict = {}
    for el, n in _ELEM.findall(f):
        out[el] = out.get(el, 0) + int(n or 1)
    return out


def balanced(eq: str) -> tuple[bool, str]:
    """'2CO + O2 -> 2CO2' -> (True, '') or (False, why). Formulas only (no charges)."""
    s = eq.replace("→", "->").replace("\\to", "->").replace("\\rightarrow", "->").replace("$", "").replace("_", "").replace("{", "").replace("}", "")
    s = re.sub(r"\\mathrm|\\text|\\ce", "", s)
    if "->" not in s:
        return True, "not an equation"
    L, R = s.split("->", 1)

    def side(t):
        tot: dict = {}
        for term in t.split("+"):
            term = term.strip()
            m = re.match(r"^(\d*)\s*([A-Za-z0-9()]+)", term)
            if not m:
                continue
            k = int(m.group(1) or 1)
            for el, n in formula_counts(m.group(2)).items():
                tot[el] = tot.get(el, 0) + k * n
        return tot
    a, b = side(L), side(R)
    if a == b:
        return True, ""
    return False, f"left {a} != right {b}"


def balance(eq: str) -> str | None:
    """Smallest whole-number coefficients that balance 'NO + CO -> N2 + CO2' (species with explicit formulas).
    Returns the balanced equation string, or None when the species cannot balance (or carry variables like CxHy)."""
    import sympy as sp
    s = eq.replace("→", "->")
    if "->" not in s:
        return None
    L, R = s.split("->", 1)

    def species(t):
        out = []
        for term in t.split("+"):
            m = re.match(r"^\s*\d*\s*([A-Za-z0-9()]+)\s*$", term)
            if not m:
                return None
            out.append(m.group(1))
        return out
    ls, rs = species(L), species(R)
    if not ls or not rs or any(re.search(r"[a-z]", f.replace("Cl", "").replace("Na", "").replace("Mg", "").replace("Ca", "").replace("Fe", "").replace("Pt", "").replace("Rh", "").replace("Cu", "").replace("Zn", "").replace("Br", "")) for f in ls + rs):
        return None
    els = sorted({e for f in ls + rs for e in formula_counts(f)})
    M = sp.Matrix([[formula_counts(f).get(e, 0) for f in ls] + [-formula_counts(f).get(e, 0) for f in rs] for e in els])
    ns = M.nullspace()
    if len(ns) != 1:
        return None
    v = ns[0]
    den = sp.ilcm(*[x.q for x in v])
    v = [int(x * den) for x in v]
    if any(x <= 0 for x in v):
        v = [-x for x in v]
    if any(x <= 0 for x in v):
        return None
    g = 0
    for x in v:
        g = math.gcd(g, x)
    v = [x // g for x in v]
    fmt = lambda c, f: (f"{c}{f}" if c > 1 else f)  # noqa: E731
    return " + ".join(fmt(c, f) for c, f in zip(v[: len(ls)], ls)) + " -> " + " + ".join(fmt(c, f) for c, f in zip(v[len(ls):], rs))


# ════════════════ Proteins: real backbone (RCSB PDB) -> 2D outline, open / closed conformations ════════════════
# Public cache of precomputed reference shapes in Supabase storage (read-only from the render container).
REF_BASE = os.environ.get("GM_REF_BASE", "https://tyessjnrwznyizficuyp.supabase.co/storage/v1/object/public/manim-clips/refdata")
# Known open/closed pairs (apo vs substrate-bound) that show the induced fit; the graph may name any other pair.
PROTEIN_PAIRS = {
    "hexokinase": ("2E2N", "2E2Q", "A"),  # Sulfolobus tokodaii hexokinase: apo (open) vs xylose + ADP (closed), Nishimasu et al. 2007
    "adenylate kinase": ("4AKE", "1AKE", "A"),  # E. coli adenylate kinase: open vs closed with Ap5A
}
# what each reference enzyme actually does (substrates in the order the rig places them: sugar/small first, nucleotide second)
PROTEIN_CHEM = {
    "hexokinase": {"enzyme": "Hexokinase", "substrates": ["Glucose", "ATP"], "products": ["Glucose-6-phosphate", "ADP"], "reaction": "transfer",
                   "equation": r"\text{glucose}+\text{ATP}\xrightarrow{\text{hexokinase}}\text{glucose-6-P}+\text{ADP}",
                   "domains": ["large domain", "small domain"]},
    "adenylate kinase": {"enzyme": "Adenylate kinase", "substrates": ["AMP", "ATP"], "products": ["ADP", "ADP"], "reaction": "transfer",
                         "equation": r"\text{AMP}+\text{ATP}\xrightarrow{\text{adenylate kinase}}2\,\text{ADP}", "domains": ["core", "lid"]},
}


def _get(url, timeout=10):
    try:
        return urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "cogniva-refdata/1.0"}), timeout=timeout).read()
    except Exception:  # noqa: BLE001
        return None


def _pdb_atoms(text, chain):
    ca, het = {}, {}
    for ln in text.splitlines():
        rec = ln[:6]
        if rec not in ("ATOM  ", "HETATM") or ln[21] != chain:
            continue
        x, y, z = float(ln[30:38]), float(ln[38:46]), float(ln[46:54])
        if rec == "ATOM  " and ln[12:16].strip() == "CA" and ln[16] in " A":
            ca[int(ln[22:26])] = (x, y, z)
        elif rec == "HETATM":
            r = ln[17:20].strip()
            if r not in ("HOH", "SO4", "EPE", "MG", "NA", "CL", "GOL", "PEG", "ZN", "CA"):
                het.setdefault(r, []).append((x, y, z))
    return ca, het


def _kabsch(P, Q):
    """rotation R, translation t minimising |(P R + t) - Q|"""
    pc, qc = P.mean(0), Q.mean(0)
    H = (P - pc).T @ (Q - qc)
    U, S, Vt = np.linalg.svd(H)
    d = np.sign(np.linalg.det(U @ Vt))
    D = np.diag([1, 1, d])
    R = U @ D @ Vt
    return R, qc - pc @ R


def protein_pair(open_id: str, closed_id: str, chain: str = "A", text_open: str | None = None, text_closed: str | None = None):
    """Residue-matched C-alpha traces of an open and a closed conformation, superposed on the rigid core and projected on
    the plane of the hinge motion (normal = hinge axis), cleft up, in Angstrom. Ligands of the closed form as 2D points.
    Cached on disk and in the public Supabase refdata bucket; None when the PDB cannot be read."""
    key = f"protein_{open_id}_{closed_id}_{chain}".upper()
    os.makedirs(CACHE, exist_ok=True)
    fp = os.path.join(CACHE, key + ".json")
    if os.path.exists(fp) and text_open is None:
        return json.load(open(fp))
    if text_open is None:
        b = _get(f"{REF_BASE}/{key}.json")
        if b:
            try:
                d = json.loads(b)
                json.dump(d, open(fp, "w"))
                return d
            except Exception:  # noqa: BLE001
                pass
        to, tc = _get(f"https://files.rcsb.org/download/{open_id}.pdb", 20), _get(f"https://files.rcsb.org/download/{closed_id}.pdb", 20)
        if not to or not tc:
            return None
        text_open, text_closed = to.decode("latin-1"), tc.decode("latin-1")
    import numpy as _np  # noqa: F401
    ca_o, _ = _pdb_atoms(text_open, chain)
    ca_c, het = _pdb_atoms(text_closed, chain)
    ids = sorted(set(ca_o) & set(ca_c))
    if len(ids) < 40:
        return None
    O = np.array([ca_o[i] for i in ids])
    C = np.array([ca_c[i] for i in ids])
    # superpose on the rigid core: iterate, keeping the residues that move least
    keep = np.ones(len(ids), bool)
    for _ in range(4):
        R, t = _kabsch(O[keep], C[keep])
        Oa = O @ R + t
        dev = np.linalg.norm(Oa - C, axis=1)
        keep = dev < max(1.0, np.percentile(dev, 50))
    R, t = _kabsch(O[keep], C[keep])
    Oa = O @ R + t
    D = C - Oa
    w = np.linalg.norm(D, axis=1)
    Dc = D[w > np.percentile(w, 60)]
    _, _, Vt = np.linalg.svd(Dc - Dc.mean(0))
    n = Vt[2]  # hinge axis ~ the direction the moving domain does not move along
    cen = _np.vstack([Oa, C]).mean(0)
    ligs = []
    for name, pts in het.items():
        ligs.append({"name": name, "xyz": np.array(pts).mean(0)})
    up = (np.mean([l["xyz"] for l in ligs], 0) - cen) if ligs else (C[w > np.percentile(w, 80)].mean(0) - cen)
    up = up - n * (up @ n)
    up /= np.linalg.norm(up) + 1e-9
    ex = np.cross(up, n)
    proj = lambda X: _np.stack([(X - cen) @ ex, (X - cen) @ up], -1)  # noqa: E731
    Po, Pc = proj(Oa), proj(C)
    L2 = [proj(l["xyz"][None])[0] for l in ligs]
    # turn the picture so the cleft mouth (the shortest way out of the open form from the substrate site) points up
    site = L2[0] if L2 else Pc[w > np.percentile(w, 80)].mean(0)
    for l, p in zip(ligs, L2):
        if l["name"] not in ("ADP", "ATP", "ANP", "NAD", "NAP", "FAD", "AMP"):
            site = p
            break
    shape = outline(Po, 4.6)
    from shapely.geometry import LineString
    best, ba = 1e9, 0.0
    angs = np.radians(np.arange(0, 360, 5))
    dist = []
    for a in angs:
        ray = LineString([tuple(site), tuple(site + 80 * np.array([np.cos(a), np.sin(a)]))])
        inter = ray.intersection(shape.exterior)
        pts = [inter] if inter.geom_type == "Point" else list(getattr(inter, "geoms", []))
        dd = min((np.hypot(p.x - site[0], p.y - site[1]) for p in pts), default=80.0)
        dist.append(dd)
    dist = np.array(dist)
    sm = np.array([np.mean(np.take(dist, range(i - 3, i + 4), mode="wrap")) for i in range(len(dist))])
    ba = angs[int(np.argmin(sm))]
    rot = np.pi / 2 - ba
    Rm = np.array([[np.cos(rot), -np.sin(rot)], [np.sin(rot), np.cos(rot)]])
    proj2 = lambda P2: P2 @ Rm.T  # noqa: E731
    d = {"open_id": open_id, "closed_id": closed_id, "chain": chain, "n": len(ids),
         "open": _np.round(proj2(Po), 2).tolist(), "closed": _np.round(proj2(Pc), 2).tolist(),
         "ligands": [{"name": l["name"], "xy": _np.round(proj2(p), 2).tolist()} for l, p in zip(ligs, L2)],
         "site": _np.round(proj2(site), 2).tolist(),
         "rmsd": round(float(_np.sqrt((w ** 2).mean())), 2), "radius": 4.6,
         "source": f"RCSB PDB {open_id} (open) / {closed_id} (closed), chain {chain}"}
    json.dump(d, open(fp, "w"))
    return d


def outline(P, radius=5.2, smooth=3.0, simplify=None):
    """2D C-alpha points (Angstrom) -> smooth molecular-surface-like outline (shapely Polygon, largest part, cleft kept)."""
    from shapely.geometry import MultiPolygon, Point
    from shapely.ops import unary_union
    g = unary_union([Point(float(x), float(y)).buffer(radius, resolution=8) for x, y in P])
    g = g.buffer(-smooth, resolution=6).buffer(smooth, resolution=6)  # round off the bead edges, keep the cleft
    if isinstance(g, MultiPolygon):
        g = max(g.geoms, key=lambda q: q.area)
    from shapely.geometry import Polygon as SP
    return SP(g.exterior).simplify(radius * 0.06 if simplify is None else simplify)


# ════════════════ Organic anatomy: Wikimedia Commons SVG references (cached in the Supabase refdata bucket) ════════════════
def commons_svg(title: str):
    """'File:Heart diagram-en.svg' -> {"path": local svg with its <text> removed (the hand writes every label),
    "license", "artist", "url"} or None. Lookup order: disk cache, Supabase refdata/commons, the Commons API."""
    t = (title or "").strip()
    if not t:
        return None
    if not t.lower().startswith("file:"):
        t = "File:" + t
    slug = re.sub(r"[^A-Za-z0-9]+", "_", t[5:]).strip("_")[:80]
    os.makedirs(CACHE, exist_ok=True)
    fp, mp = os.path.join(CACHE, f"commons_{slug}.svg"), os.path.join(CACHE, f"commons_{slug}.json")
    if os.path.exists(fp) and os.path.exists(mp):
        return dict(json.load(open(mp)), path=fp)
    svg = meta = None
    cached = _get(f"{REF_BASE}/commons/{slug}.json")  # {"svg": ..., "title", "url", "license", "artist"}
    if cached:
        try:
            cj = json.loads(cached)
            svg = cj.pop("svg").encode()
            meta = json.dumps(cj).encode()
        except Exception:  # noqa: BLE001
            svg = meta = None
    if not svg or not meta:
        try:
            q = "https://commons.wikimedia.org/w/api.php?action=query&format=json&prop=imageinfo&iiprop=url|extmetadata&titles=" + urllib.parse.quote(t)
            p = list(json.loads(_get(q, 12))["query"]["pages"].values())[0]
            ii = p["imageinfo"][0]
            em = ii.get("extmetadata") or {}
            url = ii["url"].split("?")[0]
            if not url.lower().endswith(".svg"):
                return None
            svg = _get(url, 20)
            meta = json.dumps({"title": t, "url": url, "license": (em.get("LicenseShortName") or {}).get("value"),
                               "artist": re.sub(r"<[^>]+>", "", (em.get("Artist") or {}).get("value") or "")[:120]}).encode()
        except Exception:  # noqa: BLE001
            return None
    if not svg:
        return None
    s = svg.decode("utf-8", "ignore")
    s = re.sub(r"<text\b.*?</text>", "", s, flags=re.S)  # labels come from the hand, never baked into the picture
    s = re.sub(r"<flowRoot\b.*?</flowRoot>", "", s, flags=re.S)
    open(fp, "w").write(s)
    open(mp, "wb").write(meta)
    return dict(json.loads(meta), path=fp)
