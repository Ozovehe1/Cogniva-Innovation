/*
 * Virtual clock for the lesson video renderer (modal_app/lesson_video.py). Injected before any page script runs.
 *
 * Until enable() is called the page runs on the real clock. After that, time only moves when the recorder calls
 * step(ms): performance.now, Date, setTimeout/setInterval, requestAnimationFrame, CSS/Web animations and every <audio>
 * and <video> element follow the virtual clock, so the page renders frame by frame as fast as the machine allows and
 * every frame lands exactly on its timestamp. Media elements never really play: their playhead is virtual (events
 * play/playing/pause/ended are fired on the virtual timeline) and videos are seeked to the exact frame before each
 * capture. step() resolves with whether anything on screen may have changed, so identical frames need no capture.
 */
(() => {
  if (window.__vclock) return
  const W = window
  const nativePerfNow = performance.now.bind(performance)
  const NativeDate = Date
  const nativeSetTimeout = W.setTimeout.bind(W)
  const nativeClearTimeout = W.clearTimeout.bind(W)
  const nativeSetInterval = W.setInterval.bind(W)
  const nativeClearInterval = W.clearInterval.bind(W)
  const nativeRaf = W.requestAnimationFrame.bind(W)
  const nativeCaf = W.cancelAnimationFrame.bind(W)
  const MP = HTMLMediaElement.prototype
  const desc = (k) => Object.getOwnPropertyDescriptor(MP, k)
  const nPlay = MP.play, nPause = MP.pause
  const nCurrentTime = desc('currentTime')
  const nPlaybackRate = desc('playbackRate')
  const nPaused = desc('paused')
  const nEnded = desc('ended')

  let virtual = false
  let vt = 0 // virtual performance.now() (ms)
  let dateOffset = 0 // Date.now() = vt + dateOffset
  let seq = 0
  /** Virtual timers: id -> {due, fn, args, every, seq}. Ids are negative so they never collide with native ones. */
  const timers = new Map()
  let nextTimerId = -1
  let rafs = new Map()
  let nextRafId = -1
  let inAdvance = false
  let dirty = true
  let phase = ''
  const errors = []

  const now = () => (virtual ? vt : nativePerfNow())
  performance.now = now

  /* ── Date ── */
  function VDate(...args) {
    if (!new.target) return new NativeDate(virtual ? vt + dateOffset : NativeDate.now()).toString()
    if (args.length === 0) return Reflect.construct(NativeDate, [virtual ? vt + dateOffset : NativeDate.now()], new.target)
    return Reflect.construct(NativeDate, args, new.target)
  }
  VDate.prototype = NativeDate.prototype
  VDate.now = () => (virtual ? Math.floor(vt + dateOffset) : NativeDate.now())
  VDate.parse = NativeDate.parse
  VDate.UTC = NativeDate.UTC
  Object.defineProperty(VDate.prototype, 'constructor', { value: VDate, configurable: true, writable: true })
  W.Date = VDate

  /* ── Timers ── */
  const addTimer = (fn, ms, args, every) => {
    const id = nextTimerId--
    const d = Math.max(inAdvance ? 1 : 0, Number(ms) || 0)
    timers.set(id, { due: vt + d, fn, args, every: every ? Math.max(1, d) : 0, seq: ++seq })
    return id
  }
  W.setTimeout = function (fn, ms, ...args) { return virtual ? addTimer(fn, ms, args, false) : nativeSetTimeout(fn, ms, ...args) }
  W.setInterval = function (fn, ms, ...args) { return virtual ? addTimer(fn, ms, args, true) : nativeSetInterval(fn, ms, ...args) }
  W.clearTimeout = function (id) { if (typeof id === 'number' && id < 0) timers.delete(id); else nativeClearTimeout(id) }
  W.clearInterval = function (id) { if (typeof id === 'number' && id < 0) timers.delete(id); else nativeClearInterval(id) }
  W.requestAnimationFrame = function (fn) {
    if (!virtual) return nativeRaf(fn)
    const id = nextRafId--
    rafs.set(id, fn)
    return id
  }
  W.cancelAnimationFrame = function (id) { if (typeof id === 'number' && id < 0) rafs.delete(id); else nativeCaf(id) }

  /* ── Media: a virtual playhead per element ── */
  const media = new Map() // el -> state
  const st = (el) => {
    let s = media.get(el)
    if (!s) {
      s = { playing: false, base: 0, anchor: vt, rate: 1, announced: false, ended: false, endTimer: 0, realPlayed: false }
      media.set(el, s)
    }
    return s
  }
  const fire = (el, type) => { try { el.dispatchEvent(new Event(type)) } catch (e) { errors.push(String(e)) } }
  const dur = (el) => { const d = el.duration; return Number.isFinite(d) && d > 0 ? d : null }
  const pos = (el, s) => {
    let p = s.playing && s.announced ? s.base + ((vt - s.anchor) / 1000) * s.rate : s.base
    const d = dur(el)
    if (d !== null && p > d) p = d
    return p
  }
  const reanchor = (el, s) => { s.base = pos(el, s); s.anchor = vt }
  const scheduleEnd = (el, s) => {
    if (s.endTimer) timers.delete(s.endTimer)
    s.endTimer = 0
    const d = dur(el)
    if (!s.playing || !s.announced || d === null || s.rate <= 0) return
    const ms = Math.max(0, ((d - s.base) / s.rate) * 1000)
    s.endTimer = addTimer(() => {
      s.endTimer = 0
      if (!s.playing) return
      s.base = d; s.anchor = vt; s.playing = false; s.ended = true
      fire(el, 'timeupdate'); fire(el, 'pause'); fire(el, 'ended')
    }, ms, [], false)
    // An end exactly now must not be pushed to the next millisecond.
    timers.get(s.endTimer).due = vt + ms
  }
  const vplay = (el) => {
    const s = st(el)
    if (s.playing) return
    const d = dur(el)
    if (d !== null && s.base >= d) s.base = 0
    s.playing = true; s.ended = false; s.announced = false; s.anchor = vt
    fire(el, 'play')
    // 'playing' (and the playhead) wait until the element has data: see settleMedia().
  }
  MP.play = function () {
    if (!virtual) return nPlay.call(this)
    vplay(this)
    return Promise.resolve()
  }
  MP.pause = function () {
    if (!virtual) return nPause.call(this)
    const s = st(this)
    if (nPaused.get.call(this) === false) nPause.call(this)
    if (!s.playing) return
    reanchor(this, s); s.playing = false
    scheduleEnd(this, s)
    fire(this, 'pause')
  }
  Object.defineProperty(MP, 'paused', { configurable: true, get() { return virtual ? !st(this).playing : nPaused.get.call(this) } })
  Object.defineProperty(MP, 'ended', { configurable: true, get() { if (!virtual) return nEnded.get.call(this); const s = st(this); const d = dur(this); return !s.playing && d !== null && s.base >= d - 1e-3 } })
  Object.defineProperty(MP, 'currentTime', {
    configurable: true,
    get() { return virtual ? pos(this, st(this)) : nCurrentTime.get.call(this) },
    set(v) {
      if (!virtual) { nCurrentTime.set.call(this, v); return }
      const s = st(this)
      s.base = Math.max(0, Number(v) || 0); s.anchor = vt; s.ended = false
      scheduleEnd(this, s)
      dirty = true
      try { nCurrentTime.set.call(this, s.base) } catch { /* not loaded yet */ }
    },
  })
  Object.defineProperty(MP, 'playbackRate', {
    configurable: true,
    get() { return virtual ? st(this).rate : nPlaybackRate.get.call(this) },
    set(v) {
      if (!virtual) { nPlaybackRate.set.call(this, v); return }
      const s = st(this)
      reanchor(this, s); s.rate = Number(v) || 1
      scheduleEnd(this, s)
    },
  })
  // A new source resets the playhead. (Assigning src goes through the native setter; watch for the reset events.)
  const onReset = (e) => {
    const el = e.target
    if (!virtual || !(el instanceof HTMLMediaElement)) return
    const s = media.get(el)
    if (!s) return
    if (e.type === 'emptied' && !s.playing) { s.base = 0; s.anchor = vt; s.announced = false; s.ended = false; scheduleEnd(el, s) }
  }
  document.addEventListener('emptied', onReset, true)
  // Native autoplay (the <video autoPlay> of a clip) must not run on the real clock: turn it into a virtual play.
  document.addEventListener('play', (e) => {
    const el = e.target
    if (!virtual || !e.isTrusted || !(el instanceof HTMLMediaElement)) return
    nPause.call(el)
    const s = st(el)
    if (!s.playing && !s.realPlayed) { s.realPlayed = true; vplay(el) }
  }, true)

  /** Media waiting for data: hold the virtual clock (real time passes) until it can play, like a real player would. */
  async function settleMedia(budgetMs) {
    const t0 = nativePerfNow()
    for (const el of document.querySelectorAll('video')) {
      // A clip that is still loading holds the clock, as a learner's player would wait for it.
      while (el.isConnected && el.autoplay && el.readyState < 2 && !el.error && el.networkState !== 3 && nativePerfNow() - t0 < budgetMs) {
        await new Promise((r) => nativeSetTimeout(r, 15))
      }
      // Autoplay elements that the browser has not started (we stop them first) start virtually once they have data.
      const s = st(el)
      if (el.autoplay && !s.playing && !s.realPlayed && !s.ended && el.readyState >= 2 && el.isConnected) { s.realPlayed = true; vplay(el) }
    }
    for (const [el, s] of media) {
      if (!s.playing || s.announced) continue
      while (el.readyState < 3 && !el.error && el.networkState !== 3 && nativePerfNow() - t0 < budgetMs) {
        await new Promise((r) => nativeSetTimeout(r, 15))
      }
      if (!s.playing) continue
      s.announced = true; s.anchor = vt
      scheduleEnd(el, s)
      fire(el, 'playing')
      dirty = true
    }
  }

  /** Put every visible video's real frame on its virtual playhead before a capture. */
  async function seekVideos() {
    const waits = []
    for (const el of document.querySelectorAll('video')) {
      if (!el.isConnected || el.readyState < 1) continue
      const want = pos(el, st(el))
      const have = nCurrentTime.get.call(el)
      if (Math.abs(want - have) < 0.0005) continue
      dirty = true
      waits.push(new Promise((r) => {
        let done = false
        const fin = () => { if (done) return; done = true; el.removeEventListener('seeked', fin); r() }
        el.addEventListener('seeked', fin)
        nativeSetTimeout(fin, 4000)
        nCurrentTime.set.call(el, want)
      }))
    }
    // 'seeked' means the frame is decoded; the capture that follows composites it.
    if (waits.length) await Promise.all(waits)
  }

  /* ── CSS transitions / animations and the Web Animations framer-motion uses: seek them on the virtual clock ── */
  const anims = new WeakMap()
  function syncAnimations() {
    let list
    try { list = document.getAnimations() } catch { return 0 }
    let running = 0
    for (const a of list) {
      let s = anims.get(a)
      if (!s) {
        s = { start: vt, done: false }
        anims.set(a, s)
        try { a.pause() } catch { /* ignore */ }
      }
      if (s.done) continue
      const rate = a.playbackRate || 1
      const t = Math.max(0, (vt - s.start) * rate)
      let end = Infinity
      try { end = a.effect ? a.effect.getComputedTiming().endTime : Infinity } catch { /* ignore */ }
      try {
        if (Number.isFinite(end) && t >= end) { s.done = true; a.currentTime = end; a.finish() }
        else { if (a.playState !== 'paused') a.pause(); a.currentTime = t; running++ }
      } catch (e) { s.done = true }
      dirty = true
    }
    return running
  }

  // Anything that changes the DOM marks the frame dirty (the player's per-frame debug attributes do not).
  const IGNORE_ATTR = new Set(['data-clock', 'data-voice', 'data-hand-load-ms'])
  new MutationObserver((recs) => {
    for (const r of recs) if (r.type !== 'attributes' || !IGNORE_ATTR.has(r.attributeName)) { dirty = true; return }
  }).observe(document, { subtree: true, childList: true, attributes: true, characterData: true })

  /** Let React (MessageChannel tasks) and promise chains run to completion at the current virtual time. */
  const mc = new MessageChannel()
  const waiters = []
  mc.port1.onmessage = () => { const r = waiters.shift(); if (r) r() }
  const yieldTask = () => new Promise((r) => { waiters.push(r); mc.port2.postMessage(0) })
  async function drain(n = 4) { for (let i = 0; i < n; i++) await yieldTask() }

  function runTimersUntil(target) {
    let guard = 0
    inAdvance = true
    try {
      while (guard++ < 5000) {
        let best = null, bestId = 0
        for (const [id, t] of timers) if (t.due <= target && (!best || t.due < best.due || (t.due === best.due && t.seq < best.seq))) { best = t; bestId = id }
        if (!best) break
        if (best.due > vt) vt = best.due
        if (best.every) { best.due = vt + best.every; best.seq = ++seq } else timers.delete(bestId)
        try { typeof best.fn === 'function' ? best.fn(...(best.args || [])) : (0, eval)(String(best.fn)) } catch (e) { errors.push(String(e && e.stack || e).slice(0, 300)) }
      }
    } finally { inAdvance = false }
  }

  W.__vclock = {
    get virtual() { return virtual },
    get now() { return vt },
    errors,
    /** Switch to the virtual clock, starting from the real time now. */
    enable() {
      if (virtual) return vt
      vt = nativePerfNow(); dateOffset = NativeDate.now() - vt
      virtual = true
      for (const el of document.querySelectorAll('audio,video')) if (nPaused.get.call(el) === false) { nPause.call(el); vplay(el) }
      return vt
    },
    /** Advance the clock by `ms` and render the frame. Resolves {t, dirty}. */
    async step(ms) {
      const target = vt + ms
      phase = 'settle1'
      await settleMedia(20000)
      phase = 'timers'
      // Timers (and media ends) in time order, letting the page react between them.
      for (let k = 0; k < 50; k++) {
        const before = vt
        runTimersUntil(target)
        if (vt === before) break
        await drain(2)
      }
      vt = target
      phase = 'raf'
      const cbs = rafs
      rafs = new Map()
      for (const fn of cbs.values()) { try { fn(vt) } catch (e) { errors.push(String(e && e.stack || e).slice(0, 300)) } }
      await drain(4)
      runTimersUntil(target) // zero-delay work scheduled by the frame
      await drain(2)
      phase = 'settle2'
      await settleMedia(20000)
      phase = 'anims'
      syncAnimations()
      phase = 'seek'
      await seekVideos()
      phase = 'done'
      const d = dirty || media.size > 0 && [...media.values()].some((s) => s.playing && s.announced && document.querySelector('video'))
      dirty = false
      return { t: vt, dirty: d }
    },
    stats() { return { timers: timers.size, rafs: rafs.size, media: media.size, errors: errors.length, phase } },
  }
})()
