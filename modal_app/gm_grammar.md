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
- axes {x: [min,max,step], y: [min,max,step], size: [w,h], center: [x,y], labels: ["Temperature (°C)","Efficiency (%)"] REQUIRED: quantity name AND unit for both axes (x label is drawn centred under the axis, y label above the y axis), numbers?: true (default; tick numbers on both axes)}
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
         box: [x0,y0,x1,y1], cols?, points?: [[x,y],...], angles?: [deg per item]}   // particles, molecules, repeated parts
- group {children: [ids]}        trace {target: dot id}  (draws the path a moving dot leaves)
- sector {center, r, start (deg), angle (deg), inner?: r for an annular sector}   // pie wedges, swept angles; an array of
     sectors morphed into an array of sectors at new centres / start angles is how a circle is cut and rearranged
- gear {center, r (pitch radius), teeth (the REAL count), depth?, angle (deg, may be a tracker expression), hub?: 0.22}
     Meshing gears: centres r1 + r2 apart, teeth proportional to radius, angle2 = -angle1 * teeth1 / teeth2 + half-tooth offset.
- svg {svg: "<svg viewBox=...>...</svg>" you write from the structure plan, each part a <path id="part_name" d="..."/>,
       or src: "https://upload.wikimedia.org/...svg" (open-licensed), center, w | h, keep_colors?, part_q?: {part_id: qid},
       fallback: [ids of a primitive build of the same thing, used if the SVG fails]}
     Each part becomes its own target "<svg id>.<part id>" (show / indicate / move / rotate / color it).
- 3d mode only: cylinder {center, r, h, axis}, prism {center, size: [w,h,d]}, sphere {center, r}, cone, torus {r, r2}
## Realism and motion fields (any object)
- "color": a material for a body that is not a quantity: steel brass copper rubber tissue protein membrane blood bone water wood silicon leaf glass plastic skin
- "shade": true with fill >= 0.5: sheen gradient, darker rim and a soft drop shadow (depth on a flat board)
- "region": left | right | center | top | bottom (the layout engine fits each region into its own zone; never overlap regions)
- "jiggle": amplitude (0.03-0.08) thermal wobble (molecules, particles)   "spin": degrees per second (steady rotation), "spin_about": [x,y]
- trackers may be steady: {"id": "th", "value": 0, "rate": 90} advances 90 units per second for the whole clip (gears turn,
  time flows); change the rate with the action speed {values: {"th": 30}}. Objects whose fields use "th" move continuously.
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
- set {values: {trackerId: value}, rate?: "linear"|"smooth", exact?: true}     // drives every live object; continuous
  drives stretch over the following narration gap unless "exact": true (use it when a readout must match a spoken number)
- morph {from, to}            // reshape one object continuously into another (the `to` object must not be shown yet)
     Rearrangements (unrolling wedges, assembling parts, a molecule changing shape): build the BEFORE and AFTER
     arrangements as two groups / arrays with the same number of parts in matching order and morph between them; each
     part travels to its counterpart. Or drive part positions with one tracker: "at": ["lerp(x0, x1, p)", "lerp(y0, y1, p)"].
- match_tex {from, to, key_map?}   // equation to equation, term by term
- move {targets, to: [x,y] | by: [dx,dy] | next_to: [id, dir]}     rotate {targets, angle (deg), about?: [x,y]}
- scale {targets, factor}     follow {targets, path: id of a path/curve/circle}
- matrix {targets, m: [[a,b],[c,d]]}        // linear map of planes, vectors, shapes
- warp {targets, fn: "[x', y']" in x, y}    // non-linear map of a plane or shape
- camera {zoom, center: [x,y]} (2d) | {phi, theta, zoom} or {spin: degrees per second, 0 to stop} (3d)
- indicate {targets}   circle {targets}   link {eq, term, target}  // ties an equation term to the object it describes
- color {targets, q}   drift {targets: [array id], box: [x0,y0,x1,y1], fraction?}  // particles wander into the box
- speed {values: {steadyTrackerId: new rate}}   // smoothly change how fast a steady tracker runs
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


## Examples of good structure (hand-made, scored well). Learn the STRUCTURE (regions, live trackers, one colour per
## quantity, linked terms, motion every sentence); do NOT copy their topics. Abbreviated: "..." marks omitted entries.
Ex 1 - a matrix moves the plane (plane + basis vectors driven by one tracker s while the plane is transformed):
{"quantities":[{"id":"i","name":"i hat","color":"green"},{"id":"j","name":"j hat","color":"clay"},{"id":"v","name":"v","color":"amber"}],
 "trackers":[{"id":"s","value":0}],
 "objects":[{"id":"plane","kind":"plane","x":[-7,7,1],"y":[-5,5,1],"size":[19.6,14],"center":[0,-1.3]},
  {"id":"ih","kind":"vector","q":"i","from":[0,-1.3],"to":["1.4*lerp(1,2,s)","-1.3+1.4*lerp(0,1,s)"],"width":6},
  {"id":"il","kind":"tex","tex":"\\hat{\\imath}","q":"i","next_to":["ih","dr"]},
  {"id":"M","kind":"matrix","rows":[["2","-1"],["1","1"]],"col_q":["i","j"],"edge":"UL","backdrop":true},
  {"id":"eq","kind":"tex","tex":"{{\\vec v}} = 1\\,{{\\hat{\\imath}}} + 2\\,{{\\hat{\\jmath}}}","terms":{"\\vec v":"v","\\hat{\\imath}":"i","\\hat{\\jmath}":"j"},"at":[4.6,3.15],"backdrop":true}, ...],
 "timeline":[{"cue":"matrix","dur":2.2,"do":"show","targets":["plane"]}, {"cue":"green one","dur":0.9,"do":"show","targets":["ih","il"]}, ...,
  {"cue":"apply","dur":3,"do":"matrix","targets":["plane"],"m":[[2,-1],[1,1]],"about":[0,-1.3]}, {"cue":"apply","dur":3,"do":"set","values":{"s":1}},
  {"cue":"one green","dur":1,"do":"link","eq":"eq","term":"\\hat{\\imath}","target":"ih"}]}
