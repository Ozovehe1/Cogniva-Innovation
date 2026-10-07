import { NextResponse } from 'next/server'
import { getSessionProfile } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { ensureNarration } from '@/lib/tts-server'
import { MAX_TTS_CHARS, type NarrationClip } from '@/lib/narration'

export const maxDuration = 120

/** Per-user limits on newly synthesized lines (cache hits are free). */
const LIMITS = {
  student: { windowMin: 10, perWindow: 90, perDay: 700 },
  tutor: { windowMin: 10, perWindow: 400, perDay: 4000 },
}

/**
 * POST /api/tts   (signed-in users)
 * Body: { texts: string[] (1..8), lessonId? }
 * Returns { clips: ({ key, url, ms, words } | null)[] } in the same order. Lines
 * already cached are returned straight from storage; missing lines are
 * synthesized with Kokoro on Modal, stored, and counted against the user's limit.
 */
export async function POST(request: Request) {
  const { profile } = await getSessionProfile()
  if (!profile) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await request.json().catch(() => ({})) as { texts?: unknown }
  const texts = Array.isArray(body.texts) ? body.texts.filter((t): t is string => typeof t === 'string' && !!t.trim()).map(t => t.slice(0, MAX_TTS_CHARS)) : []
  if (!texts.length || texts.length > 8) return NextResponse.json({ error: 'Send 1 to 8 lines.' }, { status: 400 })
  return synthesizeFor(profile, texts)
}

/**
 * GET /api/tts?text=...   (signed-in users)
 * One line as audio/mpeg. Word timings ride in headers:
 *   X-Narration-Ms     clip length in ms
 *   X-Narration-Words  base64url JSON [{ w, s, e }] (ms from the start of the clip)
 *   X-Narration-Key    content key of the cached clip
 * Same cache and limits as POST.
 */
export async function GET(request: Request) {
  const { profile } = await getSessionProfile()
  if (!profile) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const text = (new URL(request.url).searchParams.get('text') ?? '').trim().slice(0, MAX_TTS_CHARS)
  if (!text) return NextResponse.json({ error: 'Pass ?text=' }, { status: 400 })
  const res = await synthesizeFor(profile, [text])
  if (!res.ok) return res
  const j = await res.json() as { clips?: (NarrationClip | null)[] }
  const clip = j.clips?.[0]
  if (!clip) return NextResponse.json({ error: 'The voice is unavailable right now.' }, { status: 502 })
  const audio = await fetch(clip.url, { cache: 'no-store' }).catch(() => null)
  if (!audio?.ok) return NextResponse.json({ error: 'Cached audio could not be read.' }, { status: 502 })
  return new Response(audio.body, {
    headers: {
      'Content-Type': 'audio/mpeg',
      'Cache-Control': 'private, max-age=3600',
      'X-Narration-Ms': String(clip.ms),
      'X-Narration-Words': Buffer.from(JSON.stringify(clip.words)).toString('base64url'),
      'X-Narration-Key': clip.key,
    },
  })
}

type Profile = NonNullable<Awaited<ReturnType<typeof getSessionProfile>>['profile']>

async function synthesizeFor(profile: Profile, texts: string[]): Promise<Response> {
  let admin
  try { admin = createAdminClient() } catch { return NextResponse.json({ error: 'Server not configured' }, { status: 500 }) }

  const lim = LIMITS[profile.role as keyof typeof LIMITS] ?? LIMITS.student
  const since = (min: number) => new Date(Date.now() - min * 60_000).toISOString()
  const [recent, day] = await Promise.all([
    admin.from('tts_usage').select('lines').eq('profile_id', profile.id).gte('created_at', since(lim.windowMin)),
    admin.from('tts_usage').select('lines').eq('profile_id', profile.id).gte('created_at', since(24 * 60)),
  ])
  const sum = (r: { data: { lines: number }[] | null }) => (r.data ?? []).reduce((a, b) => a + (b.lines ?? 0), 0)
  const overWindow = sum(recent) + texts.length > lim.perWindow
  const overDay = sum(day) + texts.length > lim.perDay

  try {
    // Over the limit: still serve cached lines, synthesize nothing new.
    if (overWindow || overDay) {
      const { clips } = await ensureNarration(texts, { cacheOnly: true }).catch(() => ({ clips: texts.map(() => null) }))
      if (clips.every(c => !c)) return NextResponse.json({ error: 'Voice limit reached for now; the device voice is used instead.' }, { status: 429 })
      return NextResponse.json({ clips, limited: true })
    }
    const t0 = Date.now()
    const r = await ensureNarration(texts, { timeoutMs: 100_000 })
    if (r.synthesized) await admin.from('tts_usage').insert({ profile_id: profile.id, lines: r.synthesized, chars: r.chars })
    return NextResponse.json({ clips: r.clips, synthesized: r.synthesized, ms: Date.now() - t0 })
  } catch (err) {
    console.error('TTS error:', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'The voice is unavailable right now.' }, { status: 502 })
  }
}
