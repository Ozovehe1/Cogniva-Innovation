# GeniusMap scene grammar (JSON) — you compose any visual from these primitives

Frame: 16:9, x from -7.1 to 7.1, y from -4 to 4 (units). Light paper background. Keep everything
inside x ±6.6, y ±3.6. Positions are [x, y] in frame units, or in data units when the object has
"on": "<axes or plane id>". Any number may be an expression string using params, trackers and
functions (sin cos tan asin acos atan atan2 exp log sqrt abs floor ceil sign min max clip step mod
lerp(a,b,s) smoothstep gauss(x,m,s) saw tri deg rad, constants pi e tau; use ** or ^ for powers).
An object whose fields mention a tracker is redrawn live every frame (3Blue1Brown ValueTracker style).

```
{
 "title": "short",
 "mode": "2d" | "3d",
 "camera": {"phi": 65, "theta": -50, "zoom": 1},          // 3d only: initial view
 "params": {"g": 9.8, "v0": 12},                            // real numbers used by expressions
 "quantities": [{"id": "v", "name": "velocity", "color": "navy", "symbol": "\\vec v"}],
 "trackers": [{"id": "t", "value": 0}],
 "objects": [ ... ],                                        // built in order; refer only to earlier ids
 "timeline": [ ... ]
}
```

## Colour = quantity (the core rule)
Quantity colours: green, clay, navy, amber, plum, teal, rose, olive — each quantity gets ONE, no two
quantities share one, and every object or equation term that shows that quantity uses `"q": "<id>"`
(never a raw colour). Everything that is not a quantity uses "color": "ink" (default), "muted" (axes,
guides, secondary labels) or "rule" (faint guides). Never use a quantity colour without "q".

## Objects (common fields: id, kind, q | color, width (stroke, default 3.5), fill (0..1 tint, use 0.15-0.3),
## dashed, z, rotate (deg), on, and placement for text-like objects: at | next_to | edge, shift, backdrop)
- dot {at, r}
- line {from, to, extend?, dashed?}      arrow / vector {from? (default origin of `on` or [0,0]), to}
- arc {center, r, start (deg), angle (deg)}   circle {center, r}   ellipse {center, w, h, angle?}
- rect {center, w, h, corner?, angle?}   polygon {points: [[x,y],...]}
- path {points, smooth?: true for a smooth curve through the points, closed?}
- bezier {points: 4, 7, 10... cubic control points (segments share end points)}
- curve {fn: "[x(s), y(s)]" (or 3 values in 3d), range: [s0, s1]}      // parametric, any shape
- axes {x: [min,max,step], y: [min,max,step], size: [w,h], center: [x,y], labels: ["x","y"] (LaTeX), numbers?: true}
- plane {x: [min,max,step], y: [..], size?, center?}   // NumberPlane grid that can be warped / matrix-transformed
- axes3d {x, y, z ranges, size: [w,h,d]}               // 3d mode
- graph {on: axes, fn: "expression in x", x: [a,b]}    // y = f(x); may use trackers
- area {on: axes, graph, x: [a,b], bounded?: other graph id}
- riemann {on: axes, graph, x: [a,b], dx, sample?: "left"|"right"|"center"}
- tangent {on: axes, graph, x, length}      secant {on: axes, graph, x, h, extend?}
- surface {on: axes3d, fn: "z(u,v)" or "[x,y,z]", u: [a,b], v: [a,b], fill?}
- field {fn: "[fx(x,y), fy(x,y)]", x: [min,max,step], y: [..], stream?: true}   // vector field / stream lines
- text {text: plain words only, size: 24-36}                  // NEVER put LaTeX or backslashes in text
- tex {tex: LaTeX math, size: 32-48, terms: {"<term LaTeX>": "<quantity id>"}}
     Mark every term you will colour, link or transform as its own group with double braces:
     "{{F}} = {{m}}\\,{{a}}". Each {{group}} and each piece between groups must compile on its own
     (balanced braces; no \\begin/\\end or \\left/\\right split across groups). Same term string in two
     equations = same term for match_tex.
- matrix {rows: [["2","-1"],["1","1"]], col_q?: [qid per column], row_q?}  // entries are LaTeX
- number {value: expression, decimals, prefix?: LaTeX, suffix?: LaTeX}       // live readout
- brace {target, dir, label?: LaTeX, term?: term of an equation}
- angle {lines: [lineId, lineId], r, label?: LaTeX, other?}
- array {of: {object template, e.g. {"kind":"dot","r":0.06,"q":"w"}}, n, layout: "random"|"grid"|"circle"|"line",
         box: [x0,y0,x1,y1], cols?, points?: [[x,y],...]}   // particles, molecules, repeated parts
- group {children: [ids]}        trace {target: dot id}  (draws the path a moving dot leaves)
Placement for text / tex / matrix / number / brace labels: "at": [x,y] | "next_to": [id, "up|down|left|right|ul|ur|dl|dr", optional term LaTeX or "start"|"end"|"mid"]
| "edge": "UL"|"UR"|"DL"|"DR"|"UP"|"DOWN". Labels next to arrows sit at the arrow tip. "backdrop": true puts
a paper-coloured card behind text that sits over a grid.

