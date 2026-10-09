#!/usr/bin/env node
/**
 * Deploys the Modal apps in modal_app/ during the Vercel production build
 * (runs before `next build`):
 *   - manim_render.py  -> app "geniusmap-manim" (Manim clip renders)
 *   - tts.py           -> app "geniusmap-tts"   (Kokoro narration voice)
 *   - py_sandbox.py    -> app "geniusmap-py"    (agent run_python sandbox)
 *
 * Runs only when:
 *   - VERCEL_ENV === 'production'
 *   - MODAL_TOKEN_ID and MODAL_TOKEN_SECRET are set (Vercel project env)
 *   - the app's file changed since VERCEL_GIT_PREVIOUS_SHA (or that SHA is unknown),
 *     or FORCE_MODAL_DEPLOY=1 (all apps)
 *
 * It never fails the build: every error is logged as a warning and the script exits 0.
 * Secret values are never printed.
 */
import { spawnSync } from 'node:child_process'

const TAG = '[deploy-modal]'
const log = (...a) => console.log(TAG, ...a)
const warn = (...a) => console.warn(`${TAG} WARNING:`, ...a)
const DEFAULT_APP_URL = 'https://cogniva-innovation.vercel.app'

// Vercel truncates very long log messages, so print one line per call and only the tail.
const TAIL_LINES = 60
function run(cmd, args, { timeoutMs = 10 * 60_000, env = process.env, quiet = false } = {}) {
  const r = spawnSync(cmd, args, { env, encoding: 'utf8', timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024 })
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`
  if (!quiet && out.trim()) {
    const lines = out.trim().split('\n').filter(l => l.trim())
    if (lines.length > TAIL_LINES) console.log(`${TAG}   ... (${lines.length - TAIL_LINES} earlier lines omitted)`)
    for (const l of lines.slice(-TAIL_LINES)) console.log(`${TAG}   ${l.slice(0, 500)}`)
  }
  return { ok: r.status === 0 && !r.error, out, error: r.error }
}

const APPS = [
  { file: 'modal_app/manim_render.py', deps: ['modal_app/pen_export.py', 'modal_app/gm_scene.py', 'modal_app/gm_compose.py', 'modal_app/gm_llm.py', 'modal_app/gm_grammar.md', 'modal_app/gm_parts.py', 'modal_app/gm_rigs.py', 'modal_app/gm_refdata.py', 'modal_app/gm_mesh3d.py', 'modal_app/gm_partcompose.py', 'modal_app/gm_memory.json', 'modal_app/lesson_video.py', 'modal_app/lesson_video_clock.js'], urlRe: /https:\/\/[a-z0-9-]+--geniusmap-manim-render[a-z0-9-]*\.modal\.run/i, env: 'MODAL_RENDER_URL' },
  { file: 'modal_app/tts.py', urlRe: /https:\/\/[a-z0-9-]+--geniusmap-tts[a-z0-9-]*\.modal\.run/i, env: 'MODAL_TTS_URL' },
  // Python sandbox for the agent's run_python tool (no network, 1 CPU, 1 GiB, 20 s per run).
  { file: 'modal_app/py_sandbox.py', urlRe: /https:\/\/[a-z0-9-]+--geniusmap-py[a-z0-9-]*\.modal\.run/i, env: 'MODAL_PY_URL' },
  // OmniSVG text-to-SVG trial (GPU, scale to zero; not used by the app). Endpoint is token-protected.
  { file: 'modal_app/omnisvg_eval.py', urlRe: /https:\/\/[a-z0-9-]+--geniusmap-omnisvg-eval[a-z0-9-]*\.modal\.run/i, env: 'MODAL_OMNISVG_URL' },
]

/** Which app files need a deploy. */
function changedApps() {
  if (process.env.FORCE_MODAL_DEPLOY === '1') return { files: APPS.map(a => a.file), why: 'FORCE_MODAL_DEPLOY=1' }
  const prev = process.env.VERCEL_GIT_PREVIOUS_SHA
  const head = process.env.VERCEL_GIT_COMMIT_SHA || 'HEAD'
  if (!prev) return { files: APPS.map(a => a.file), why: 'no previous deployment SHA' }
  const r = run('git', ['diff', '--name-only', prev, head, '--', 'modal_app'], { quiet: true, timeoutMs: 30_000 })
  if (!r.ok) return { files: APPS.map(a => a.file), why: `previous SHA ${prev.slice(0, 7)} not available in this clone` }
  const files = r.out.split('\n').filter(Boolean)
  return { files: APPS.filter(a => [a.file, ...(a.deps ?? [])].some(f => files.includes(f))).map(a => a.file), why: files.length ? `changed: ${files.join(', ')}` : `no changes in modal_app since ${prev.slice(0, 7)}` }
}

function main() {
  if (process.env.VERCEL_ENV !== 'production') { log(`skipped (VERCEL_ENV=${process.env.VERCEL_ENV ?? 'unset'})`); return }
  const missing = ['MODAL_TOKEN_ID', 'MODAL_TOKEN_SECRET', 'RENDER_TOKEN'].filter(k => !(process.env[k] ?? '').trim())
  if (missing.length) { warn(`not set or empty in the build env: ${missing.join(', ')}; skipping Modal deploy.`); return }

  const c = changedApps()
  if (!c.files.length) { log(`skipped (${c.why})`); return }
  log(`deploying ${c.files.join(', ')} (${c.why})`)

  const py = ['python3', 'python'].find(p => run(p, ['--version'], { quiet: true, timeoutMs: 15_000 }).ok)
  if (!py) { warn('python3 is not available in the build image; skipping.'); return }

  // Install the Modal client.
  let pip = run(py, ['-m', 'pip', 'install', '--user', '--quiet', '--disable-pip-version-check', 'modal'], { quiet: true })
  if (!pip.ok && /No module named pip/i.test(pip.out)) {
    run(py, ['-m', 'ensurepip', '--user'], { quiet: true })
    pip = run(py, ['-m', 'pip', 'install', '--user', '--quiet', '--disable-pip-version-check', 'modal'], { quiet: true })
  }
  if (!pip.ok && /externally-managed/i.test(pip.out)) {
    pip = run(py, ['-m', 'pip', 'install', '--user', '--quiet', '--disable-pip-version-check', '--break-system-packages', 'modal'], { quiet: true })
  }
  if (!pip.ok) { warn('pip install modal failed:\n' + pip.out.slice(-2000)); return }
  log('modal client installed')

  const env = { ...process.env, PYTHONUNBUFFERED: '1' }

  // Create/update the runtime secret. Values go in argv only; output is not echoed.
  const appUrl = process.env.APP_URL || DEFAULT_APP_URL
  // GEMINI_API_KEY: the visual composer (modal_app/gm_compose.py) plans and writes scenes at render time on Modal.
  const gem = (process.env.GEMINI_API_KEY ?? '').trim()
  const gem2 = (process.env.GEMINI_API_KEY_2 ?? '').trim()
  const gem3 = (process.env.GEMINI_API_KEY_3 ?? '').trim()
  const gem4 = (process.env.GEMINI_API_KEY_4 ?? '').trim()
  const sec = run(py, ['-m', 'modal', 'secret', 'create', 'geniusmap-render', `RENDER_TOKEN=${process.env.RENDER_TOKEN}`, `APP_URL=${appUrl}`, ...(gem ? [`GEMINI_API_KEY=${gem}`] : []), ...(gem2 ? [`GEMINI_API_KEY_2=${gem2}`] : []), ...(gem3 ? [`GEMINI_API_KEY_3=${gem3}`] : []), ...(gem4 ? [`GEMINI_API_KEY_4=${gem4}`] : []), '--force'], { env, quiet: true, timeoutMs: 120_000 })
  if (!sec.ok) {
    let safe = sec.out.split(process.env.RENDER_TOKEN).join('***')
    if (gem) safe = safe.split(gem).join('***')
    warn('modal secret create failed:\n' + safe.slice(-2000))
    return
  }
  log(`secret geniusmap-render updated (RENDER_TOKEN, APP_URL=${appUrl}${gem ? ', GEMINI_API_KEY' : ''}${gem2 ? ', GEMINI_API_KEY_2' : ''}${gem3 ? ', GEMINI_API_KEY_3' : ''}${gem4 ? ', GEMINI_API_KEY_4' : ''})`)

  // Deploy. A first deploy builds the image on Modal and can take several minutes.
  for (const app of APPS.filter(a => c.files.includes(a.file))) {
    log(`modal deploy ${app.file}`)
    const dep = run(py, ['-m', 'modal', 'deploy', app.file], { env, timeoutMs: 25 * 60_000 })
    if (!dep.ok) { warn(`modal deploy ${app.file} failed${dep.error ? ` (${dep.error.message})` : ''}.`); continue }
    const url = dep.out.match(app.urlRe)?.[0]
    if (url) log(`${app.env}=${url}`)
    else warn(`${app.file} deployed, but the web endpoint URL was not found in the output.`)
  }
  log('done')
}

try {
  main()
} catch (err) {
  warn(err instanceof Error ? err.message : String(err))
}
process.exit(0)
