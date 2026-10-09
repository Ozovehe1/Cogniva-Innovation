#!/usr/bin/env python3
"""
Generates scene.rml for "Genie", GeniusMap's tutor mascot (Rive Markup Language).

    python3 rive/genie/gen.py            # writes rive/genie/scene.rml
    rive rive/genie --verify             # check;  --screenshot --data=mood=4 --advance=30  to look

View model "Genie" (bound to the artboard; the app writes these by name):
    mood    number  0 idle (breathing, blinking) | 1 listening | 2 thinking | 3 talking |
                    4 happy (correct answer)     | 5 encouraging (wrong answer, kind)
    mouth   number  0..1 mouth opening for lip sync (used while talking)
    gazeX   number  -1..1 where the pupils look (left..right)
    gazeY   number  -1..1 (up..down)
A friendly round sprout-topped character: no skin tone, no culture-specific features.
"""
import math
import os

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'scene.rml')
FPS = 60
_n = [100]


def nid():
    _n[0] += 1
    return f'0:{_n[0]}'


IDS = {}


def oid(name):
    if name not in IDS:
        IDS[name] = nid()
    return IDS[name]


# Palette (ARGB): calm greens of the app, warm accents.
BODY = 'FF3E9A72'
BODY_DARK = 'FF2E7A58'
BELLY = 'FFBFE8D3'
INK = 'FF1D2A33'
WHITE = 'FFFFFFFF'
CHEEK = 'FFF7A08F'
MOUTH = 'FF5A2230'
TONGUE = 'FFE07A7A'
LEAF = 'FF6CC08A'
LEAF_DARK = 'FF3E9A72'
GOLD = 'FFF2B33D'
HEART = 'FFE8667A'
SOFT = 'FF9FB4C7'


def fill(c, name='Fill'):
    return f'<Fill name="{name}"><SolidColor colorValue="{c}" name="C"/></Fill>'


def stroke(c, t, name='Stroke'):
    return f'<Stroke thickness="{t}" cap="round" join="round" name="{name}"><SolidColor colorValue="{c}" name="C"/></Stroke>'


def shape(name, x, y, geom, paints, extra='', attrs=''):
    return f'<Shape x="{x}" y="{y}" {attrs} name="{name}" id="{oid(name)}">{geom}{paints}{extra}</Shape>'


def ellipse(w, h, name='Path', bind=''):
    i = f' id="{oid(name)}"' if bind else ''
    return f'<Ellipse width="{w}" height="{h}" name="{name}"{i}>{bind}</Ellipse>'


def node(name, x, y, children, attrs='', bind=''):
    return f'<Node x="{x}" y="{y}" {attrs} name="{name}" id="{oid(name)}">{bind}{"".join(children)}</Node>'


def arc_path(w, depth, closed=False, name='Path'):
    """A U (depth > 0) or an upside-down U (depth < 0) from (-w/2, 0) to (w/2, 0), with smooth round ends."""
    hw = w / 2
    down = math.pi / 2 if depth > 0 else -math.pi / 2
    d = abs(depth) * 0.55
    return (f'<PointsPath isClosed="{"true" if closed else "false"}" isClockwise="true" name="{name}">'
            f'<CubicDetachedVertex x="{-hw}" y="0" inRotation="{math.pi}" inDistance="0" outRotation="{down:.4f}" outDistance="{d:.2f}"/>'
            f'<CubicMirroredVertex x="0" y="{depth}" rotation="0" distance="{hw * 0.55:.2f}"/>'
            f'<CubicDetachedVertex x="{hw}" y="0" inRotation="{down:.4f}" inDistance="{d:.2f}" outRotation="0" outDistance="0"/></PointsPath>')