Real objects (a transformer core, a mitochondrion, a gear, a guitar string, a heart valve...) are not
presets: build a simplified, recognisable construction from these primitives (rects, ellipses, bezier
outlines, paths, arrays of repeated parts, curves for coils and waves), labelled sparingly.

## Timeline — every entry is ONE flat object: {"cue": "<exact narration word or phrase>", "dur": seconds, "do": "<action>", ...fields}
Example: {"cue": "slide", "dur": 3.5, "do": "set", "values": {"h": 0.05}, "rate": "smooth"}
         {"cue": "secant", "dur": 1.2, "do": "show", "targets": ["sec", "secLabel"]}
         {"cue": "derivative", "dur": 1.5, "do": "match_tex", "from": "slope", "to": "deriv"}
- show {targets: [ids]}      (draws lines/curves, writes text and maths, grows arrows, fades in fills and particles)
- hide {targets}
- set {values: {trackerId: value}, rate?: "linear"|"smooth"}     // drives every live object
- morph {from, to}            // reshape one object continuously into another (the `to` object must not be shown yet)
- match_tex {from, to, key_map?}   // equation to equation, term by term
- move {targets, to: [x,y] | by: [dx,dy] | next_to: [id, dir]}     rotate {targets, angle (deg), about?: [x,y]}
- scale {targets, factor}     follow {targets, path: id of a path/curve/circle}
- matrix {targets, m: [[a,b],[c,d]]}        // linear map of planes, vectors, shapes
- warp {targets, fn: "[x', y']" in x, y}    // non-linear map of a plane or shape
- camera {zoom, center: [x,y]} (2d) | {phi, theta, zoom} or {spin: degrees per second, 0 to stop} (3d)
- indicate {targets}   circle {targets}   link {eq, term, target}  // ties an equation term to the object it describes
- color {targets, q}   drift {targets: [array id], box: [x0,y0,x1,y1], fraction?}  // particles wander into the box
- wait {}
Actions with the same cue run together. Objects appear only through a "show" action (nothing is visible before). Something should be moving whenever the voice is talking.

## Craft rules (3Blue1Brown, on a light board)
1. One colour per quantity, the same in shapes, labels and equation terms, for the whole clip.
2. Continuity: objects stay and evolve; prefer morph / match_tex / set over hide + show of a new thing.
3. Show the mechanism, not words: at most ~12 words of text on screen; equations short.
4. Accurate scale and motion: put the real numbers in params, scale axes to them, and drive motion
   with trackers through the real formulas (a projectile follows y = v0 t - g t^2 / 2, not a guess).
5. Link each equation term to its object (terms + link) the moment it is spoken.
6. Clean layout: titles top-left or none, labels beside (not on) what they name, nothing overlapping,
   nothing outside the frame.

## Complete minimal example
{"title": "Slope of a secant", "mode": "2d", "params": {"x0": 1},
 "quantities": [{"id": "f", "name": "the curve", "color": "navy"}, {"id": "m", "name": "slope", "color": "clay"}],
 "trackers": [{"id": "h", "value": 1.5}],
 "objects": [
  {"id": "ax", "kind": "axes", "x": [-1, 4, 1], "y": [-1, 5, 1], "size": [7, 5], "center": [-2.5, -0.3], "labels": ["x", "y"]},
  {"id": "curve", "kind": "graph", "on": "ax", "fn": "0.4*x^2 + 0.5", "x": [-0.8, 3.4], "q": "f"},
  {"id": "P", "kind": "dot", "on": "ax", "at": ["x0", "0.4*x0^2 + 0.5"]},
  {"id": "Q", "kind": "dot", "on": "ax", "at": ["x0 + h", "0.4*(x0 + h)^2 + 0.5"]},
  {"id": "sec", "kind": "secant", "on": "ax", "graph": "curve", "x": "x0", "h": "h", "q": "m"},
  {"id": "slope", "kind": "tex", "tex": "{{m}} = \\frac{f(x+h) - f(x)}{h}", "terms": {"m": "m"}, "at": [3.6, 1.5]},
  {"id": "mval", "kind": "number", "value": "0.4*(2*x0 + h)", "decimals": 2, "prefix": "m =", "q": "m", "next_to": ["slope", "down"]}
 ],
 "timeline": [
  {"cue": "curve", "dur": 1.5, "do": "show", "targets": ["ax", "curve"]},
  {"cue": "point", "dur": 0.8, "do": "show", "targets": ["P", "Q"]},
  {"cue": "line", "dur": 1.0, "do": "show", "targets": ["sec", "slope", "mval"]},
  {"cue": "slope", "dur": 1.2, "do": "link", "eq": "slope", "term": "m", "target": "sec"},
  {"cue": "shrink", "dur": 4.0, "do": "set", "values": {"h": 0.02}}
 ]}
