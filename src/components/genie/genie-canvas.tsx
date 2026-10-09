'use client'
/**
 * The Rive canvas for Genie (loaded lazily by TutorPresence; never server-rendered).
 * Writes the view model by name: mood (from the shared presence store), mouth (lip sync, every frame while talking)
 * and gazeX/gazeY (small glances, plus where the parent wants it to look).
 */
import React, { useEffect, useLayoutEffect, useRef } from 'react'
import { Alignment, Fit, Layout, RuntimeLoader, useRive, useViewModel, useViewModelInstance, useViewModelInstanceNumber } from '@rive-app/react-canvas'
import { genie, MOOD_NUMBER, useGenieMood } from './presence'

// Self-hosted runtime (same version as the npm package), so nothing loads from a third-party CDN.
RuntimeLoader.setWasmUrl('/genie/rive-4.36.0.wasm')

export default function GenieCanvas({ reducedMotion = false, look, onReady, onError }: {
  reducedMotion?: boolean
  /** Where to look by default (-1..1), e.g. down toward the board. */
  look?: { x: number; y: number }
  onReady?: () => void
  onError?: () => void
}) {
  const { rive, RiveComponent } = useRive({
    src: '/genie/genie.riv',
    stateMachines: 'Genie',
    autoplay: true,
    layout: new Layout({ fit: Fit.Contain, alignment: Alignment.Center }),
    onLoad: () => onReady?.(),
    onLoadError: () => onError?.(),
  })
  const vm = useViewModel(rive, { name: 'Genie' })
  const vmi = useViewModelInstance(vm, { rive })
  const mood = useViewModelInstanceNumber('mood', vmi)
  const mouth = useViewModelInstanceNumber('mouth', vmi)
  const gazeX = useViewModelInstanceNumber('gazeX', vmi)
  const gazeY = useViewModelInstanceNumber('gazeY', vmi)
  const m = useGenieMood()
  const setters = useRef({ mouth: mouth.setValue, gx: gazeX.setValue, gy: gazeY.setValue })
  useLayoutEffect(() => { setters.current = { mouth: mouth.setValue, gx: gazeX.setValue, gy: gazeY.setValue } })

  // Mood. With reduced motion the character only changes pose: it plays briefly, then holds still.
  useEffect(() => {
    if (!vmi) return
    mood.setValue(MOOD_NUMBER[m])
    if (reducedMotion && rive) {
      rive.play()
      const t = setTimeout(() => rive.pause(), 700)
      return () => clearTimeout(t)
    }
  }, [m, vmi, rive, reducedMotion]) // eslint-disable-line react-hooks/exhaustive-deps

  // Mouth and glances, every frame (skipped entirely with reduced motion).
  useEffect(() => {
    if (!vmi || reducedMotion) return
    let raf = 0, open = 0, gx = 0, gy = 0, nextGlance = 0, tx = look?.x ?? 0, ty = look?.y ?? 0
    const tick = (now: number) => {
      const target = genie.mouth()
      // Fast to open, slower to close: reads as speech rather than flapping.
      const want = target ?? 0
      open += (want - open) * (want > open ? 0.55 : 0.28)
      setters.current.mouth(Math.round(open * 100) / 100)
      if (now > nextGlance) {
        const calm = genie.mood === 'thinking' || genie.mood === 'happy'
        tx = calm ? 0 : (look?.x ?? 0) + (Math.random() - 0.5) * 0.9
        ty = calm ? 0 : (look?.y ?? 0) + (Math.random() - 0.5) * 0.5
        nextGlance = now + 1800 + Math.random() * 2600
      }
      gx += (tx - gx) * 0.12; gy += (ty - gy) * 0.12
      setters.current.gx(Math.round(gx * 100) / 100); setters.current.gy(Math.round(gy * 100) / 100)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [vmi, reducedMotion, look?.x, look?.y])

  return <RiveComponent aria-hidden className="h-full w-full" />
}