def heart_path(s, name='Path'):
    return (f'<PointsPath isClosed="true" isClockwise="true" name="{name}">'
            f'<StraightVertex x="0" y="{s * 0.9}"/>'
            f'<CubicDetachedVertex x="{-s}" y="{-s * 0.1}" inRotation="{math.pi / 2}" inDistance="{s * 0.5}" outRotation="{-math.pi / 2}" outDistance="{s * 0.45}"/>'
            f'<CubicDetachedVertex x="0" y="{-s * 0.35}" inRotation="{-math.pi * 0.85}" inDistance="{s * 0.5}" outRotation="{math.pi * 0.15}" outDistance="{s * 0.5}"/>'
            f'<CubicDetachedVertex x="{s}" y="{-s * 0.1}" inRotation="{-math.pi / 2}" inDistance="{s * 0.45}" outRotation="{math.pi / 2}" outDistance="{s * 0.5}"/>'
            f'</PointsPath>')


# ───────────── View model + converters ─────────────
VM, VM_INST = nid(), nid()
P = {k: nid() for k in ['mood', 'mouth', 'gazeX', 'gazeY']}
CONV_MOUTH, CONV_GX, CONV_GY = nid(), nid(), nid()


def bind(prop, key, conv=None):
    c = f' converterId="{conv}"' if conv else ''
    return f'<DataBindContext sourcePathIds="{VM}-{P[prop]}" propertyKey="{key}"{c}/>'


# ───────────── Drawing (first declared paints on top) ─────────────
eye_white = lambda n, x: shape(n, x, 0, ellipse(30, 34), fill(WHITE) + stroke(INK, 2.5))
pupil = lambda n, x: (shape(n + 'Shine', x + 3.5, -4.5, ellipse(5, 5), fill(WHITE))
                      + shape(n, x, 0, ellipse(15, 17), fill(INK)))

face = node('Face', 0, -62, [
    # mouths: open (talking, height from data), smile, grin
    node('MouthOpen', 0, 22, [
        shape('Tongue', 0, 4, ellipse(12, 6), fill(TONGUE), extra=f'<ClippingShape sourceId="{oid("MouthHole")}" name="Clip"/>'),
        shape('MouthHole', 0, 0, ellipse(22, 10, 'MouthHolePath', bind('mouth', 21, CONV_MOUTH)), fill(MOUTH)),
    ]),
    shape('Smile', 0, 19, arc_path(26, 11), stroke(INK, 3.2)),
    shape('Grin', 0, 16, arc_path(34, 20, closed=True), fill(MOUTH) + stroke(INK, 2.5)),
    shape('CheekL', -36, 12, ellipse(16, 9), fill(CHEEK)),
    shape('CheekR', 36, 12, ellipse(16, 9), fill(CHEEK)),
    node('Brows', 0, -30, [
        shape('BrowL', -22, 0, '<Rectangle width="17" height="4.5" cornerRadiusTL="2.25" name="Path"/>', fill(INK)),
        shape('BrowR', 22, 0, '<Rectangle width="17" height="4.5" cornerRadiusTL="2.25" name="Path"/>', fill(INK)),
    ]),
    node('HappyEyes', 0, -2, [
        shape('HappyEyeL', -22, 0, arc_path(22, -12), stroke(INK, 3.6)),
        shape('HappyEyeR', 22, 0, arc_path(22, -12), stroke(INK, 3.6)),
    ]),
    node('EyesMood', 0, -4, [
        node('EyesBlink', 0, 0, [
            node('PupilsMood', 0, 0, [
                node('PupilsGaze', 0, 2, [pupil('PupilL', -22), pupil('PupilR', 22)],
                     bind=bind('gazeX', 13, CONV_GX) + bind('gazeY', 14, CONV_GY)),
            ]),
            eye_white('EyeWhiteL', -22), eye_white('EyeWhiteR', 22),
        ]),
    ]),
])

