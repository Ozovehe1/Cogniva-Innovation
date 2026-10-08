"""gm_mesh3d: a small exact-geometry 3D engine for mechanisms that only read correctly in 3D (bevel gears, shafts, wheels).

Parts are real solids (bevel gears built on their pitch cones with tapered teeth, cylinders), posed every frame from the
World state (each part's angle about its own axis, carried parts riding on the carrier), lit with a key light and
rasterised (painter's order, supersampled) into an RGBA image that a manim ImageMobject shows. A slow camera orbit
makes the depth readable. Projected anchor points let labels and the hand's annotations follow a part in 3D.
"""
from __future__ import annotations

import math

import numpy as np


def _hex(c):
    c = c.lstrip("#")
    return np.array([int(c[i:i + 2], 16) for i in (0, 2, 4)], float)


def rot_axis(axis, ang):
    a = np.asarray(axis, float)
    a = a / (np.linalg.norm(a) + 1e-12)
    x, y, z = a
    c, s = math.cos(ang), math.sin(ang)
    C = 1 - c
    return np.array([[c + x * x * C, x * y * C - z * s, x * z * C + y * s],
                     [y * x * C + z * s, c + y * y * C, y * z * C - x * s],
                     [z * x * C - y * s, z * y * C + x * s, c + z * z * C]])


def frame_z_to(d):
    """rotation taking local +z to direction d"""
    d = np.asarray(d, float)
    d = d / np.linalg.norm(d)
    z = np.array([0, 0, 1.0])
    v = np.cross(z, d)
    s = np.linalg.norm(v)
    if s < 1e-9:
        return np.eye(3) if d[2] > 0 else np.diag([1, -1, -1.0])
    return rot_axis(v, math.atan2(s, float(z @ d)))


class Mesh:
    """vertices (n,3) in the part's local frame; faces: list of vertex-index lists; per-face base colour and a tag."""

    def __init__(self):
        self.v: list = []
        self.f: list = []
        self.c: list = []

    def add_v(self, p):
        self.v.append(np.asarray(p, float))
        return len(self.v) - 1

    def add_f(self, idx, color):
        self.f.append(list(idx))
        self.c.append(np.asarray(color, float))

    def finish(self):
        self.V = np.array(self.v)
        n = max(len(f) for f in self.f)
        # pad faces to a fixed width (repeat the last index) for vectorised centroids / normals
        self.F = np.array([f + [f[-1]] * (n - len(f)) for f in self.f])
        self.L = np.array([len(f) for f in self.f])
        self.C = np.array(self.c)
        return self