Ex 2 - secant to tangent (axes left, live formula + readouts right, camera zoom into the limit, match_tex to the derivative):
{"trackers":[{"id":"h","value":2}],
 "objects":[{"id":"ax","kind":"axes","region":"left","x":[-0.5,3.5,1],"y":[-0.5,5,1],"size":[6.2,5.8],"center":[-3.3,-0.4],"labels":["x","y"],"numbers":true},
  {"id":"curve","kind":"graph","on":"ax","fn":"0.5*x^2","q":"f"},
  {"id":"run","kind":"line","q":"h","on":"ax","from":[1,0.5],"to":["1+h",0.5]}, {"id":"hl","kind":"tex","tex":"h","q":"h","next_to":["run","down"]},
  {"id":"sec","kind":"secant","on":"ax","graph":"curve","x":1,"h":"h","q":"m"}, {"id":"tan","kind":"tangent","on":"ax","graph":"curve","x":1,"length":4.6,"q":"d"},
  {"id":"slope","kind":"tex","region":"right","tex":"{{m}} = \\frac{ {{f(1+h)-f(1)}} }{ {{h}} }","terms":{"m":"m","f(1+h)-f(1)":"r","h":"h"},"at":[3.7,2.3]},
  {"id":"deriv","kind":"tex","region":"right","tex":"{{f'(1)}} = \\lim_{h\\to 0}\\frac{ {{f(1+h)-f(1)}} }{ {{h}} }","terms":{"f'(1)":"d","f(1+h)-f(1)":"r","h":"h"},"at":[3.7,2.3]},
  {"id":"mval","kind":"number","region":"right","value":"1 + h/2","decimals":2,"prefix":"m =","q":"m","at":[3.7,-0.2]}, ...],
 "timeline":[..., {"cue":"slide","dur":4.9,"do":"set","values":{"h":1},"exact":true}, {"cue":"closer","dur":2,"do":"set","values":{"h":0.001}},
  {"cue":"limit","dur":1.4,"do":"camera","zoom":2.4,"center":[1,0.5],"on":"ax"}, {"cue":"the tangent","dur":0.9,"do":"morph","from":"sec","to":"tan"},
  {"cue":"its slope","dur":1.2,"do":"camera","zoom":1,"center":[0,0]}, {"cue":"derivative","dur":1.2,"do":"match_tex","from":"slope","to":"deriv"}]}
Ex 3 - a thrown ball (stage left driven by real physics, live readouts, two graphs right drawn as time advances):
{"params":{"v0":12,"g":9.8},"trackers":[{"id":"t","value":0}],
 "objects":[{"id":"ground","kind":"line","region":"left","from":[-6.4,-2.6],"to":[-2.8,-2.6],"color":"muted"},
  {"id":"ballm","kind":"dot","region":"left","at":[-4.6,"-2.42+0.75*(v0*t-0.5*g*t^2)"],"r":0.18},
  {"id":"varrow","kind":"arrow","region":"left","q":"v","from":[-4.6,"-2.42+0.75*(v0*t-0.5*g*t^2)"],"to":[-4.6,"-2.42+0.75*(v0*t-0.5*g*t^2)+0.08*(v0-g*t)"]},
  {"id":"vnum","kind":"number","region":"center","value":"v0 - g*t","decimals":1,"prefix":"v =","suffix":"\\mathrm{m/s}","q":"v","at":[-1.3,2.55]},
  {"id":"eq","kind":"tex","region":"center","tex":"{{v}} = {{v_0}} - {{g}}\\,{{t}}","terms":{"v":"v","v_0":"v","g":"g","t":"t"},"at":[-1.3,0.7]},
  {"id":"ax","kind":"axes","region":"right","x":[0,2.5,0.5],"y":[-15,15,5],"size":[5.2,2.9],"center":[3.8,-2],"labels":["t\\,(\\mathrm{s})","v"],"numbers":true},
  {"id":"vline","kind":"graph","on":"ax","fn":"v0 - g*x","x":[0,"max(t,0.002)"],"q":"v"}, {"id":"vdot","kind":"dot","on":"ax","at":["t","v0 - g*t"],"q":"v"}, ...],
 "timeline":[..., {"cue":"nine point eight","dur":1.2,"do":"link","eq":"eq","term":"g","target":"garrow"},
  {"cue":"from twelve","dur":1.75,"do":"set","values":{"t":1.0},"rate":"linear","exact":true}, {"cue":"so the velocity","dur":4.6,"do":"set","values":{"t":2.449},"rate":"linear","exact":true}]}
Ex 4 - a mechanism part (how to build a real object): two meshing steel gears, 20 and 10 teeth, turned by one steady tracker:
 {"trackers":[{"id":"th","value":0,"rate":60}],
  "objects":[{"id":"g1","kind":"gear","region":"left","center":[-4,0],"r":1.6,"teeth":20,"angle":"th","color":"steel","fill":0.7,"shade":true},
   {"id":"g2","kind":"gear","region":"left","center":[-1.6,0],"r":0.8,"teeth":10,"angle":"-2*th + 18","color":"brass","fill":0.7,"shade":true}]}