body = node('Body', 100, 172, [
    shape('HandL', -60, -40, ellipse(20, 16), fill(BODY) + stroke(BODY_DARK, 2.5)),
    shape('HandR', 60, -40, ellipse(20, 16), fill(BODY) + stroke(BODY_DARK, 2.5)),
    face,
    shape('Belly', 0, -30, ellipse(66, 42), fill(BELLY)),
    shape('BodyShape', 0, -58, '<Rectangle width="118" height="112" cornerRadiusTL="52" name="Path"/>', fill(BODY) + stroke(BODY_DARK, 3)),
    node('Sprout', 0, -112, [
        shape('LeafL', -10, -12, ellipse(20, 11), fill(LEAF) + stroke(LEAF_DARK, 2), attrs='rotation="0.6"'),
        shape('LeafR', 10, -14, ellipse(22, 12), fill(LEAF) + stroke(LEAF_DARK, 2), attrs='rotation="-0.6"'),
        shape('Stem', 0, -4, '<Rectangle width="4" height="14" cornerRadiusTL="2" name="Path"/>', fill(LEAF_DARK)),
    ]),
])

extras = [
    node('Sparkles', 0, 0, [
        shape('Spark1', 34, 44, '<Star width="22" height="22" points="4" innerRadius="0.35" cornerRadius="1" name="Path"/>', fill(GOLD)),
        shape('Spark2', 168, 52, '<Star width="16" height="16" points="4" innerRadius="0.35" cornerRadius="1" name="Path"/>', fill(GOLD)),
        shape('Spark3', 160, 128, '<Star width="12" height="12" points="4" innerRadius="0.35" cornerRadius="1" name="Path"/>', fill(GOLD)),
        shape('Spark4', 42, 132, '<Star width="10" height="10" points="4" innerRadius="0.35" cornerRadius="1" name="Path"/>', fill(GOLD)),
    ]),
    node('Heart', 166, 70, [shape('HeartShape', 0, 0, heart_path(10), fill(HEART))]),
    node('ThoughtDots', 0, 0, [
        shape('Dot1', 150, 50, ellipse(8, 8), fill(SOFT)),
        shape('Dot2', 163, 36, ellipse(11, 11), fill(SOFT)),
        shape('Dot3', 180, 20, ellipse(15, 15), fill(SOFT)),
    ]),
    node('Waves', 30, 100, [
        shape('Wave1', 0, 0, '<PointsPath isClosed="false" name="Path"><StraightVertex x="4" y="-10"/><CubicMirroredVertex x="-2" y="0" rotation="1.5708" distance="6"/><StraightVertex x="4" y="10"/></PointsPath>', stroke(SOFT, 3)),
        shape('Wave2', -8, 0, '<PointsPath isClosed="false" name="Path"><StraightVertex x="4" y="-17"/><CubicMirroredVertex x="-4" y="0" rotation="1.5708" distance="10"/><StraightVertex x="4" y="17"/></PointsPath>', stroke(SOFT, 3)),
    ]),
]
shadow = shape('Shadow', 100, 182, ellipse(96, 12), fill('22000000'))

# ───────────── Animations ─────────────
# Every mood animation keys every mood-driven property (a state does not reset what another state keyed).
DEFAULTS = {
    ('Body', 'y'): 172, ('Body', 'rotation'): 0, ('Body', 'scaleX'): 1, ('Body', 'scaleY'): 1,
    ('Sprout', 'rotation'): 0, ('PupilsMood', 'x'): 0, ('PupilsMood', 'y'): 0,
    ('EyesMood', 'scaleX'): 1, ('EyesMood', 'scaleY'): 1, ('EyesMood', 'opacity'): 1, ('HappyEyes', 'opacity'): 0,
    ('Brows', 'y'): -30, ('BrowL', 'rotation'): 0, ('BrowR', 'rotation'): 0,
    ('MouthOpen', 'opacity'): 0, ('Smile', 'opacity'): 1, ('Grin', 'opacity'): 0,
    ('CheekL', 'opacity'): 0.8, ('CheekR', 'opacity'): 0.8,
    ('HandL', 'x'): -60, ('HandL', 'y'): -40, ('HandR', 'x'): 60, ('HandR', 'y'): -40,
    ('Sparkles', 'opacity'): 0, ('Heart', 'opacity'): 0, ('Heart', 'y'): 70, ('ThoughtDots', 'opacity'): 0, ('Waves', 'opacity'): 0,
    ('Shadow', 'scaleX'): 1, ('Spark1', 'scaleX'): 1, ('Spark1', 'scaleY'): 1, ('Spark2', 'scaleX'): 1, ('Spark2', 'scaleY'): 1,
    ('Dot1', 'opacity'): 1, ('Dot2', 'opacity'): 1, ('Dot3', 'opacity'): 1, ('Wave1', 'opacity'): 1, ('Wave2', 'opacity'): 1,
}
EASE = '<CubicEaseInterpolator x1="0.42" y1="0" x2="0.58" y2="1"/>'


