'use client'
/**
 * Matter.js (MIT) sandbox: four set-ups the tutor parameterises (drop, incline, collision, projectile). Sliders reset
 * the scene with the new value and come back to the tutor as slider signals; bodies can be dragged; live readouts.
 */
import React, { useEffect, useRef, useState } from 'react'
import { RotateCcw } from 'lucide-react'
import { emitSignal } from '@/lib/live/signals'
import { PHYSICS_KINDS, type PhysicsKind } from '@/lib/live/tools/embed-meta'
import { EmbedFrame } from './shell'

const W = 640, H = 400, PX = 20 // 20 px per metre

const LABEL: Record<string, string> = { massA: 'Mass A (kg)', massB: 'Mass B (kg)', airDrag: 'Air drag', angle: 'Angle (°)', friction: 'Friction μ', mass: 'Mass (kg)', speedA: 'Speed of A (m/s)', bounce: 'Bounciness', speed: 'Speed (m/s)' }

export default function PhysicsEmbed({ id, title, spec }: { id: string; title: string; spec: { kind: PhysicsKind; params: Record<string, number> } }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const [params, setParams] = useState(spec.params)
  const [run, setRun] = useState(0)
  const [readout, setReadout] = useState('')
  const k = PHYSICS_KINDS[spec.kind] as { params: readonly string[]; range: Record<string, readonly [number, number]> }

  useEffect(() => {
    let raf = 0, dead = false
    let engine: import('matter-js').Engine | null = null
    ;(async () => {
      const M = (await import('matter-js')).default
      if (dead || !canvas.current) return
      engine = M.Engine.create({ gravity: { x: 0, y: 1, scale: 0.001 } })
      const world = engine.world
      const ground = M.Bodies.rectangle(W / 2, H + 20, W * 2, 60, { isStatic: true, friction: 0.5 })
      const wallL = M.Bodies.rectangle(-20, H / 2, 40, H * 2, { isStatic: true })
      const wallR = M.Bodies.rectangle(W + 20, H / 2, 40, H * 2, { isStatic: true })
      M.World.add(world, [ground, wallL, wallR])
      const bodies: { b: import('matter-js').Body; name: string; color: string }[] = []
      const p = params
      if (spec.kind === 'drop') {
        const a = M.Bodies.circle(W * 0.35, 40, 10 + 3 * Math.cbrt(p.massA), { mass: p.massA, frictionAir: p.airDrag })
        const b = M.Bodies.circle(W * 0.65, 40, 10 + 3 * Math.cbrt(p.massB), { mass: p.massB, frictionAir: p.airDrag })
        bodies.push({ b: a, name: 'A', color: '#1F4D3A' }, { b, name: 'B', color: '#B5562F' })
      } else if (spec.kind === 'incline') {
        const ang = (p.angle * Math.PI) / 180, len = 520
        const ramp = M.Bodies.rectangle(W / 2, H - 20 - (len / 2) * Math.sin(ang), len, 12, { isStatic: true, angle: -ang, friction: p.friction, frictionStatic: p.friction })
        // The ramp rises to the right: the block starts near its top end.
        const bx = W / 2 + (len / 2 - 70) * Math.cos(ang), by = H - 20 - (len / 2) * Math.sin(ang) - (len / 2 - 70) * Math.sin(ang) - 26
        const block = M.Bodies.rectangle(bx, by, 44, 30, { mass: p.mass, friction: p.friction, frictionStatic: p.friction, angle: -ang })
        M.World.add(world, ramp)
        bodies.push({ b: block, name: 'block', color: '#1F4D3A' })
      } else if (spec.kind === 'collision') {
        const a = M.Bodies.rectangle(W * 0.2, H - 30, 40 + 6 * p.massA, 30, { mass: p.massA, friction: 0, frictionAir: 0, restitution: p.bounce, inertia: Infinity })
        const b = M.Bodies.rectangle(W * 0.65, H - 30, 40 + 6 * p.massB, 30, { mass: p.massB, friction: 0, frictionAir: 0, restitution: p.bounce, inertia: Infinity })
        M.Body.setVelocity(a, { x: (p.speedA * PX) / 60, y: 0 })
        bodies.push({ b: a, name: 'A', color: '#1F4D3A' }, { b, name: 'B', color: '#B5562F' })
      } else {
        const ang = (p.angle * Math.PI) / 180
        const ball = M.Bodies.circle(40, H - 30, 10, { frictionAir: 0, restitution: 0.3 })
        M.Body.setVelocity(ball, { x: (p.speed * PX * Math.cos(ang)) / 60, y: (-p.speed * PX * Math.sin(ang)) / 60 })
        bodies.push({ b: ball, name: 'ball', color: '#1F4D3A' })
      }
      M.World.add(world, bodies.map(x => x.b))
      // Drag with the mouse / finger.
      const mouse = M.Mouse.create(canvas.current)
      const mc = M.MouseConstraint.create(engine, { mouse, constraint: { stiffness: 0.2, render: { visible: false } } as never })
      M.World.add(world, mc)
      M.Events.on(mc, 'enddrag', () => emitSignal({ kind: 'slider', where: `physics ${id}`, param: 'drag', detail: 'dragged a body', value: 1 }))
      const ctx = canvas.current.getContext('2d')!
      const trail: [number, number][] = []
      let last = performance.now(), t = 0, frames = 0
      const tick = (now: number) => {
        if (dead || !engine) return
        const dt = Math.min(33, now - last); last = now; t += dt
        M.Engine.update(engine, dt)
        ctx.clearRect(0, 0, W, H)
        ctx.fillStyle = '#FBFAF7'; ctx.fillRect(0, 0, W, H)
        ctx.strokeStyle = '#8A8475'; ctx.lineWidth = 2
        for (const b of world.bodies) {
          if (bodies.some(x => x.b === b)) continue
          ctx.beginPath(); b.vertices.forEach((v, i) => (i ? ctx.lineTo(v.x, v.y) : ctx.moveTo(v.x, v.y))); ctx.closePath(); ctx.stroke()
        }
        if (spec.kind === 'projectile') { trail.push([bodies[0].b.position.x, bodies[0].b.position.y]); ctx.strokeStyle = '#B5562F55'; ctx.beginPath(); trail.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.stroke() }
        for (const { b, name, color } of bodies) {
          ctx.fillStyle = color; ctx.beginPath(); b.vertices.forEach((v, i) => (i ? ctx.lineTo(v.x, v.y) : ctx.moveTo(v.x, v.y))); ctx.closePath(); ctx.fill()
          ctx.fillStyle = '#1B1A17'; ctx.font = '13px system-ui'; ctx.fillText(name, b.position.x - 6, b.position.y - 22)
        }
        if (++frames % 10 === 0) setReadout(bodies.map(({ b, name }) => `${name}: ${(Math.hypot(b.velocity.x, b.velocity.y) * 60 / PX).toFixed(1)} m/s`).join(' · ') + ` · t = ${(t / 1000).toFixed(1)} s`)
        raf = requestAnimationFrame(tick)
      }
      raf = requestAnimationFrame(tick)
      emitSignal({ kind: 'stage', where: `physics ${id}`, correct: true, detail: `${spec.kind} sandbox running with ${Object.entries(p).map(([a, b]) => `${a}=${b}`).join(', ')}` })
    })()
    return () => { dead = true; cancelAnimationFrame(raf); if (engine) import('matter-js').then(M => M.default.Engine.clear(engine!)).catch(() => undefined) }
  }, [id, spec.kind, params, run])

  return (
    <EmbedFrame title={title} credit={<>Physics: <a className="underline" href="https://brm.io/matter-js/" target="_blank" rel="noreferrer">Matter.js</a></>}>
      <canvas ref={canvas} width={W} height={H} className="block h-auto w-full touch-none" />
      <div className="tnum flex items-center justify-between gap-2 border-t border-line px-3.5 py-1.5 text-[12.5px] text-ink-2"><span>{readout}</span>
        <button type="button" onClick={() => setRun(r => r + 1)} className="inline-flex h-9 items-center gap-1 rounded-full px-2 text-[13px] text-accent" aria-label="Run again"><RotateCcw className="h-4 w-4" />Again</button></div>
      <div className="space-y-1 px-3.5 pb-2">
        {k.params.map(name => (
          <label key={name} className="block text-[12.5px] text-ink-2">{LABEL[name] ?? name}: <span className="tnum font-medium text-ink">{params[name]}</span>
            <input type="range" min={k.range[name][0]} max={k.range[name][1]} step={(k.range[name][1] - k.range[name][0]) / 50} value={params[name]} className="h-9 w-full accent-[#1F4D3A]"
              onChange={e => { const v = Number(e.target.value); const from = params[name]; setParams(p => ({ ...p, [name]: v })); emitSignal({ kind: 'slider', where: `physics ${id} (${spec.kind})`, param: name, value: v, from, min: k.range[name][0], max: k.range[name][1] }) }} />
          </label>
        ))}
      </div>
    </EmbedFrame>
  )
}
