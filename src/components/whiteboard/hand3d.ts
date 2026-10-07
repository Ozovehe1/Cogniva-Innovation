/**
 * The 3D hand that writes on the board (lazy-loaded; see HandOverlay in ./pen).
 *
 * A rigged, skinned glTF hand (WebXR Input Profiles "generic-hand", MIT licence,
 * © Immersive Web Community Group; public/whiteboard/hand-right.glb, meshopt
 * compressed) holding a modelled whiteboard marker in a writing grip: the marker
 * runs from the web of the thumb across the index finger's last joint, the index
 * pad presses it from above, the thumb pad opposes it from the other side, the
 * middle finger supports it from below, ring and little finger tuck into the palm.
 * The finger joints are posed by our own hinge model on top of the rig (the XR rig
 * ships flat, so it is rebuilt into finger chains first), and the fingers are fitted
 * to the marker's surface at load.
 *
 * Rendered with three.js through a perspective camera whose board plane maps 1:1 to
 * the overlay's pixels, lit by a soft sky light and a warm key light that casts a
 * real shadow onto the board (a transparent shadow-catcher plane). The marker tip
 * is the rig's origin and sits exactly on the pen point; lifting moves the hand
 * toward the camera so its shadow separates and softens, and the wrist and fingers
 * move a little while it writes.
 *
 * Skinning runs on the CPU (1.4k vertices) and only when the fingers move; the
 * device pixel ratio is capped and the shadow map is small so it stays light on phones.
 */
import * as THREE from 'three'
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'
import type { HandState } from './pen'

const DEG = Math.PI / 180
export const HAND_MODEL_URL = '/whiteboard/hand-right.glb'

let gltfPromise: Promise<GLTF> | null = null
/** Load (once) and parse the hand model. Safe to call early to warm the cache. */
export function loadHandModel(): Promise<GLTF> {
  if (!gltfPromise) {
    const loader = new GLTFLoader()
    loader.setMeshoptDecoder(MeshoptDecoder)
    gltfPromise = loader.loadAsync(HAND_MODEL_URL)
    gltfPromise.catch(() => { gltfPromise = null })
  }
  return gltfPromise
}

const SKIN = '#8a5a44'
const NAIL = '#c99583'
const CREASE = '#6d3d27'
const SLEEVE = '#e8e3d9'

/** Finger flexion in degrees: knuckle, middle joint, last joint; then spread at the knuckle. */
type Finger = [number, number, number, number]
const FINGERS = ['index', 'middle', 'ring', 'pinky'] as const
type FingerName = (typeof FINGERS)[number]

/**
 * The writing grip. The index finger lies along the marker with its pad on top; the middle finger's last bone
 * supports it from below; ring and little finger curl into the palm. The middle finger and thumb angles were
 * fitted (offline, by coordinate descent against the marker's surface without the fingers passing into it) so
 * that their pads rest on the marker.
 */
const GRIP: Record<FingerName, Finger> = {
  index: [30, 32, 8, 4],
  middle: [51, 40, 2, -12],
  ring: [66, 78, 40, -6],
  pinky: [72, 80, 42, -12],
}
/** Thumb: base swing across the palm, base flexion, base roll, then the two outer joints. Its pad presses the
 *  marker from the thumb side, a little behind the index pad. */
const THUMB = [-26, -8, 30, 20, 11]

/** Marker size and where it sits in the hand, as fractions of the hand's length (wrist to middle fingertip). */
/** How the hand is seen: thumb vs back-of-hand side toward the viewer, the marker's angle out of the board and on screen (deg). */
const VIEW = { thumb: 0.85, dorsal: 0.5, elev: 34, screen: 52, sink: 0.12 }
const GEOM = { radius: 0.042, length: 0.72, pitch: 44, cross: 0.35, beyond: 0.2 }

export interface Hand3D {
  render: (s: HandState) => void
  dispose: () => void
}

const JOINTS: Record<FingerName | 'thumb', string[]> = {
  thumb: ['thumb-metacarpal', 'thumb-phalanx-proximal', 'thumb-phalanx-distal', 'thumb-tip'],
  index: ['index-finger-metacarpal', 'index-finger-phalanx-proximal', 'index-finger-phalanx-intermediate', 'index-finger-phalanx-distal', 'index-finger-tip'],
  middle: ['middle-finger-metacarpal', 'middle-finger-phalanx-proximal', 'middle-finger-phalanx-intermediate', 'middle-finger-phalanx-distal', 'middle-finger-tip'],
  ring: ['ring-finger-metacarpal', 'ring-finger-phalanx-proximal', 'ring-finger-phalanx-intermediate', 'ring-finger-phalanx-distal', 'ring-finger-tip'],
  pinky: ['pinky-finger-metacarpal', 'pinky-finger-phalanx-proximal', 'pinky-finger-phalanx-intermediate', 'pinky-finger-phalanx-distal', 'pinky-finger-tip'],
}

