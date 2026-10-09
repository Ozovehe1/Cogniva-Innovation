-- Teaching Playbook: learning without retraining (ACE-style itemised bullets + a Mistake-Notebook batch gate).
--   playbook_bullets  the GLOBAL playbook: abstract teaching rules only (never learner text, answers or personal data),
--                     each with helpful/harmful counters, an embedding (gte-small, 384) and a gate verdict
--   playbook_signals  evidence in: confirmed reports, guard catches, clip verifier failures, learner outcomes, successes.
--                     student_id is kept only to feed that learner's own private memory; the global reflector never
--                     reads it (it reads the anonymised payload only)
--   playbook_usage    which bullets were injected into which lesson / chat session (deterministic helpful/harmful credit)
--   playbook_events   the lifecycle log of each bullet (added, merged, gated, live, retired, counters)
--   playbook_state    watermarks for the harvester
-- Per-learner memory reuses learner_memory (owner-only RLS) with kind 'teaching_note'.
-- All tables are server-only (RLS on, no policies): written and read with the service role. Idempotent.

create table if not exists playbook_bullets (
  id uuid primary key default gen_random_uuid(),
  target text not null check (target in ('lesson', 'ask', 'diagram', 'illustration', 'manim')),
  kind text not null default 'avoid' check (kind in ('strategy', 'avoid')),
  subject text not null default '',
  topic text not null default '',
  topic_key text not null default '',
  skill text not null default '',
  text text not null check (char_length(text) between 12 and 400),
  -- yes/no question a judge asks of an output to see whether the mistake this bullet prevents is present
  check_q text,
  -- probe topics the gate generates on (abstract curriculum topics, never learner text)
  probes jsonb not null default '[]'::jsonb,
  -- illustration ranking hints: { prefer: [words], avoid: [words] }
  hints jsonb not null default '{}'::jsonb,
  status text not null default 'candidate' check (status in ('candidate', 'live', 'rejected', 'retired')),
  scope text not null default 'global' check (scope in ('global', 'eval')),
  helpful integer not null default 0,
  harmful integer not null default 0,
  evidence integer not null default 1,
  -- signal ids + source kinds that produced / reinforced it (no learner ids)
  sources jsonb not null default '[]'::jsonb,
  embedding extensions.vector(384),
  gate jsonb,
  gate_attempts integer not null default 0,
  gated_at timestamptz,
  version integer not null default 1,
  decided_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  live_at timestamptz,
  retired_at timestamptz
);
create index if not exists playbook_bullets_live_idx on playbook_bullets(target, status, scope);
create index if not exists playbook_bullets_topic_idx on playbook_bullets(target, topic_key) where status in ('candidate', 'live');
alter table playbook_bullets enable row level security;

create table if not exists playbook_signals (
  id bigint generated always as identity primary key,
  source text not null check (source in ('report', 'guard', 'clip', 'outcome', 'success', 'reexplain', 'confusion')),
  target text not null default 'lesson' check (target in ('lesson', 'ask', 'diagram', 'illustration', 'manim')),
  external boolean not null default true,
  subject text not null default '',
  topic text not null default '',
  skill text not null default '',
  -- anonymised, abstract evidence (what went wrong / right, guard issue kinds, step type) — checked by privacy.ts
  payload jsonb not null default '{}'::jsonb,
  weight real not null default 1,
  -- private layer only: whose lesson it was (feeds that learner's own teaching notes); never sent to the reflector
  student_id uuid references profiles(id) on delete cascade,
  lesson_id uuid references lessons(id) on delete set null,
  session_id uuid,
  dedupe_key text,
  status text not null default 'new' check (status in ('new', 'reflected', 'skipped')),
  scope text not null default 'global' check (scope in ('global', 'eval')),
  created_at timestamptz not null default now()
);
create unique index if not exists playbook_signals_dedupe_idx on playbook_signals(dedupe_key);
create index if not exists playbook_signals_new_idx on playbook_signals(status, created_at) where status = 'new';
create index if not exists playbook_signals_lesson_idx on playbook_signals(lesson_id) where lesson_id is not null;
alter table playbook_signals enable row level security;

create table if not exists playbook_usage (
  id bigint generated always as identity primary key,
  bullet_id uuid not null references playbook_bullets(id) on delete cascade,
  target text not null,
  lesson_id uuid references lessons(id) on delete cascade,
  session_id uuid,
  credited boolean not null default false,
  created_at timestamptz not null default now()
);
create unique index if not exists playbook_usage_lesson_idx on playbook_usage(bullet_id, lesson_id) where lesson_id is not null;
create unique index if not exists playbook_usage_session_idx on playbook_usage(bullet_id, session_id) where session_id is not null;
alter table playbook_usage enable row level security;

create table if not exists playbook_events (
  id bigint generated always as identity primary key,
  bullet_id uuid references playbook_bullets(id) on delete cascade,
  op text not null,
  detail jsonb not null default '{}'::jsonb,
  actor text not null default 'system',
  created_at timestamptz not null default now()
);
create index if not exists playbook_events_bullet_idx on playbook_events(bullet_id, created_at);
alter table playbook_events enable row level security;

create table if not exists playbook_state (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table playbook_state enable row level security;

-- Per-learner layer: private "what confused / what helped this learner" notes in the learner's own memory.
alter table learner_memory drop constraint if exists learner_memory_kind_check;
alter table learner_memory add constraint learner_memory_kind_check check (kind in ('lesson_summary', 'misconception', 'chat_summary', 'checkin_note', 'goal', 'teaching_note'));

-- Background job: every 20 minutes ask /api/playbook/tick to harvest signals, reflect, curate and gate.
-- Same Vault secret as agent-tick. The route itself is cheap when there is nothing new.
create or replace function public.playbook_tick() returns void
language plpgsql security definer set search_path = public, extensions as $$
declare s text;
begin
  select decrypted_secret into s from vault.decrypted_secrets where name = 'agent_secret' limit 1;
  if s is null then return; end if;
  perform net.http_get(
    url := 'https://cogniva-innovation.vercel.app/api/playbook/tick',
    headers := jsonb_build_object('Authorization', 'Bearer ' || s),
    timeout_milliseconds := 10000);
end $$;
revoke all on function public.playbook_tick() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'playbook-tick') then perform cron.unschedule('playbook-tick'); end if;
  perform cron.schedule('playbook-tick', '7,27,47 * * * *', 'select public.playbook_tick()');
end $$;
