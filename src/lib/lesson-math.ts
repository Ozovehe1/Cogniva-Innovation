/**
 * Generation-time maths gate for lesson scripts: narration ("say"), board notes,
 * maths elements and in-lesson checks. Bare LaTeX is delimited, snippets are
 * repaired and KaTeX-validated; what cannot be repaired becomes plain Unicode
 * (or \text{...} on a maths element) and is reported so the caller can re-ask once.
 *
 * Stored lessons are not rewritten on read (narration text keys the cached voice
 * and the cue word indices); the renderers normalise them at display time instead.
 */
import type { Step } from './lesson-schema'
import { normalizeMathText, normalizeTex, texToPlain } from './math-text'

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v)

/** {{expr}} live-value templates are not LaTeX: swap them for a number while validating. */
function texOk(tex: string): string | null {
  if (!/\{\{/.test(tex)) return normalizeTex(tex)
  const parts: string[] = []
  const masked = tex.replace(/\{\{[^}]*\}\}/g, m => { parts.push(m); return `9${parts.length - 1}9` })
  const fixed = normalizeTex(masked)
  if (fixed === null) return null
  return fixed.replace(/9(\d+)9/g, (m, i: string) => parts[Number(i)] ?? m)
}

function textField(s: Obj, key: string, issues: string[], at: string) {
  const v = s[key]
  if (typeof v !== 'string' || !v) return
  if (/\{\{/.test(v)) return // live templates: left to the renderer
  const bad: string[] = []
  s[key] = normalizeMathText(v, bad)
  for (const b of bad) issues.push(`${at}.${key}: invalid LaTeX "${b}" (KaTeX cannot parse it)`)
}

export function normalizeLessonMath(steps: Step[]): { steps: Step[]; issues: string[] } {
  const issues: string[] = []
  const fix = (raw: unknown, at: string): unknown => {
    if (!isObj(raw)) return raw
    const s: Obj = { ...raw }
    textField(s, 'say', issues, at)
    if (s.type === 'write' || s.type === 'transform') textField(s, 'text', issues, at)
    if ((s.type === 'math' || s.type === 'transform') && typeof s.tex === 'string') {
      const t = texOk(s.tex.replace(/^\s*\$+|\$+\s*$/g, ''))
      if (t !== null) s.tex = t
      else {
        issues.push(`${at}.tex: invalid LaTeX "${s.tex}" (KaTeX cannot parse it)`)
        s.tex = `\\text{${texToPlain(s.tex).replace(/[{}\\$%&#_^~]/g, ' ')}}`
      }
    }
    if (s.type === 'check') {
      textField(s, 'prompt', issues, at)
      textField(s, 'explanation', issues, at)
      if (Array.isArray(s.options)) s.options = s.options.map((o, i) => { const w: Obj = { o }; textField(w, 'o', issues, `${at}.options[${i}]`); return w.o })
      if (Array.isArray(s.reteach)) s.reteach = s.reteach.map((r, i) => fix(r, `${at}.reteach[${i}]`))
    }
    if (Array.isArray(s.cues)) s.cues = s.cues.map((c, i) => fix(c, `${at}.cues[${i}]`))
    return s
  }
  return { steps: steps.map((s, i) => fix(s, `steps[${i}]`) as Step), issues }
}