def bevel_gear(N, module, pitch_deg, face_frac=0.3, color="#B9B2A0", hole=0.0, back=0.0, tooth_color=None):
    """Bevel gear on its pitch cone; local +z is the gear axis pointing from the cone apex (origin) to the gear.
    Teeth taper toward the apex (every tooth dimension scales with cone distance). Returns (Mesh, info)."""
    g = math.radians(pitch_deg)
    Rp = N * module / 2  # outer pitch radius
    Lo = Rp / math.sin(g)
    F = face_frac * Lo
    Li = Lo - F
    add, ded = module, 1.25 * module
    base = _hex(color)
    tc = _hex(tooth_color) if tooth_color else base
    m = Mesh()
    pitch = 2 * math.pi / N
    # trapezoid tooth: angular half-widths at root and tip (tooth thickness ~ half the pitch at the pitch cone)
    wr, wt = 0.30 * pitch, 0.13 * pitch

    def P(L, th, h):
        s = L / Lo  # taper
        r = L * math.sin(g) + h * s * math.cos(g)
        z = L * math.cos(g) - h * s * math.sin(g)
        return (r * math.cos(th), r * math.sin(th), z)

    ring_o, ring_i = [], []
    for k in range(N):
        th = k * pitch
        ids = {}
        for L, tag in ((Lo, "o"), (Li, "i")):
            ids[tag] = [m.add_v(P(L, th - wr, -ded)), m.add_v(P(L, th - wt, add)), m.add_v(P(L, th + wt, add)), m.add_v(P(L, th + wr, -ded))]
        o, i = ids["o"], ids["i"]
        m.add_f(o, tc * 0.92)  # outer end of the tooth
        m.add_f(i[::-1], tc * 0.92)  # inner end
        m.add_f([o[1], o[2], i[2], i[1]], tc * 1.05)  # top land
        m.add_f([o[0], o[1], i[1], i[0]], tc)  # flanks
        m.add_f([o[2], o[3], i[3], i[2]], tc)
        ring_o.append((o[0], o[3]))
        ring_i.append((i[0], i[3]))
    for k in range(N):  # root lands between teeth
        a_o, b_o = ring_o[k][1], ring_o[(k + 1) % N][0]
        a_i, b_i = ring_i[k][1], ring_i[(k + 1) % N][0]
        m.add_f([a_o, b_o, b_i, a_i], base * 0.8)
    # end faces: annuli from the root circle to the bore (outer end = back of the gear, inner end = toe)
    for ring, L in ((ring_o, Lo), (ring_i, Li)):
        zz = L * math.cos(g) + ded * (L / Lo) * math.sin(g)
        rh = hole * (L / Lo) if hole else 0.0
        pts = [i for pair in ring for i in pair]
        if back and L == Lo:
            zz2 = zz + back
        for j in range(len(pts)):
            p0, p1 = m.v[pts[j]], m.v[pts[(j + 1) % len(pts)]]
            a0, a1 = math.atan2(p0[1], p0[0]), math.atan2(p1[1], p1[0])
            if rh > 0:
                q0 = m.add_v((rh * math.cos(a0), rh * math.sin(a0), zz))
                q1 = m.add_v((rh * math.cos(a1), rh * math.sin(a1), zz))
                m.add_f([pts[j], pts[(j + 1) % len(pts)], q1, q0], base * (0.85 if L == Lo else 0.95))
            else:
                c0 = m.add_v((0, 0, zz))
                m.add_f([pts[j], pts[(j + 1) % len(pts)], c0], base * (0.85 if L == Lo else 0.95))
    info = {"Rp": Rp, "Lo": Lo, "Li": Li, "pitch_rad": g, "center_z": (Lo + Li) / 2 * math.cos(g), "outer_r": Rp + add}
    return m.finish(), info


