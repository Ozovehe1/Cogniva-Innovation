import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return request.cookies.getAll() },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )
  const { data: { user } } = await supabase.auth.getUser()
  const path = request.nextUrl.pathname
  const isPublic =
    path === '/' ||
    path.startsWith('/login') ||
    path.startsWith('/signup') ||
    path === '/about' ||
    path === '/learn/demo/ink-test' ||
    // Wakes the narration voice when a lesson opens (public demo too); only voices lessons for signed-in users.
    path === '/api/tts/warm' ||
    // Whiteboard assets (the 3D hand model and its fallback sprite).
    path.startsWith('/whiteboard/') ||
    // Tutor character (Rive file and its self-hosted runtime).
    path.startsWith('/genie/') ||
    // Called by the Modal render service; authenticated with X-Render-Token instead of a session.
    path === '/api/manim/callback' ||
    // Lesson video recorder (Modal): the callback uses X-Render-Token, the render page a signed, expiring job token.
    path === '/api/video/callback' ||
    /^\/render\/lesson\/[0-9a-f-]{36}$/i.test(path) ||
    // Lesson drafting hand-over (x-draft-key HMAC) and the cron / pg_cron ticks (bearer secrets): they
    // authenticate themselves. Without this they were redirected to /login, so unattended drafting stalled.
    /^\/api\/lessons\/[^/]+\/draft\/run$/.test(path) ||
    path === '/api/cron/lesson-drafts' ||
    // Agent queue drain (pg_cron) and eval runner: Bearer AGENT_SECRET.
    path === '/api/agent/tick' || path === '/api/agent/eval' ||
    // LLM pool health: Bearer AGENT_SECRET or an admin session (checked in the route).
    path === '/api/admin/llm-pool' ||
    // Teaching Playbook background job (pg_cron): Bearer AGENT_SECRET.
    path === '/api/playbook/tick'
  if (!user && !isPublic) {
    const login = new URL('/login', request.url)
    // Pages (not API calls) come back to where they were after signing in.
    if (!path.startsWith('/api/') && request.method === 'GET') login.searchParams.set('next', path + request.nextUrl.search)
    return NextResponse.redirect(login)
  }
  return supabaseResponse
}
