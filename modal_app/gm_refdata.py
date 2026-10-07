"""Reference data where nature has an exact shape: molecule 2D coordinates (built-in table, RDKit from SMILES,
PubChem name -> SMILES), cached on disk. Every lookup degrades gracefully to None."""
from __future__ import annotations

import json
import math
import os
import re
import urllib.parse
import urllib.request

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