def cylinder(r, z0, z1, color, seg=28, stripes=0, stripe_color=None, caps=True, r1=None):
    """cylinder (or frustum) along local z; `stripes` dark bands on the side so its rotation is visible"""
    m = Mesh()
    r1 = r if r1 is None else r1
    base = _hex(color)
    sc = _hex(stripe_color) if stripe_color else base * 0.55
    bot = [m.add_v((r * math.cos(2 * math.pi * k / seg), r * math.sin(2 * math.pi * k / seg), z0)) for k in range(seg)]
    top = [m.add_v((r1 * math.cos(2 * math.pi * k / seg), r1 * math.sin(2 * math.pi * k / seg), z1)) for k in range(seg)]
    for k in range(seg):
        k2 = (k + 1) % seg
        cc = sc if stripes and (k * stripes // seg) % 2 == 0 and stripes < seg else (sc if stripes >= seg and k % 2 == 0 else base)
        m.add_f([bot[k], bot[k2], top[k2], top[k]], cc)
    if caps:
        m.add_f(bot[::-1], base * 0.9)
        m.add_f(top, base * 0.9)
    return m.finish()


def tyre(R, width, z0, color="#2B2B30", seg=40, tread=20):
    """tyre: a short cylinder with tread blocks (alternating bands) and a lighter hub face"""
    m = Mesh()
    base = _hex(color)
    dark_ = base * 0.6
    rim = _hex("#9AA3AD")
    z1 = z0 + width
    bot = [m.add_v((R * math.cos(2 * math.pi * k / seg), R * math.sin(2 * math.pi * k / seg), z0)) for k in range(seg)]
    top = [m.add_v((R * math.cos(2 * math.pi * k / seg), R * math.sin(2 * math.pi * k / seg), z1)) for k in range(seg)]
    for k in range(seg):
        k2 = (k + 1) % seg
        m.add_f([bot[k], bot[k2], top[k2], top[k]], dark_ if (k * tread // seg) % 2 == 0 else base)
    for zz, ring in ((z0, bot), (z1, top)):
        rr = [m.add_v((0.62 * R * math.cos(2 * math.pi * k / seg), 0.62 * R * math.sin(2 * math.pi * k / seg), zz)) for k in range(seg)]
        c0 = m.add_v((0, 0, zz))
        for k in range(seg):
            k2 = (k + 1) % seg
            m.add_f([ring[k], ring[k2], rr[k2], rr[k]], base * 0.85)
            m.add_f([rr[k], rr[k2], c0], rim * (0.9 if k % 5 else 0.7))  # wheel disc with 8 lug marks so it visibly turns
    return m.finish()


def box(x0, y0, z0, x1, y1, z1, color):
    m = Mesh()
    c = _hex(color)
    P = [m.add_v(p) for p in [(x0, y0, z0), (x1, y0, z0), (x1, y1, z0), (x0, y1, z0), (x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1)]]
    for f in ([0, 1, 2, 3], [4, 5, 6, 7], [0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7]):
        m.add_f([P[i] for i in f], c)
    return m.finish()


class Camera:
    """orbit camera around `target`; perspective with a long lens (mild foreshortening)"""

    def __init__(self, az_deg, el_deg, dist=14.0, target=(0, 0, 0)):
        self.set(az_deg, el_deg, dist, target)

    def set(self, az_deg, el_deg, dist=14.0, target=(0, 0, 0)):
        az, el = math.radians(az_deg), math.radians(el_deg)
        self.t = np.asarray(target, float)
        self.eye = self.t + dist * np.array([math.cos(el) * math.sin(az), math.cos(el) * math.cos(az), math.sin(el)])
        f = self.t - self.eye
        self.fw = f / np.linalg.norm(f)
        up = np.array([0, 0, 1.0])
        self.rt = np.cross(self.fw, up)
        self.rt /= np.linalg.norm(self.rt)
        self.up = np.cross(self.rt, self.fw)
        self.dist = dist

    def project(self, X):
        d = X - self.eye
        z = d @ self.fw
        x = d @ self.rt
        y = d @ self.up
        s = self.dist / np.maximum(z, 1e-3)
        return np.stack([x * s, y * s], -1), z


class Assembly:
    """parts = list of (mesh, pose_fn(state) -> (R, t)); render(state, cam) -> RGBA uint8 image of the box"""

    def __init__(self, light=(-0.45, 0.35, 0.82)):
        self.parts = []
        self.light = np.asarray(light, float) / np.linalg.norm(light)

    def add(self, mesh, pose, tag=None):
        self.parts.append((mesh, pose, tag))

    def world(self, st):
        Vs, Fs, Cs, Ls = [], [], [], []
        off = 0
        for mesh, pose, _ in self.parts:
            R, t = pose(st)
            V = mesh.V @ R.T + t
            Vs.append(V)
            Fs.append(mesh.F + off)
            Cs.append(mesh.C)
            Ls.append(mesh.L)
            off += len(V)
        return np.vstack(Vs), np.vstack([np.pad(F, ((0, 0), (0, max(f.shape[1] for f in Fs) - F.shape[1])), mode="edge") for F in Fs]), np.vstack(Cs), np.concatenate(Ls)

    def render(self, st, cam, box_units, px_per_unit, scale, center2d, ss=2, edge=True):
        """box_units: (w, h) of the image in manim units; scale: projected units -> manim units; center2d: projected
        point drawn at the image centre."""
        from PIL import Image, ImageDraw
        V, F, C, L = self.world(st)
        P2, Z = cam.project(V)
        W = int(round(box_units[0] * px_per_unit * ss))
        H = int(round(box_units[1] * px_per_unit * ss))
        k = scale * px_per_unit * ss
        X = (P2[:, 0] - center2d[0]) * k + W / 2
        Y = H / 2 - (P2[:, 1] - center2d[1]) * k
        # face normals (Newell, robust for any polygon) and depth
        A, Bv, Cv = V[F[:, 0]], V[F[:, 1]], V[F[:, 2]]
        n = np.cross(Bv - A, Cv - A)
        Fall = V[F]
        nn = np.zeros_like(n)
        for j in range(F.shape[1]):
            a = Fall[:, j]
            b = Fall[:, (j + 1) % F.shape[1]]
            nn += np.stack([(a[:, 1] - b[:, 1]) * (a[:, 2] + b[:, 2]), (a[:, 2] - b[:, 2]) * (a[:, 0] + b[:, 0]), (a[:, 0] - b[:, 0]) * (a[:, 1] + b[:, 1])], -1)
        nn = np.where(np.linalg.norm(nn, axis=1, keepdims=True) > 1e-12, nn, n)
        nn /= np.linalg.norm(nn, axis=1, keepdims=True) + 1e-12
        cen = Fall.mean(1)
        view = cam.eye - cen
        view /= np.linalg.norm(view, axis=1, keepdims=True) + 1e-12
        nn = np.where((nn * view).sum(1, keepdims=True) < 0, -nn, nn)  # two-sided: face the camera
        lam = np.clip(nn @ self.light, 0, 1)
        hv = self.light + view
        hv /= np.linalg.norm(hv, axis=1, keepdims=True)
        spec = np.clip((nn * hv).sum(1), 0, 1) ** 24
        shade = 0.38 + 0.62 * lam
        col = np.clip(C * shade[:, None] + 255 * 0.35 * spec[:, None], 0, 255)
        depth = (cen - cam.eye) @ cam.fw
        order = np.argsort(-depth)
        img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        dr = ImageDraw.Draw(img)
        for i in order:
            nv = L[i]
            idx = F[i, :nv]
            pts = list(zip(X[idx].tolist(), Y[idx].tolist()))
            c = tuple(int(v) for v in col[i]) + (255,)
            if edge:
                e = tuple(int(v * 0.55) for v in col[i]) + (255,)
                dr.polygon(pts, fill=c, outline=e)
            else:
                dr.polygon(pts, fill=c)
        if ss > 1:
            img = img.resize((W // ss, H // ss), Image.LANCZOS)
        return np.array(img)


def differential_assembly(ring_teeth=37, pinion_teeth=11, side_teeth=16, spider_teeth=10, track=4.4, wheel_r=0.8, shaft_len=2.4):
    """Open bevel differential, rear axle: X = axle (left -> right), Y = forward (drive shaft to the engine), Z = up.
    State keys: aL, aR (wheel / side-gear angles), aC (carrier = ring gear angle). Everything else is derived:
    pinion angle = -aC * ring/pinion teeth; spider spin = (aR - aL)/2 * side/spider teeth (relative to the carrier)."""
    A = Assembly()
    steel, ringc, sidec, spidc, carc = "#AEB4BB", "#C9A24A", "#6F95BD", "#E0B25A", "#6E747C"
    # ring + pinion: one module, 90 degree shafts, common apex at the origin
    Rr = 1.0
    m1 = 2 * Rr / ring_teeth
    gp = math.degrees(math.atan2(pinion_teeth, ring_teeth))
    ring, ri = bevel_gear(ring_teeth, m1, 90 - gp, face_frac=0.24, color=ringc, hole=0.62)
    pin, pi_ = bevel_gear(pinion_teeth, m1, gp, face_frac=0.26, color=ringc)
    # side + spider gears inside the carrier: one module, common apex at the origin
    rs = 0.40
    m2 = 2 * rs / side_teeth
    gsd = math.degrees(math.atan2(spider_teeth, side_teeth))
    side, si = bevel_gear(side_teeth, m2, 90 - gsd, face_frac=0.32, color=sidec, hole=0.06)
    spid, spi = bevel_gear(spider_teeth, m2, gsd, face_frac=0.32, color=spidc, hole=0.05)
    zR = frame_z_to((1, 0, 0))  # ring axis along +x: its teeth face the apex from the right side
    zP = frame_z_to((0, 1, 0))  # pinion axis along +y (forward)
    xw = track / 2
    pin_phase = math.pi / pinion_teeth  # half a tooth so pinion teeth sit in the ring's gaps
    sp_phase = math.pi / spider_teeth

    def carrier_R(st):
        return rot_axis((1, 0, 0), st.get("aC", 0.0))
    # ring gear (bolted to the carrier flange)
    A.add(ring, lambda st: (carrier_R(st) @ zR, np.zeros(3)), "ring_gear")
    A.add(pin, lambda st: (zP @ rot_axis((0, 0, 1), -st.get("aC", 0.0) * ring_teeth / pinion_teeth + pin_phase), np.zeros(3)), "pinion")
    shaft = cylinder(0.11, pi_["Lo"] * math.cos(math.radians(gp)) + 0.05, shaft_len, steel, seg=16, stripes=4)
    A.add(shaft, lambda st: (zP @ rot_axis((0, 0, 1), -st.get("aC", 0.0) * ring_teeth / pinion_teeth), np.zeros(3)), "drive_shaft")
    # side gears on the axles (left faces +x toward the centre, right faces -x)
    zSL, zSR = frame_z_to((-1, 0, 0)), frame_z_to((1, 0, 0))
    A.add(side, lambda st: (rot_axis((1, 0, 0), st.get("aL", 0.0)) @ zSL, np.zeros(3)), "side_gears")
    A.add(side, lambda st: (rot_axis((1, 0, 0), st.get("aR", 0.0)) @ zSR, np.zeros(3)), "side_gears")
    # spider gears on the cross pin (carried by the carrier, spinning on the pin when the wheel speeds differ)

    def spider_pose(sgn):
        def f(st):
            spin = (st.get("aR", 0.0) - st.get("aL", 0.0)) / 2 * side_teeth / spider_teeth
            return carrier_R(st) @ frame_z_to((0, 0, sgn)) @ rot_axis((0, 0, 1), sgn * spin + sp_phase), np.zeros(3)
        return f
    A.add(spid, spider_pose(1), "spider_gears")
    A.add(spid, spider_pose(-1), "spider_gears")
    # carrier: cross pin, flange behind the ring gear, two struts and the far-side bearing hub (cutaway cage)
    pinL = si["Lo"] * 1.05
    A.add(cylinder(0.055, -pinL, pinL, steel, seg=12), lambda st: (carrier_R(st), np.zeros(3)), "carrier")
    xf = ri["center_z"] + 0.08
    flange = cylinder(0.80, 0, 0.07, carc, seg=40, stripes=8, stripe_color="#5A5F66")
    A.add(flange, lambda st: (carrier_R(st) @ zR, np.array([xf, 0, 0])), "carrier")
    xl = -si["center_z"] - 0.25
    for sgn in (1, -1):
        strut = box(xl, sgn * 0.5 - 0.06, -0.07, xf, sgn * 0.5 + 0.06, 0.07, carc)
        A.add(strut, lambda st, s=sgn: (carrier_R(st), np.zeros(3)), "carrier")
    hub = cylinder(0.24, 0, 0.3, carc, seg=24, stripes=6, stripe_color="#5A5F66")
    A.add(hub, lambda st: (carrier_R(st) @ zSL, np.array([xl, 0, 0])), "carrier")
    # axles and wheels (tyres with tread so their speed difference is visible)
    axL = cylinder(0.09, si["center_z"] - 0.05, xw - 0.3, steel, seg=14, stripes=4)
    A.add(axL, lambda st: (rot_axis((1, 0, 0), st.get("aL", 0.0)) @ zSL, np.zeros(3)), "axle")
    A.add(axL, lambda st: (rot_axis((1, 0, 0), st.get("aR", 0.0)) @ zSR, np.zeros(3)), "axle")
    ty = tyre(wheel_r, 0.62, 0.0)
    A.add(ty, lambda st: (rot_axis((1, 0, 0), st.get("aL", 0.0)) @ zSL, np.array([-xw + 0.3, 0, 0])), "left_wheel")
    A.add(ty, lambda st: (rot_axis((1, 0, 0), st.get("aR", 0.0)) @ zSR, np.array([xw - 0.3, 0, 0])), "right_wheel")
    anchors = {  # 3D points (functions of state) the labels and annotations attach to
        "ring_gear": lambda st: carrier_R(st) @ np.array([0, 0, 0]) + np.array([ri["center_z"], 0, Rr * 0.92]),
        "pinion": lambda st: np.array([0, pi_["center_z"], pi_["Rp"] * 0.9]),
        "drive_shaft": lambda st: np.array([0, shaft_len * 0.8, 0.11]),
        "side_gears": lambda st: np.array([-si["center_z"], 0, -si["Rp"] * 0.9]),
        "spider_gears": lambda st: carrier_R(st) @ np.array([0, 0, spi["center_z"]]),
        "carrier": lambda st: carrier_R(st) @ np.array([xl * 0.5, 0.5, 0]),
        "axle": lambda st: np.array([-xw * 0.55, 0, 0.09]),
        "left_wheel": lambda st: np.array([-xw, 0, wheel_r]),
        "right_wheel": lambda st: np.array([xw, 0, wheel_r]),
        "differential": lambda st: np.array([0, 0, -0.8]),
    }
    extent = np.array([[-xw - 0.1, -wheel_r, -wheel_r], [xw + 0.1, shaft_len, wheel_r]])
    return A, anchors, extent
