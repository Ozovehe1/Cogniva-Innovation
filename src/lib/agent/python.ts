/**
 * run_python for the agent: numpy, sympy, scipy, matplotlib, pandas and networkx in a Modal Sandbox
 * (modal_app/py_sandbox.py: no network, 1 CPU, 1 GiB, 20 s, non-root, fresh per run). matplotlib figures
 * come back as PNGs. When the sandbox is not reachable, Groq's built-in code interpreter (gpt-oss) runs the
 * code instead (text output only) — only with AGENT_PY_GROQ_FALLBACK=1, because Groq's interpreter is not
 * network-isolated. The code is written by the model, never typed by the learner; a static
 * screen refuses process, network, native-code and introspection escapes before anything runs. Server only.
 */
import { chat, groqEnabled } from './llm'

const BLOCKED: [RegExp, string][] = [
  [/\b(import|from)\s+(subprocess|socket|ctypes|cffi|multiprocessing|threading|asyncio|requests|urllib\d?|http|httpx|aiohttp|ftplib|smtplib|telnetlib|paramiko|pty|resource|signal|importlib|builtins|sys|os|pathlib|shutil|tempfile|glob|pickle|marshal|code|codeop|inspect|gc)\b/, 'that module is not available in the sandbox'],
  [/\b__(import|builtins|subclasses|globals|class|bases|mro|code|loader|spec)__\b/, 'introspection is not allowed'],
  [/\b(eval|exec|compile|open|input|breakpoint|getattr|setattr|delattr|globals|locals|vars)\s*\(/, 'that built-in is not allowed'],
  [/\bos\.|\bsys\.|\bsubprocess\b|\bsocket\b/, 'system access is not allowed'],
]

export function screenPython(code: string): string | null {
  if (code.length > 12_000) return 'the code is too long (12,000 characters max)'
  for (const [re, why] of BLOCKED) if (re.test(code)) return why
  return null
}

export interface PyResult { ok: boolean; stdout: string; error: string | null; images: string[]; ms: number; engine: 'modal' | 'groq' }

function pyUrl(): string | null {
  const explicit = process.env.MODAL_PY_URL?.trim()
  if (explicit) return explicit.replace(/\/$/, '')
  const render = process.env.MODAL_RENDER_URL?.trim()
  if (render && /geniusmap-manim-render/.test(render)) return render.replace('geniusmap-manim-render', 'geniusmap-py').replace(/\/$/, '')
  return null
}

export async function runPython(code: string): Promise<PyResult> {
  const why = screenPython(code)
  if (why) return { ok: false, stdout: '', error: `Refused: ${why}.`, images: [], ms: 0, engine: 'modal' }
  const url = pyUrl()
  const t0 = Date.now()
  if (url && process.env.RENDER_TOKEN) {
    try {
      const res = await fetch(`${url}/run`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Render-Token': process.env.RENDER_TOKEN },
        body: JSON.stringify({ code }), signal: AbortSignal.timeout(80_000),
      })
      if (res.ok) {
        const j = await res.json() as { ok: boolean; stdout: string; error: string | null; images: string[]; ms: number }
        return { ok: j.ok, stdout: String(j.stdout ?? '').slice(0, 8000), error: j.error ?? null, images: (j.images ?? []).slice(0, 4).filter(b => typeof b === 'string' && b.length < 2_500_000), ms: j.ms ?? Date.now() - t0, engine: 'modal' }
      }
      const detail = (await res.text().catch(() => '')).slice(0, 300)
      console.warn('Python sandbox answered', res.status, detail)
      if (!process.env.AGENT_PY_GROQ_FALLBACK) return { ok: false, stdout: '', error: `The Python sandbox failed (${res.status}).`, images: [], ms: Date.now() - t0, engine: 'modal' }
    } catch (err) {
      console.warn('Python sandbox unreachable:', err instanceof Error ? err.message : err)
    }
  }
  // Groq's code interpreter has internet access, so it is only a fallback when explicitly allowed (AGENT_PY_GROQ_FALLBACK=1).
  if (!groqEnabled() || process.env.AGENT_PY_GROQ_FALLBACK !== '1') return { ok: false, stdout: '', error: 'The Python sandbox is not available right now.', images: [], ms: Date.now() - t0, engine: 'modal' }
  // Fallback: Groq code interpreter (no figures, not network-isolated).
  const r = await chat({
    purpose: 'light', builtin: 'code_interpreter', maxTokens: 600,
    messages: [{ role: 'user', content: `Run exactly this Python code with the python tool and report its printed output verbatim, nothing else.\n\n\`\`\`python\n${code}\n\`\`\`` }],
  })
  const ex = (r.executed ?? []).find(e => e.type === 'function' || /python|code/.test(e.type))
  return { ok: !!ex, stdout: String(ex?.output ?? r.text ?? '').slice(0, 8000), error: ex ? null : 'The code interpreter did not run the code.', images: [], ms: Date.now() - t0, engine: 'groq' }
}