def keys(track):
    """track: list of (frame, value). Eased between keys."""
    out = []
    for i, (f, v) in enumerate(track):
        last = i == len(track) - 1
        if last:
            out.append(f'<KeyFrameDouble value="{v}" frame="{f}" interpolationType="linear"/>')
        else:
            out.append(f'<KeyFrameDouble value="{v}" frame="{f}" interpolationType="cubic">{EASE}</KeyFrameDouble>')
    return ''.join(out)


def animation(name, dur, motion, loop=True, overrides=None):
    """motion: {(obj, prop): [(frame, value), ...]}; overrides: static values for this mood."""
    tracks = {}
    for k, v in DEFAULTS.items():
        tracks[k] = [(0, (overrides or {}).get(k, v))]
    for k, v in motion.items():
        tracks[k] = v
    by_obj = {}
    for (o, p), t in tracks.items():
        by_obj.setdefault(o, []).append((p, t))
    ko = ''.join(f'<KeyedObject objectId="{oid(o)}">' + ''.join(f'<KeyedProperty property="{p}">{keys(t)}</KeyedProperty>' for p, t in props) + '</KeyedObject>' for o, props in by_obj.items())
    aid = oid('anim_' + name)
    return f'<LinearAnimation loopValue="{"loop" if loop else "oneShot"}" fps="{FPS}" duration="{dur}" name="{name}" id="{aid}">{ko}</LinearAnimation>'


