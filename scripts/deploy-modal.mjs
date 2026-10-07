#!/usr/bin/env node
/**
 * Deploys the Manim render service (modal_app/manim_render.py) to Modal during
 * the Vercel production build. Runs before `next build`.
 *
 * Runs only when:
 *   - VERCEL_ENV === 'production'
 *   - MODAL_TOKEN_ID and MODAL_TOKEN_SECRET are set (Vercel project env)
 *   - modal_app/** changed since VERCEL_GIT_PREVIOUS_SHA (or that SHA is unknown),
 *     or FORCE_MODAL_DEPLOY=1
 *
 * It never fails the build: every error is logged as a warning and the script exits 0.
 * Secret values are never printed.
 */
import { spawnSync } from 'node:child_process'

const TAG = '[deploy-modal]'
const log = (...a) => console.log(TAG, ...a)
const warn = (...a) => console.warn(`${TAG} WARNING:`, ...a)
const DEFAULT_APP_URL = 'https://cogniva-innovation.vercel.app'

function run(cmd, args, { timeoutMs = 10 * 60_000, env = process.env, quiet = false } = {}) {
  const r = spawnSync(cmd, args, { env, encoding: 'utf8', timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024 })
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`
  if (!quiet && out.trim()) console.log(out.trim().split('\n').map(l => `${TAG}   ${l}`).join('\n'))
  return { ok: r.status === 0 && !r.error, out, error: r.error }
}

function modalChanged() {
  if (process.env.FORCE_MODAL_DEPLOY === '1') return { changed: true, why: 'FORCE_MODAL_DEPLOY=1' }
  const prev = process.env.VERCEL_GIT_PREVIOUS_SHA
  const head = process.env.VERCEL_GIT_COMMIT_SHA || 'HEAD'
  if (!prev) return { changed: true, why: 'no previous deployment SHA' }
  const r = run('git', ['diff', '--name-only', prev, head, '--', 'modal_app'], { quiet: true, timeoutMs: 30_000 })
  if (!r.ok) return { changed: true, why: `previous SHA ${prev.slice(0, 7)} not available in this clone` }
  const files = r.out.split('\n').filter(Boolean)
  return files.length ? { changed: true, why: `changed: ${files.join(', ')}` } : { changed: false, why: `no changes in modal_app since ${prev.slice(0, 7)}` }
}

function main() {
  if (process.env.VERCEL_ENV !== 'production') { log(`skipped (VERCEL_ENV=${process.env.VERCEL_ENV ?? 'unset'})`); return }
  const missing = ['MODAL_TOKEN_ID', 'MODAL_TOKEN_SECRET', 'RENDER_TOKEN'].filter(k => !(process.env[k] ?? '').trim())
  if (missing.length) { warn(`not set or empty in the build env: ${missing.join(', ')}; skipping Modal deploy.`); return }

  const c = modalChanged()
  if (!c.changed) { log(`skipped (${c.why})`); return }
  log(`deploying (${c.why})`)

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
  const sec = run(py, ['-m', 'modal', 'secret', 'create', 'geniusmap-render', `RENDER_TOKEN=${process.env.RENDER_TOKEN}`, `APP_URL=${appUrl}`, '--force'], { env, quiet: true, timeoutMs: 120_000 })
  if (!sec.ok) {
    const safe = sec.out.split(process.env.RENDER_TOKEN).join('***')
    warn('modal secret create failed:\n' + safe.slice(-2000))
    return
  }
  log(`secret geniusmap-render updated (RENDER_TOKEN, APP_URL=${appUrl})`)

  // Deploy. The first deploy builds the LaTeX image on Modal and can take several minutes.
  const dep = run(py, ['-m', 'modal', 'deploy', 'modal_app/manim_render.py'], { env, timeoutMs: 25 * 60_000 })
  if (!dep.ok) { warn(`modal deploy failed${dep.error ? ` (${dep.error.message})` : ''}.`); return }
  const url = dep.out.match(/https:\/\/[a-z0-9-]+--geniusmap-manim-render[a-z0-9-]*\.modal\.run/i)?.[0]
  if (url) log(`MODAL_RENDER_URL=${url}`)
  else warn('deployed, but the web endpoint URL was not found in the output.')
  log('done')
}

try {
  main()
} catch (err) {
  warn(err instanceof Error ? err.message : String(err))
}
process.exit(0)