/** A joint that turns about fixed axes in its parent's frame (a hinge or a two-axis knuckle). */
interface Joint { bone: THREE.Bone; rest: THREE.Quaternion; axes: THREE.Vector3[]; angles: number[] }

export async function createHand3D(root: HTMLElement, onLost?: () => void): Promise<Hand3D> {
  const gltf = await loadHandModel()

  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'low-power', premultipliedAlpha: true })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5))
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFSoftShadowMap
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.0
  renderer.setClearColor(0x000000, 0)
  const canvas = renderer.domElement
  Object.assign(canvas.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', opacity: '0', pointerEvents: 'none' })

  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(30, 1, 1, 10000)
  scene.add(new THREE.HemisphereLight(0xfff6ea, 0xb9ae9e, 1.25))
  const key = new THREE.DirectionalLight(0xfff0dc, 2.6)
  key.castShadow = true
  key.shadow.mapSize.set(1024, 1024)
  key.shadow.radius = 6
  key.shadow.bias = -0.0015
  key.shadow.normalBias = 1.2
  scene.add(key, key.target)
  const rim = new THREE.DirectionalLight(0xdfe8ff, 0.5)
  scene.add(rim, rim.target)

  // Shadow catcher on the board plane (z = 0).
  const board = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.ShadowMaterial({ opacity: 0.22, color: 0x2a2118, depthWrite: false }))
  board.receiveShadow = true
  scene.add(board)

  // ---- Rig: rebuild the flat XR joint list into chains (world transforms kept, so the skin binding holds).
  const model = cloneSkinned(gltf.scene)
  const bones = new Map<string, THREE.Bone>()
  let skinned: THREE.SkinnedMesh | null = null
  model.traverse(o => {
    if ((o as THREE.Bone).isBone) bones.set(o.name, o as THREE.Bone)
    if ((o as THREE.SkinnedMesh).isSkinnedMesh && !skinned) skinned = o as THREE.SkinnedMesh
  })
  if (!skinned) throw new Error('hand model has no skinned mesh')
  const sk = skinned as THREE.SkinnedMesh
  const B = (n: string) => {
    const b = bones.get(n)
    if (!b) throw new Error(`hand model is missing joint ${n}`)
    return b
  }
  model.updateMatrixWorld(true)
  const wrist = B('wrist')
  for (const chain of Object.values(JOINTS)) {
    let parent: THREE.Object3D = wrist
    for (const n of chain) { parent.attach(B(n)); parent = B(n) }
  }
  model.updateMatrixWorld(true)

  // Hand frame at rest (model space): along the fingers, toward the back of the hand, across toward the thumb.
  const P = (n: string) => B(n).getWorldPosition(new THREE.Vector3())
  const wristP = P('wrist')
  const along = P('middle-finger-phalanx-proximal').sub(wristP).normalize()
  const towardThumb = P('index-finger-phalanx-proximal').sub(P('pinky-finger-phalanx-proximal'))
  towardThumb.addScaledVector(along, -towardThumb.dot(along)).normalize()
  // Right hand: the back of the hand is along x thumb-side (checked against the thumb's position).
  const dorsal = new THREE.Vector3().crossVectors(along, towardThumb).normalize()
  {
    const tp = P('thumb-tip').sub(P('index-finger-phalanx-proximal'))
    if (tp.dot(dorsal) > 0.01) dorsal.negate()
  }
  const palm = dorsal.clone().negate()

  // Joint positions at rest (= the skin's bind space), for the nails and knuckle creases painted on below.
  const restP = new Map<string, THREE.Vector3>()
  bones.forEach((_, n) => restP.set(n, P(n)))

  const joints = new Map<string, Joint>()
  const worldQ = (o: THREE.Object3D) => o.getWorldQuaternion(new THREE.Quaternion())
  /** Make bone n a joint turning about the given model-space directions (fixed in its parent's frame). */
  const makeJoint = (n: string, dirs: THREE.Vector3[]) => {
    const bone = B(n)
    const pInv = worldQ(bone.parent!).invert()
    joints.set(n, { bone, rest: bone.quaternion.clone(), axes: dirs.map(d => d.clone().normalize().applyQuaternion(pInv)), angles: dirs.map(() => 0) })
  }
  for (const f of FINGERS) {
    const ch = JOINTS[f]
    for (let k = 1; k <= 3; k++) {
      const d = P(ch[k + 1]).sub(P(ch[k])).normalize()
      const flex = new THREE.Vector3().crossVectors(d, palm) // turning d about this moves it palm-ward
      makeJoint(ch[k], k === 1 ? [flex, dorsal.clone().negate()] : [flex])
    }
  }
  {
    // Thumb: the base swings across the palm (opposition) and flexes; the two outer joints are hinges whose
    // pads close toward the index finger.
    const ch = JOINTS.thumb
    const d0 = P(ch[1]).sub(P(ch[0])).normalize()
    makeJoint(ch[0], [along, new THREE.Vector3().crossVectors(d0, palm), d0])
    for (let k = 1; k <= 2; k++) {
      const d = P(ch[k + 1]).sub(P(ch[k])).normalize()
      const closeTo = P('index-finger-phalanx-intermediate').sub(P(ch[k]))
      closeTo.addScaledVector(d, -closeTo.dot(d)).normalize()
      makeJoint(ch[k], [new THREE.Vector3().crossVectors(d, closeTo)])
    }
  }
  const tq = new THREE.Quaternion()
  const applyJoints = () => {
    joints.forEach(j => {
      j.bone.quaternion.copy(j.rest)
      for (let i = j.axes.length - 1; i >= 0; i--) if (j.angles[i]) j.bone.quaternion.premultiply(tq.setFromAxisAngle(j.axes[i], j.angles[i] * DEG))
    })
    model.updateMatrixWorld(true)
  }
  const setFinger = (f: FingerName, a: Finger) => {
    const ch = JOINTS[f]
    const k = joints.get(ch[1])!
    k.angles[0] = a[0]; k.angles[1] = a[3]
    joints.get(ch[2])!.angles[0] = a[1]
    joints.get(ch[3])!.angles[0] = a[2]
  }
  const setThumb = (t: number[]) => {
    const ch = JOINTS.thumb
    const b = joints.get(ch[0])!
    b.angles[0] = t[0]; b.angles[1] = t[1]; b.angles[2] = t[2]
    joints.get(ch[1])!.angles[0] = t[3]
    joints.get(ch[2])!.angles[0] = t[4]
  }

  // ---- The grip (GRIP / THUMB) and the marker's line through it: under the index pad, pitched about 45 degrees
  // toward the palm from the back of the hand and angled across it toward the little finger, so its back end rises
  // over the web of the thumb.
  const handLen = P('middle-finger-tip').distanceTo(wristP)
  const R = handLen * GEOM.radius
  const L = handLen * GEOM.length
  const FR = handLen * 0.05 // finger half-thickness
  const restWQ = new Map<string, THREE.Quaternion>()
  bones.forEach((b, n) => restWQ.set(n, worldQ(b)))
  for (const f of FINGERS) setFinger(f, GRIP[f])
  setThumb(THUMB)
  applyJoints()
  const ich = JOINTS.index
  // Index pad: the palm-and-thumb side of its last bone, carried along with that bone's pose.
  const padN = palm.clone().addScaledVector(towardThumb, 0.3).normalize()
    .applyQuaternion(worldQ(B(ich[3])).multiply(restWQ.get(ich[3])!.clone().invert()))
  const contact = P(ich[3]).lerp(P(ich[4]), 0.45).addScaledVector(padN, FR * 0.75 + R * 0.95)
  const axisDir = along.clone().multiplyScalar(Math.cos(GEOM.pitch * DEG)).addScaledVector(palm, Math.sin(GEOM.pitch * DEG))
    .addScaledVector(towardThumb, -GEOM.cross).normalize() // toward the tip
  const tipP = contact.clone().addScaledVector(axisDir, handLen * GEOM.beyond)
  /** A unit direction across the marker, toward v. */
  const across = (v: THREE.Vector3) => v.clone().addScaledVector(axisDir, -v.dot(axisDir)).normalize()

  // ---- Skin: the low-poly rig mesh is subdivided once (Loop) for a smooth silhouette, painted per vertex (nails,
  // knuckle creases, a little unevenness in tone and gloss) and drawn as a plain mesh skinned on the CPU, re-skinned
  // only when the fingers move (no bone textures or skinning shaders, which some mobile GPUs choke on). Normals are
  // recomputed from the posed surface, so shading stays smooth through every pose.
  sk.visible = false
  const sub = subdivideSkinned(sk.geometry)
  const nV = sub.pos.length / 3
  {
    // Paint: warm skin, lighter and glossier nails on the backs of the last finger bones, fine creases over the knuckles.
    const col = new Float32Array(nV * 3), rough = new Float32Array(nV)
    const base = new THREE.Color(SKIN), nail = new THREE.Color(NAIL), crease = new THREE.Color(CREASE), c = new THREE.Color()
    const v = new THREE.Vector3(), seg = new THREE.Vector3(), rel = new THREE.Vector3()
    const tipOf: [string, string][] = [...FINGERS.map(f => [JOINTS[f][3], JOINTS[f][4]] as [string, string]), [JOINTS.thumb[2], JOINTS.thumb[3]]]
    const creaseAt = [...FINGERS.flatMap(f => [[JOINTS[f][1], JOINTS[f][2]], [JOINTS[f][2], JOINTS[f][3]], [JOINTS[f][3], JOINTS[f][4]]]), [JOINTS.thumb[1], JOINTS.thumb[2]], [JOINTS.thumb[2], JOINTS.thumb[3]]] as [string, string][]
    const fw = handLen * 0.05
    for (let i = 0; i < nV; i++) {
      v.set(sub.pos[i * 3], sub.pos[i * 3 + 1], sub.pos[i * 3 + 2]).applyMatrix4(sk.bindMatrix)
      c.copy(base)
      // Slow variation in tone (a little redder over the knuckles and fingertips, as real skin is).
      const n1 = hash3(v.x * 9 / handLen, v.y * 9 / handLen, v.z * 9 / handLen)
      c.offsetHSL(0, (n1 - 0.5) * 0.04, (n1 - 0.5) * 0.025)
      let r = 0.52 + (hash3(v.x * 31 / handLen, v.y * 31 / handLen, v.z * 31 / handLen) - 0.5) * 0.16
      for (const [j0, j1] of creaseAt) {
        const a0 = restP.get(j0)!, a1 = restP.get(j1)!
        seg.subVectors(a1, a0)
        const L0 = seg.length(); seg.normalize()
        rel.subVectors(v, a0)
        const along = rel.dot(seg)
        if (along < -fw || along > fw) continue
        rel.addScaledVector(seg, -along)
        const side = rel.dot(dorsal) / Math.max(1e-6, rel.length())
        // Back of the knuckle: a few fine folds; palm side: one deeper line.
        const fall = Math.exp(-((along / (fw * 0.55)) ** 2))
        const k = side > 0.2 ? fall * (0.55 + 0.45 * Math.cos((along / (L0 * 0.035)) * Math.PI * 2)) * 0.5 : side < -0.3 ? Math.exp(-((along / (fw * 0.18)) ** 2)) * 0.42 : 0
        if (k > 0) { c.lerp(crease, k); r += k * 0.1 }
        if (side > 0.2) c.offsetHSL(0.0, 0.02 * fall, -0.012 * fall)
      }
      for (const [j0, j1] of tipOf) {
        const a0 = restP.get(j0)!, a1 = restP.get(j1)!
        seg.subVectors(a1, a0)
        const L0 = seg.length(); seg.normalize()
        rel.subVectors(v, a0)
        const t = rel.dot(seg) / L0
        if (t < 0.3 || t > 1.08) continue
        rel.addScaledVector(seg, -t * L0)
        const side = rel.dot(dorsal) / Math.max(1e-6, rel.length())
        if (side > 0.45) {
          // Nail plate, with a paler free edge at the tip.
          const k = Math.min(1, (side - 0.45) / 0.2) * Math.min(1, (t - 0.3) / 0.12)
          c.lerp(nail, k)
          if (t > 0.92) c.offsetHSL(0, -0.05 * k, 0.06 * k)
          r = r * (1 - k) + 0.24 * k
        }
      }
      col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b
      rough[i] = r
    }
    sub.color = col
    sub.rough = rough
  }
  const skinMat = makeSkinMaterial()
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(nV * 3), 3))
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(new Float32Array(nV * 3), 3))
  geo.setAttribute('color', new THREE.Float32BufferAttribute(sub.color!, 3))
  geo.setAttribute('aRough', new THREE.Float32BufferAttribute(sub.rough!, 1))
  geo.setIndex(new THREE.BufferAttribute(sub.index, 1))
  const baked = new THREE.Mesh(geo, skinMat)
  baked.castShadow = true
  baked.frustumCulled = false
  sk.parent!.add(baked)
  baked.position.copy(sk.position); baked.quaternion.copy(sk.quaternion); baked.scale.copy(sk.scale)
  const outPos = geo.getAttribute('position') as THREE.BufferAttribute
  const tv = new THREE.Vector3(), acc = new THREE.Vector3(), tmp = new THREE.Vector3()
  const boneM: THREE.Matrix4[] = []
  const modelInv = new THREE.Matrix4()
  const bake = () => {
    // Bone matrices relative to the model (the rig's placement in the scene is applied by the scene graph).
    modelInv.copy(model.matrixWorld).invert()
    const bs = sk.skeleton.bones, inv = sk.skeleton.boneInverses
    for (let i = 0; i < bs.length; i++) boneM[i] = (boneM[i] ?? new THREE.Matrix4()).multiplyMatrices(modelInv, bs[i].matrixWorld).multiply(inv[i])
    const meshToModel = tmpM.multiplyMatrices(modelInv, sk.matrixWorld)
    const modelToMesh = tmpM2.copy(meshToModel).invert()
    const P3 = sub.pos, SI = sub.skinIndex, SW = sub.skinWeight
    for (let v = 0; v < nV; v++) {
      tv.set(P3[v * 3], P3[v * 3 + 1], P3[v * 3 + 2]).applyMatrix4(sk.bindMatrix)
      acc.set(0, 0, 0)
      for (let k = 0; k < 4; k++) {
        const w = SW[v * 4 + k]
        if (!w) continue
        acc.addScaledVector(tmp.copy(tv).applyMatrix4(boneM[SI[v * 4 + k]]), w)
      }
      // boneM maps bind space into model space; bring the result into the mesh's own space.
      acc.applyMatrix4(modelToMesh)
      outPos.setXYZ(v, acc.x, acc.y, acc.z)
    }
    outPos.needsUpdate = true
    geo.computeVertexNormals()
  }
  const tmpM = new THREE.Matrix4(), tmpM2 = new THREE.Matrix4()

  // ---- Marker: tip at the origin of its group, body along +Y; a whiteboard marker with a felt chisel nib,
  // a tapered collar, a grey barrel with a green band and a cap posted on the back end.
  const marker = new THREE.Group()
  const barrelMat = new THREE.MeshStandardMaterial({ color: '#4a4e53', roughness: 0.38, metalness: 0.05 })
  const greenMat = new THREE.MeshStandardMaterial({ color: '#1f4d3a', roughness: 0.45 })
  const nibMat = new THREE.MeshStandardMaterial({ color: '#1d2a24', roughness: 0.95 })
  const part = (g: THREE.BufferGeometry, mat: THREE.Material, y: number) => {
    const m = new THREE.Mesh(g, mat)
    m.position.y = y
    m.castShadow = true
    marker.add(m)
  }
  const u = L / 0.13 // the marker is modelled at 13 cm
  part(new THREE.CylinderGeometry(0.0013 * u, 0.0026 * u, 0.006 * u, 16), nibMat, 0.003 * u)
  part(new THREE.CylinderGeometry(0.0034 * u, 0.0052 * u, 0.012 * u, 20), greenMat, 0.012 * u)
  part(new THREE.CylinderGeometry(R * 0.96, R * 0.82, 0.01 * u, 24), barrelMat, 0.023 * u)
  part(new THREE.CylinderGeometry(R, R, 0.075 * u, 24), barrelMat, 0.0655 * u)
  part(new THREE.CylinderGeometry(R * 1.03, R * 1.03, 0.008 * u, 24), greenMat, 0.034 * u)
  part(new THREE.CylinderGeometry(R * 1.09, R * 1.09, 0.03 * u, 24), greenMat, 0.115 * u)
  part(new THREE.SphereGeometry(R * 1.09, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), greenMat, 0.13 * u)
  marker.position.copy(tipP)
  marker.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), axisDir.clone().negate())

  // Forearm and shirt sleeve behind the wrist: a forearm that tapers into the wrist, and a soft cotton cuff with a
  // rounded, slightly rolled opening (no hard rim) and loose folds that bunch just behind it.
  const forearmDir = wristP.clone().sub(P('middle-finger-phalanx-proximal')).normalize()
  const arm = new THREE.Group()
  const lathe = (pts: [number, number][], segs: number, n: number) =>
    new THREE.LatheGeometry(new THREE.SplineCurve(pts.map(([r, y]) => new THREE.Vector2(r * handLen, y * handLen))).getPoints(n), segs)
  const foreGeo = lathe([[0.118, -0.16], [0.124, -0.02], [0.133, 0.12], [0.146, 0.3], [0.158, 0.5], [0.166, 0.7], [0.17, 0.9]], 32, 40)
  foreGeo.computeVertexNormals()
  const fore = new THREE.Mesh(foreGeo, makeSkinMaterial(false))
  const sleeveGeo = lathe([[0.15, 0.3], [0.158, 0.215], [0.172, 0.178], [0.19, 0.172], [0.205, 0.19], [0.214, 0.24], [0.222, 0.36], [0.232, 0.62], [0.242, 1.0], [0.25, 1.4], [0.255, 1.8]], 56, 90)
  {
    // Folds: two slow waves around the sleeve that drift along it, a couple of soft rings where the cuff bunches.
    const pos = sleeveGeo.getAttribute('position') as THREE.BufferAttribute
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i) / handLen, z = pos.getZ(i)
      const r = Math.hypot(x, z)
      if (r < 1e-6 || y < 0.19) continue
      const th = Math.atan2(z, x)
      const grow = Math.min(1, (y - 0.19) / 0.25)
      const wave = Math.sin(3 * th + y * 4.2) * 0.6 + Math.sin(5 * th - y * 2.7 + 1.3) * 0.4
      const bunch = Math.sin((y - 0.19) * 26) * Math.exp(-((y - 0.42) ** 2) / 0.03)
      const k = 1 + grow * (0.065 * wave + 0.045 * bunch)
      pos.setX(i, x * k); pos.setZ(i, z * k)
    }
    sleeveGeo.computeVertexNormals()
  }
  const sleeveMat = new THREE.MeshPhysicalMaterial({ color: SLEEVE, roughness: 0.86, sheen: 1, sheenRoughness: 0.75, sheenColor: new THREE.Color('#fffaf0'), side: THREE.DoubleSide })
  const sleeve = new THREE.Mesh(sleeveGeo, sleeveMat)
  fore.castShadow = sleeve.castShadow = true
  arm.add(fore, sleeve)
  arm.position.copy(wristP).addScaledVector(forearmDir, -handLen * 0.1)
  arm.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), forearmDir)
  // Flatten the forearm a little to an oval like a real wrist (wider across the hand than through it).
  {
    const ax = new THREE.Vector3(1, 0, 0).applyQuaternion(arm.quaternion)
    const ang = Math.atan2(ax.clone().cross(towardThumb).dot(forearmDir), ax.dot(towardThumb))
    fore.rotation.y = -ang; sleeve.rotation.y = -ang
    fore.scale.set(1.18, 1, 0.8)
    sleeve.scale.set(1.08, 1, 0.88)
  }

  // anchor: at the pen point, turns with the wrist. orient: the grip's orientation. holder: hand + marker, tip at origin.
  const anchor = new THREE.Group()
  const orient = new THREE.Group()
  const holder = new THREE.Group()
  holder.add(model, marker, arm)
  holder.position.copy(tipP).multiplyScalar(-1)
  orient.add(holder)
  anchor.add(orient)
  scene.add(anchor)
  scene.updateMatrixWorld(true)
  bake()
  {
    // Viewed from the back and thumb side of the hand (as a writer's hand is seen from behind and to the left),
    // the marker rising out of the board toward the viewer and up-right on screen.
    const back = axisDir.clone().negate()
    const side = across(towardThumb.clone().multiplyScalar(VIEW.thumb).addScaledVector(dorsal, VIEW.dorsal))
    const fitView = (elev: number) => {
      const e = elev * DEG
      const toViewer = back.clone().multiplyScalar(Math.sin(e)).addScaledVector(side, Math.cos(e)).normalize()
      const up = back.clone().addScaledVector(toViewer, -back.dot(toViewer)).normalize() // marker on screen
      const right = new THREE.Vector3().crossVectors(up, toViewer)
      // Model -> view frame (marker pointing straight up on screen), then turn it to its on-screen angle.
      const m = new THREE.Matrix4().makeBasis(right, up, toViewer).transpose()
      orient.quaternion.setFromRotationMatrix(m).premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), (VIEW.screen - 90) * DEG))
    }
    // Raise the marker until no part of the hand dips more than a little behind the board plane (the board does not
    // hide it, and seen square-on a curled fingertip just behind the surface reads as touching it).
    const minZ = () => {
      scene.updateMatrixWorld(true)
      const pos = baked.geometry.getAttribute('position') as THREE.BufferAttribute
      let z = Infinity
      const v = new THREE.Vector3()
      for (let i = 0; i < pos.count; i += 3) z = Math.min(z, v.fromBufferAttribute(pos, i).applyMatrix4(baked.matrixWorld).z)
      return z
    }
    let elev = VIEW.elev
    fitView(elev)
    while (minZ() < -handLen * VIEW.sink && elev < 70) fitView((elev += 2))
  }
  const SCALE_REF = handLen

  // Finger motion while writing: index and thumb press and ease, small and out of phase.
  const flexPose = (w: number) => {
    setFinger('index', [GRIP.index[0] + w * 2, GRIP.index[1] + w * 2.5, GRIP.index[2] - w * 2, GRIP.index[3]])
    setFinger('middle', [GRIP.middle[0] + w * 1.5, GRIP.middle[1] + w * 1.5, GRIP.middle[2], GRIP.middle[3]])
    setFinger('ring', [GRIP.ring[0] - w * 2, GRIP.ring[1], GRIP.ring[2], GRIP.ring[3]])
    setThumb([THUMB[0], THUMB[1], THUMB[2], THUMB[3] + w * 2, THUMB[4] - w * 3])
    applyJoints()
  }

  let W = 0, H = 0
  const resize = (w: number, h: number) => {
    W = w; H = h
    renderer.setSize(w, h, false)
    camera.aspect = w / h
    const dist = (h / 2) / Math.tan((camera.fov / 2) * DEG)
    camera.position.set(w / 2, -h / 2, dist)
    camera.near = dist * 0.2
    camera.far = dist * 3
    camera.lookAt(w / 2, -h / 2, 0)
    camera.updateProjectionMatrix()
    board.scale.set(w * 1.6, h * 1.6, 1)
    board.position.set(w / 2, -h / 2, 0)
    const s = Math.max(w, h)
    key.target.position.set(w / 2, -h / 2, 0)
    key.position.set(w / 2 - s * 0.35, -h / 2 + s * 0.45, s * 1.3)
    const sc = key.shadow.camera
    sc.left = -s; sc.right = s; sc.top = s; sc.bottom = -s; sc.near = s * 0.2; sc.far = s * 3
    sc.updateProjectionMatrix()
    rim.target.position.set(w / 2, -h / 2, 0)
    rim.position.set(w / 2 + s, -h / 2 - s * 0.3, s * 0.6)
  }

  let shown = -1
  let lastFlex = 0
  const render = (st: HandState) => {
    if (!canvas.parentElement) root.appendChild(canvas)
    if (st.w !== W || st.h !== H) resize(st.w, st.h)
    const vis = Math.round(st.visible * 100) / 100
    if (vis !== shown) { canvas.style.opacity = String(vis); shown = vis }
    if (vis <= 0.01) return
    const hw = handWidth3D(st.w)
    anchor.scale.setScalar(hw / (SCALE_REF * 1.55))
    const t = st.now / 1000
    const l = st.lift
    const sway = st.writing
    // Lifting brings the hand toward the viewer (its shadow separates); the pen point stays where the pen engine puts it.
    anchor.position.set(st.x, -st.y, l * hw * 0.14)
    anchor.rotation.set(
      (-l * 7 + Math.sin(t * 2 * Math.PI * 1.3) * 1.8 * sway) * DEG,
      (Math.sin(t * 2 * Math.PI * 0.9 + 1) * 2.5 * sway + l * 4) * DEG,
      -st.rot * DEG,
    )
    // Fingers press and ease while writing; re-skinned only when the pose actually changes.
    const flex = Math.round(sway * Math.sin(t * 2 * Math.PI * 3.1) * 10) / 10
    if (flex !== lastFlex) { lastFlex = flex; flexPose(flex); bake() }
    renderer.render(scene, camera)
  }

  let lost = false
  const onContextLost = (e: Event) => { e.preventDefault(); lost = true; onLost?.() }
  canvas.addEventListener('webglcontextlost', onContextLost)

  return {
    render: (st: HandState) => { if (!lost) render(st) },
    dispose: () => {
      canvas.removeEventListener('webglcontextlost', onContextLost)
      canvas.remove()
      scene.traverse(o => {
        const m = o as THREE.Mesh
        if (m.isMesh) { m.geometry.dispose(); (Array.isArray(m.material) ? m.material : [m.material]).forEach(x => x.dispose()) }
      })
      renderer.dispose()
    },
  }
}