S = FPS  # one second
loop2 = lambda a, b, d: [(0, a), (d // 2, b), (d, a)]
anims = {
    'idle': animation('Idle', 3 * S, {
        ('Body', 'scaleY'): loop2(1, 1.035, 3 * S), ('Body', 'scaleX'): loop2(1, 0.985, 3 * S),
        ('Sprout', 'rotation'): [(0, -0.1), (90, 0.1), (180, -0.1)], ('Shadow', 'scaleX'): loop2(1, 0.97, 3 * S),
    }),
    'listening': animation('Listening', 2 * S, {
        ('Body', 'rotation'): [(0, -0.07), (60, -0.09), (120, -0.07)],
        ('Waves', 'opacity'): [(0, 0.35), (60, 1), (120, 0.35)], ('Wave2', 'opacity'): [(0, 1), (60, 0.3), (120, 1)],
        ('Sprout', 'rotation'): [(0, 0.15), (60, 0.22), (120, 0.15)],
    }, overrides={('EyesMood', 'scaleX'): 1.08, ('EyesMood', 'scaleY'): 1.1, ('Brows', 'y'): -34, ('PupilsMood', 'x'): -3}),
    'thinking': animation('Thinking', 2 * S, {
        ('Dot1', 'opacity'): [(0, 1), (40, 0.3), (80, 1), (120, 1)], ('Dot2', 'opacity'): [(0, 0.3), (40, 1), (80, 0.3), (120, 0.3)],
        ('Dot3', 'opacity'): [(0, 0.6), (60, 1), (120, 0.6)], ('Body', 'rotation'): loop2(0.04, 0.06, 2 * S),
        ('Sprout', 'rotation'): loop2(0.25, 0.32, 2 * S),
    }, overrides={('ThoughtDots', 'opacity'): 1, ('PupilsMood', 'x'): 5, ('PupilsMood', 'y'): -6, ('BrowR', 'rotation'): -0.28, ('Brows', 'y'): -33, ('Smile', 'opacity'): 0.6}),
    'talking': animation('Talking', S, {
        ('Body', 'y'): [(0, 172), (15, 170), (30, 172), (45, 170), (60, 172)], ('Body', 'scaleY'): [(0, 1), (15, 1.015), (30, 1), (45, 1.015), (60, 1)],
        ('Sprout', 'rotation'): [(0, -0.06), (30, 0.06), (60, -0.06)],
    }, overrides={('MouthOpen', 'opacity'): 1, ('Smile', 'opacity'): 0}),
    'happy': animation('Happy', 40, {
        ('Body', 'y'): [(0, 172), (12, 156), (24, 172), (40, 172)], ('Body', 'scaleY'): [(0, 0.94), (8, 1.06), (24, 0.96), (32, 1), (40, 0.94)],
        ('Shadow', 'scaleX'): [(0, 1), (12, 0.75), (24, 1), (40, 1)],
        ('HandL', 'y'): [(0, -92), (20, -100), (40, -92)], ('HandR', 'y'): [(0, -100), (20, -92), (40, -100)],
        ('Spark1', 'scaleX'): [(0, 0.6), (20, 1.25), (40, 0.6)], ('Spark1', 'scaleY'): [(0, 0.6), (20, 1.25), (40, 0.6)],
        ('Spark2', 'scaleX'): [(0, 1.2), (20, 0.6), (40, 1.2)], ('Spark2', 'scaleY'): [(0, 1.2), (20, 0.6), (40, 1.2)],
        ('Sprout', 'rotation'): [(0, -0.25), (20, 0.25), (40, -0.25)],
    }, overrides={('HappyEyes', 'opacity'): 1, ('EyesMood', 'opacity'): 0, ('Grin', 'opacity'): 1, ('Smile', 'opacity'): 0, ('Sparkles', 'opacity'): 1,
                  ('CheekL', 'opacity'): 0.95, ('CheekR', 'opacity'): 0.95, ('HandL', 'x'): -62, ('HandR', 'x'): 62, ('Brows', 'y'): -36}),
    'encouraging': animation('Encouraging', 2 * S, {
        ('Body', 'rotation'): [(0, 0), (30, 0.05), (60, 0), (90, 0.05), (120, 0)],
        ('Heart', 'y'): [(0, 78), (120, 52)], ('Heart', 'opacity'): [(0, 0), (20, 1), (95, 1), (120, 0)],
        ('HandR', 'y'): [(0, -78), (30, -84), (60, -78), (90, -84), (120, -78)],
    }, overrides={('BrowL', 'rotation'): -0.22, ('BrowR', 'rotation'): 0.22, ('Brows', 'y'): -32, ('PupilsMood', 'y'): 1, ('CheekL', 'opacity'): 0.75, ('CheekR', 'opacity'): 0.75, ('HandR', 'x'): 58}),
}
blink = (f'<LinearAnimation loopValue="loop" fps="{FPS}" duration="252" name="Blink" id="{oid("anim_blink")}">'
         f'<KeyedObject objectId="{oid("EyesBlink")}"><KeyedProperty property="scaleY">'
         '<KeyFrameDouble value="1" frame="0" interpolationType="hold"/><KeyFrameDouble value="1" frame="228" interpolationType="linear"/>'
         '<KeyFrameDouble value="0.08" frame="234" interpolationType="linear"/><KeyFrameDouble value="1" frame="242" interpolationType="hold"/>'
         '<KeyFrameDouble value="1" frame="252" interpolationType="hold"/></KeyedProperty></KeyedObject></LinearAnimation>')

# ───────────── State machine ─────────────
MOODS = ['idle', 'listening', 'thinking', 'talking', 'happy', 'encouraging']
SID = {m: nid() for m in MOODS}


def cond(k):
    return ('<TransitionViewModelCondition opValue="equal"><TransitionPropertyViewModelComparator><BindablePropertyNumber>'
            f'<DataBindContext sourcePathIds="{VM}-{P["mood"]}" propertyKey="636"/></BindablePropertyNumber></TransitionPropertyViewModelComparator>'
            f'<TransitionValueNumberComparator value="{k}"/></TransitionViewModelCondition>')


states = []
for i, m in enumerate(MOODS):
    trans = ''.join(f'<StateTransition stateToId="{SID[t]}" duration="{160 if t != "happy" else 90}">{cond(j)}</StateTransition>' for j, t in enumerate(MOODS) if t != m)
    states.append(f'<AnimationState x="{160 + i * 170}" y="{0 if i % 2 == 0 else 120}" animationId="{oid("anim_" + m.capitalize())}" id="{SID[m]}">{trans}</AnimationState>')
BLINK_STATE = nid()
SM = nid()
sm = (f'<StateMachine name="Genie" id="{SM}">'
      f'<StateMachineLayer name="Mood" id="{nid()}"><AnyState x="160" y="-140"/><ExitState x="400" y="-140"/>'
      f'<EntryState x="0" y="0"><StateTransition stateToId="{SID["idle"]}"/></EntryState>{"".join(states)}</StateMachineLayer>'
      f'<StateMachineLayer name="Blink" id="{nid()}"><AnyState x="160" y="-140"/><ExitState x="400" y="-140"/>'
      f'<EntryState x="0" y="0"><StateTransition stateToId="{BLINK_STATE}"/></EntryState>'
      f'<AnimationState x="160" y="0" animationId="{oid("anim_blink")}" id="{BLINK_STATE}"/></StateMachineLayer>'
      '</StateMachine>')

AB = nid()
artboard = (f'<Artboard defaultStateMachineId="{SM}" viewModelId="{VM}" viewModelInstanceId="{VM_INST}" width="200" height="200" name="Genie" id="{AB}">'
            + sm + ''.join(extras) + body + shadow + ''.join(anims.values()) + blink + '</Artboard>')

vm = (f'<ViewModel defaultInstanceId="{VM_INST}" name="Genie" id="{VM}">'
      + ''.join(f'<ViewModelPropertyNumber name="{k}" id="{v}"/>' for k, v in P.items())
      + f'<ViewModelInstance exports="true" name="Default" id="{VM_INST}">'
      + ''.join(f'<ViewModelInstanceNumber propertyValue="0" viewModelPropertyId="{v}"/>' for v in P.values())
      + '</ViewModelInstance></ViewModel>')
convs = (f'<DataConverterRangeMapper minInput="0" maxInput="1" minOutput="3" maxOutput="20" clampLower="true" clampUpper="true" name="MouthToHeight" id="{CONV_MOUTH}"/>'
         f'<DataConverterRangeMapper minInput="-1" maxInput="1" minOutput="-6" maxOutput="6" clampLower="true" clampUpper="true" name="GazeToX" id="{CONV_GX}"/>'
         f'<DataConverterRangeMapper minInput="-1" maxInput="1" minOutput="-5" maxOutput="5" clampLower="true" clampUpper="true" name="GazeToY" id="{CONV_GY}"/>')

doc = f'<Rive version="1" kind="fragment">\n{artboard}\n{vm}\n{convs}\n</Rive>\n'
# One element per line keeps diffs readable.
doc = doc.replace('><', '>\n<')
open(OUT, 'w').write(doc)
print('wrote', OUT, len(doc), 'bytes')