/** Hand width for a board of this width (px); the same rule as the photo hand. */
function handWidth3D(boardW: number) {
  return Math.max(120, Math.min(270, boardW * 0.34))
}

/** Hash noise in [0, 1) for a point (smooth enough per vertex for tone and gloss variation). */
function hash3(x: number, y: number, z: number) {
  const s = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719) * 43758.5453
  const t = Math.sin(Math.floor(x) * 3.1 + Math.floor(y) * 1.7 + Math.floor(z) * 2.3 + (s - Math.floor(s))) * 0.5 + 0.5
  return (s - Math.floor(s)) * 0.5 + t * 0.5
}

/**
 * Skin: physically based with a warm sheen at grazing angles and light that wraps past the terminator with a red
 * tint (a cheap stand-in for subsurface scattering, so it reads as skin and not clay). Per-vertex colour and gloss
 * when `painted` (the hand), uniform for the forearm.
 */
function makeSkinMaterial(painted = true) {
  const m = new THREE.MeshPhysicalMaterial({
    color: painted ? '#ffffff' : SKIN, vertexColors: painted, roughness: 0.52, metalness: 0,
    sheen: 0.4, sheenRoughness: 0.6, sheenColor: new THREE.Color('#d98a72'),
    clearcoat: 0.06, clearcoatRoughness: 0.5,
  })
  m.onBeforeCompile = sh => {
    if (painted) {
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float aRough;\nvarying float vRough;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRough = aRough;')
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vRough;')
        .replace('float roughnessFactor = roughness;', 'float roughnessFactor = roughness * (vRough / 0.52);')
    }
    // Wrapped diffuse with a reddish terminator (subsurface look).
    sh.fragmentShader = sh.fragmentShader.replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
      {
        float ndv = clamp(dot(normalize(normal), normalize(vViewPosition)), 0.0, 1.0);
        vec3 sss = vec3(0.55, 0.16, 0.08) * diffuseColor.rgb * pow(1.0 - ndv, 1.6) * 0.25;
        reflectedLight.indirectDiffuse += sss;
      }`)
  }
  return m
}

interface SubMesh { pos: Float32Array; skinIndex: Uint16Array; skinWeight: Float32Array; index: Uint32Array; color?: Float32Array; rough?: Float32Array }

/**
 * One step of Loop subdivision of a skinned, indexed triangle mesh (in its own, possibly quantized, space): a smooth
 * limit surface instead of the low-poly facets. New vertices on an edge take the blend of its two ends' skin weights
 * (top four kept); open borders (the wrist) keep their shape.
 */
function subdivideSkinned(g: THREE.BufferGeometry): SubMesh {
  const P = g.getAttribute('position') as THREE.BufferAttribute
  const SI = g.getAttribute('skinIndex') as THREE.BufferAttribute
  const SW = g.getAttribute('skinWeight') as THREE.BufferAttribute
  const idx = g.getIndex()
  // Weld vertices that share a position (so the surface is one piece).
  const keyOf = new Map<string, number>()
  const remap = new Int32Array(P.count)
  const pos: number[] = [], w: Map<number, number>[] = []
  for (let i = 0; i < P.count; i++) {
    const k = `${P.getX(i)},${P.getY(i)},${P.getZ(i)}`
    let u = keyOf.get(k)
    if (u === undefined) {
      u = pos.length / 3
      keyOf.set(k, u)
      pos.push(P.getX(i), P.getY(i), P.getZ(i))
      const m = new Map<number, number>()
      for (let c = 0; c < 4; c++) { const wt = SW.getComponent(i, c); if (wt > 0) m.set(SI.getComponent(i, c), (m.get(SI.getComponent(i, c)) ?? 0) + wt) }
      w.push(m)
    }
    remap[i] = u
  }
  const tris: number[] = []
  const nIdx = idx ? idx.count : P.count
  for (let i = 0; i < nIdx; i += 3) {
    const a = remap[idx ? idx.getX(i) : i], b = remap[idx ? idx.getX(i + 1) : i + 1], c = remap[idx ? idx.getX(i + 2) : i + 2]
    if (a !== b && b !== c && a !== c) tris.push(a, b, c)
  }
  const nv = pos.length / 3
  // Edges: their faces' opposite corners.
  const edges = new Map<number, { a: number; b: number; opp: number[]; id: number }>()
  const ek = (a: number, b: number) => (a < b ? a * nv + b : b * nv + a)
  const nbr: Set<number>[] = Array.from({ length: nv }, () => new Set<number>())
  for (let t = 0; t < tris.length; t += 3) {
    for (let e = 0; e < 3; e++) {
      const a = tris[t + e], b = tris[t + ((e + 1) % 3)], c = tris[t + ((e + 2) % 3)]
      const key = ek(a, b)
      let E = edges.get(key)
      if (!E) { E = { a, b, opp: [], id: -1 }; edges.set(key, E) }
      E.opp.push(c)
      nbr[a].add(b); nbr[b].add(a)
    }
  }
  const boundaryNbr: number[][] = Array.from({ length: nv }, () => [])
  edges.forEach(E => { if (E.opp.length === 1) { boundaryNbr[E.a].push(E.b); boundaryNbr[E.b].push(E.a) } })
  const total = nv + edges.size
  const out = new Float32Array(total * 3)
  const wOut: Map<number, number>[] = new Array(total)
  const V = (i: number, c: number) => pos[i * 3 + c]
  for (let i = 0; i < nv; i++) {
    const bn = boundaryNbr[i]
    for (let c = 0; c < 3; c++) {
      let v: number
      if (bn.length >= 2) v = 0.75 * V(i, c) + 0.125 * (V(bn[0], c) + V(bn[1], c))
      else {
        const n = nbr[i].size
        const beta = n > 3 ? 3 / (8 * n) : 3 / 16
        let sum = 0
        nbr[i].forEach(j => { sum += V(j, c) })
        v = (1 - n * beta) * V(i, c) + beta * sum
      }
      out[i * 3 + c] = v
    }
    wOut[i] = w[i]
  }
  let next = nv
  edges.forEach(E => {
    E.id = next++
    for (let c = 0; c < 3; c++) {
      out[E.id * 3 + c] = E.opp.length === 2
        ? 0.375 * (V(E.a, c) + V(E.b, c)) + 0.125 * (V(E.opp[0], c) + V(E.opp[1], c))
        : 0.5 * (V(E.a, c) + V(E.b, c))
    }
    const m = new Map<number, number>()
    w[E.a].forEach((x, k) => m.set(k, (m.get(k) ?? 0) + x * 0.5))
    w[E.b].forEach((x, k) => m.set(k, (m.get(k) ?? 0) + x * 0.5))
    wOut[E.id] = m
  })
  const index = new Uint32Array((tris.length / 3) * 12)
  let o = 0
  for (let t = 0; t < tris.length; t += 3) {
    const a = tris[t], b = tris[t + 1], c = tris[t + 2]
    const ab = edges.get(ek(a, b))!.id, bc = edges.get(ek(b, c))!.id, ca = edges.get(ek(c, a))!.id
    index.set([a, ab, ca, ab, b, bc, ca, bc, c, ab, bc, ca], o)
    o += 12
  }
  const skinIndex = new Uint16Array(total * 4), skinWeight = new Float32Array(total * 4)
  for (let i = 0; i < total; i++) {
    const top = [...wOut[i].entries()].sort((x, y) => y[1] - x[1]).slice(0, 4)
    const s = top.reduce((acc, [, x]) => acc + x, 0) || 1
    top.forEach(([b, x], k) => { skinIndex[i * 4 + k] = b; skinWeight[i * 4 + k] = x / s })
  }
  return { pos: out, skinIndex, skinWeight, index }
}
