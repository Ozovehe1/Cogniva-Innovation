-- GeniusMap agent v1: the Learning Director (code-first workflows) and "Ask GeniusMap" (one tool-using agent).
-- Free stack: pgvector (gte-small, 384 dims, embedded by the Supabase Edge Function "embed"), pg_cron, pgmq.
-- Every table is owner-read-only under RLS (student_id = get_my_profile_id()); the server writes with the
-- service role after checking the session. Idempotent: safe to re-run.

create extension if not exists vector with schema extensions;
create extension if not exists pgmq;
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- ── Audit log of every agent / director write (idempotency + undo + one-tap confirm) ──
create table if not exists agent_actions (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references profiles(id) on delete cascade,
  run_id text,
  source text not null default 'agent' check (source in ('agent', 'director', 'student')),
  tool text not null,
  args jsonb not null default '{}'::jsonb,
  result jsonb,
  idempotency_key text unique,
  autonomy text not null default 'auto' check (autonomy in ('auto', 'confirm')),
  status text not null default 'done' check (status in ('proposed', 'done', 'undone', 'declined', 'failed', 'expired')),
  undo jsonb,
  summary text,
  created_at timestamptz not null default now(),
  decided_at timestamptz
);
create index if not exists agent_actions_student_idx on agent_actions(student_id, created_at desc);
alter table agent_actions enable row level security;
drop policy if exists own_agent_actions on agent_actions;
create policy own_agent_actions on agent_actions for select using (student_id = get_my_profile_id());

-- ── Learner model: one row per skill on a path (BKT-style p_mastery + an FSRS card from ts-fsrs) ──
create table if not exists learner_skill_state (
  student_id uuid not null references profiles(id) on delete cascade,
  path_id uuid not null references learning_paths(id) on delete cascade,
  node_id text not null,
  title text not null default '',
  lesson_id uuid references lessons(id) on delete set null,
  p_mastery real not null default 0.3,
  n_obs integer not null default 0,
  last_obs_at timestamptz,
  fsrs_card jsonb,
  due_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (student_id, path_id, node_id)
);
create index if not exists learner_skill_state_due_idx on learner_skill_state(student_id, due_at);
alter table learner_skill_state enable row level security;
drop policy if exists own_skill_state on learner_skill_state;
create policy own_skill_state on learner_skill_state for select using (student_id = get_my_profile_id());

-- ── Long-term memory for fuzzy recall (RAG). No HNSW: one learner has a few hundred rows, so an exact scan
-- after the student filter has perfect recall. ──
create table if not exists learner_memory (
  id bigint generated always as identity primary key,
  student_id uuid not null references profiles(id) on delete cascade,
  kind text not null check (kind in ('lesson_summary', 'misconception', 'chat_summary', 'checkin_note', 'goal')),
  path_id uuid references learning_paths(id) on delete cascade,
  node_id text,
  lesson_id uuid references lessons(id) on delete cascade,
  title text not null default '',
  content text not null,
  source_key text,
  fts tsvector generated always as (to_tsvector('english', coalesce(title, '') || ' ' || content)) stored,
  embedding extensions.vector(384),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '365 days'
);
create unique index if not exists learner_memory_source_idx on learner_memory(student_id, source_key) where source_key is not null;
create index if not exists learner_memory_student_idx on learner_memory(student_id, kind);
create index if not exists learner_memory_fts_idx on learner_memory using gin (fts);
create index if not exists learner_memory_pending_idx on learner_memory(id) where embedding is null;
alter table learner_memory enable row level security;
drop policy if exists own_memory on learner_memory;
create policy own_memory on learner_memory for select using (student_id = get_my_profile_id());

-- ── Chat ──
create table if not exists chat_sessions (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references profiles(id) on delete cascade,
  lesson_id uuid references lessons(id) on delete set null,
  title text not null default 'New chat',
  summary text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists chat_sessions_student_idx on chat_sessions(student_id, updated_at desc);
create table if not exists chat_messages (
  id bigint generated always as identity primary key,
  session_id uuid not null references chat_sessions(id) on delete cascade,
  student_id uuid not null references profiles(id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null default '',
  blocks jsonb not null default '[]'::jsonb,
  meta jsonb,
  created_at timestamptz not null default now()
);
create index if not exists chat_messages_session_idx on chat_messages(session_id, id);
alter table chat_sessions enable row level security;
alter table chat_messages enable row level security;
drop policy if exists own_chat_sessions on chat_sessions;
create policy own_chat_sessions on chat_sessions for select using (student_id = get_my_profile_id());
drop policy if exists own_chat_messages on chat_messages;
create policy own_chat_messages on chat_messages for select using (student_id = get_my_profile_id());

-- ── Today's plan (precomputed: opening the app makes no LLM call) ──
create table if not exists daily_plans (
  student_id uuid not null references profiles(id) on delete cascade,
  plan_date date not null,
  items jsonb not null default '[]'::jsonb,
  note text,
  light boolean not null default false,
  source text not null default 'rule' check (source in ('nightly', 'rule', 'agent', 'checkin')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (student_id, plan_date)
);
alter table daily_plans enable row level security;
drop policy if exists own_daily_plans on daily_plans;
create policy own_daily_plans on daily_plans for select using (student_id = get_my_profile_id());

-- ── Per-student daily rationing (chat messages, animations, mini lessons) ──
create table if not exists agent_usage (
  student_id uuid not null references profiles(id) on delete cascade,
  day date not null,
  messages integer not null default 0,
  animations integer not null default 0,
  mini_lessons integer not null default 0,
  practice_sets integer not null default 0,
  web_searches integer not null default 0,
  python_runs integer not null default 0,
  primary key (student_id, day)
);
alter table agent_usage add column if not exists web_searches integer not null default 0;
alter table agent_usage add column if not exists python_runs integer not null default 0;
alter table agent_usage enable row level security;
drop policy if exists own_agent_usage on agent_usage;
create policy own_agent_usage on agent_usage for select using (student_id = get_my_profile_id());

-- Atomic take: returns the new count, or -1 when the limit is reached (service role only).
create or replace function public.agent_usage_take(p_student uuid, p_day date, p_field text, p_limit integer)
returns integer language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  if p_field not in ('messages', 'animations', 'mini_lessons', 'practice_sets', 'web_searches', 'python_runs') then raise exception 'bad field'; end if;
  insert into agent_usage(student_id, day) values (p_student, p_day) on conflict do nothing;
  execute format('update agent_usage set %1$I = %1$I + 1 where student_id = $1 and day = $2 and %1$I < $3 returning %1$I', p_field)
    into n using p_student, p_day, p_limit;
  return coalesce(n, -1);
end $$;
revoke all on function public.agent_usage_take(uuid, date, text, integer) from public, anon, authenticated;

-- ── Per-model budget guard shared by every server instance (free-tier RPM/RPD/TPM/TPD) ──
create table if not exists agent_model_usage (
  model text not null,
  bucket text not null,          -- 'm:2026-10-08T14:16' (minute) or 'd:2026-10-08' (UTC day)
  requests integer not null default 0,
  tokens integer not null default 0,
  primary key (model, bucket)
);
alter table agent_model_usage enable row level security;

create or replace function public.agent_budget_take(p_model text, p_tokens integer, p_rpm integer, p_rpd integer, p_tpm integer, p_tpd integer)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  mb text := 'm:' || to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI');
  db text := 'd:' || to_char(now() at time zone 'utc', 'YYYY-MM-DD');
  m agent_model_usage; d agent_model_usage;
begin
  insert into agent_model_usage(model, bucket) values (p_model, mb), (p_model, db) on conflict do nothing;
  select * into m from agent_model_usage where model = p_model and bucket = mb for update;
  select * into d from agent_model_usage where model = p_model and bucket = db for update;
  if m.requests + 1 > p_rpm or d.requests + 1 > p_rpd or m.tokens + p_tokens > p_tpm or d.tokens + p_tokens > p_tpd then
    return false;
  end if;
  update agent_model_usage set requests = requests + 1, tokens = tokens + p_tokens where model = p_model and bucket in (mb, db);
  return true;
end $$;
revoke all on function public.agent_budget_take(text, integer, integer, integer, integer, integer) from public, anon, authenticated;

-- Correct the token estimate once the real usage is known (may be negative).
create or replace function public.agent_budget_adjust(p_model text, p_delta integer)
returns void language sql security definer set search_path = public as $$
  update agent_model_usage set tokens = greatest(0, tokens + p_delta)
  where model = p_model and bucket in ('m:' || to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI'), 'd:' || to_char(now() at time zone 'utc', 'YYYY-MM-DD'));
$$;
revoke all on function public.agent_budget_adjust(text, integer) from public, anon, authenticated;

-- ── Hybrid search over the caller's own memory: full text + vector, fused with Reciprocal Rank Fusion.
-- security invoker: called with the learner's JWT, so RLS limits it to their rows. ──
create or replace function public.hybrid_search(
  query_text text,
  query_embedding extensions.vector(384),
  match_count integer default 8,
  full_text_weight real default 1,
  semantic_weight real default 1,
  rrf_k integer default 50
) returns table (id bigint, kind text, title text, content text, lesson_id uuid, node_id text, created_at timestamptz, score real)
language sql stable security invoker set search_path = public, extensions as $$
  with full_text as (
    select m.id, row_number() over (order by ts_rank_cd(m.fts, websearch_to_tsquery('english', query_text)) desc) as rank_ix
    from learner_memory m
    where m.expires_at > now() and query_text <> '' and m.fts @@ websearch_to_tsquery('english', query_text)
    order by rank_ix
    limit least(match_count, 30) * 2
  ),
  semantic as (
    select m.id, row_number() over (order by m.embedding <=> query_embedding) as rank_ix
    from learner_memory m
    where m.expires_at > now() and query_embedding is not null and m.embedding is not null
    order by rank_ix
    limit least(match_count, 30) * 2
  )
  select m.id, m.kind, m.title, m.content, m.lesson_id, m.node_id, m.created_at,
    (coalesce(1.0 / (rrf_k + f.rank_ix), 0.0) * full_text_weight + coalesce(1.0 / (rrf_k + s.rank_ix), 0.0) * semantic_weight)::real as score
  from full_text f
  full outer join semantic s on f.id = s.id
  join learner_memory m on m.id = coalesce(f.id, s.id)
  order by score desc
  limit least(match_count, 30);
$$;
grant execute on function public.hybrid_search(text, extensions.vector, integer, real, real, integer) to authenticated, service_role;

-- Service-role variant for background jobs and evals: the student is passed explicitly by the server
-- (taken from the session or the job, never from model arguments).
create or replace function public.hybrid_search_for(
  p_student uuid, query_text text, query_embedding extensions.vector(384), match_count integer default 8, rrf_k integer default 50
) returns table (id bigint, kind text, title text, content text, lesson_id uuid, node_id text, created_at timestamptz, score real)
language sql stable security definer set search_path = public, extensions as $$
  with full_text as (
    select m.id, row_number() over (order by ts_rank_cd(m.fts, websearch_to_tsquery('english', query_text)) desc) as rank_ix
    from learner_memory m
    where m.student_id = p_student and m.expires_at > now() and query_text <> '' and m.fts @@ websearch_to_tsquery('english', query_text)
    order by rank_ix limit least(match_count, 30) * 2
  ),
  semantic as (
    select m.id, row_number() over (order by m.embedding <=> query_embedding) as rank_ix
    from learner_memory m
    where m.student_id = p_student and m.expires_at > now() and query_embedding is not null and m.embedding is not null
    order by rank_ix limit least(match_count, 30) * 2
  )
  select m.id, m.kind, m.title, m.content, m.lesson_id, m.node_id, m.created_at,
    (coalesce(1.0 / (rrf_k + f.rank_ix), 0.0) + coalesce(1.0 / (rrf_k + s.rank_ix), 0.0))::real as score
  from full_text f full outer join semantic s on f.id = s.id
  join learner_memory m on m.id = coalesce(f.id, s.id)
  where m.student_id = p_student
  order by score desc limit least(match_count, 30);
$$;
revoke all on function public.hybrid_search_for(uuid, text, extensions.vector, integer, integer) from public, anon, authenticated;

-- ── agent_events queue (pgmq) with thin wrappers the server calls through PostgREST (service role only) ──
do $$ begin
  if not exists (select 1 from pgmq.list_queues() where queue_name = 'agent_events') then
    perform pgmq.create('agent_events');
  end if;
end $$;

create or replace function public.agent_enqueue(p_kind text, p_student uuid, p_payload jsonb default '{}'::jsonb, p_delay integer default 0)
returns bigint language sql security definer set search_path = public, pgmq as $$
  select pgmq.send('agent_events', jsonb_build_object('kind', p_kind, 'student_id', p_student, 'payload', p_payload), p_delay);
$$;
create or replace function public.agent_dequeue(p_n integer default 5, p_vt integer default 120)
returns table (msg_id bigint, read_ct integer, message jsonb) language sql security definer set search_path = public, pgmq as $$
  select msg_id, read_ct, message from pgmq.read('agent_events', p_vt, p_n);
$$;
create or replace function public.agent_ack(p_msg_id bigint)
returns boolean language sql security definer set search_path = public, pgmq as $$
  select pgmq.archive('agent_events', p_msg_id);
$$;
revoke all on function public.agent_enqueue(text, uuid, jsonb, integer) from public, anon, authenticated;
revoke all on function public.agent_dequeue(integer, integer) from public, anon, authenticated;
revoke all on function public.agent_ack(bigint) from public, anon, authenticated;

-- ── Unattended work, on the free plans (Vercel Hobby crons are daily only) ──
-- agent-tick: every minute, only when the queue has messages, ask /api/agent/tick to drain it.
-- agent-embed: every minute, only when memory rows lack an embedding, ask the Edge Function to embed them.
-- agent-nightly: 01:00 UTC (02:00 WAT) enqueue a nightly plan for every learner active in the last 14 days.
-- Secret: Supabase Vault 'agent_secret' (same value as AGENT_SECRET on Vercel and on the Edge Function).
create or replace function public.agent_tick() returns void
language plpgsql security definer set search_path = public, extensions, pgmq as $$
declare s text;
begin
  if not exists (select 1 from pgmq.q_agent_events where vt <= now()) then return; end if;
  select decrypted_secret into s from vault.decrypted_secrets where name = 'agent_secret' limit 1;
  if s is null then return; end if;
  perform net.http_get(
    url := 'https://cogniva-innovation.vercel.app/api/agent/tick',
    headers := jsonb_build_object('Authorization', 'Bearer ' || s),
    timeout_milliseconds := 10000);
end $$;
revoke all on function public.agent_tick() from public, anon, authenticated;

create or replace function public.agent_embed_tick() returns void
language plpgsql security definer set search_path = public, extensions as $$
declare s text;
begin
  if not exists (select 1 from learner_memory where embedding is null limit 1) then return; end if;
  select decrypted_secret into s from vault.decrypted_secrets where name = 'agent_secret' limit 1;
  if s is null then return; end if;
  perform net.http_post(
    url := 'https://tyessjnrwznyizficuyp.supabase.co/functions/v1/embed',
    body := jsonb_build_object('mode', 'pending', 'limit', 40),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-agent-secret', s),
    timeout_milliseconds := 60000);
end $$;
revoke all on function public.agent_embed_tick() from public, anon, authenticated;

create or replace function public.agent_nightly() returns integer
language plpgsql security definer set search_path = public, pgmq as $$
declare r record; n integer := 0;
begin
  for r in
    select distinct student_id from (
      select student_id from lesson_progress where updated_at > now() - interval '14 days'
      union select student_id from learning_paths where created_at > now() - interval '14 days' and status <> 'archived'
      union select student_id from chat_sessions where updated_at > now() - interval '14 days'
    ) a
  loop
    perform pgmq.send('agent_events', jsonb_build_object('kind', 'nightly_plan', 'student_id', r.student_id, 'payload', '{}'::jsonb));
    n := n + 1;
  end loop;
  perform public.agent_tick();
  return n;
end $$;
revoke all on function public.agent_nightly() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'agent-tick') then perform cron.unschedule('agent-tick'); end if;
  perform cron.schedule('agent-tick', '* * * * *', 'select public.agent_tick()');
  if exists (select 1 from cron.job where jobname = 'agent-embed') then perform cron.unschedule('agent-embed'); end if;
  perform cron.schedule('agent-embed', '* * * * *', 'select public.agent_embed_tick()');
  if exists (select 1 from cron.job where jobname = 'agent-nightly') then perform cron.unschedule('agent-nightly'); end if;
  perform cron.schedule('agent-nightly', '0 1 * * *', 'select public.agent_nightly()');
  -- Old model-usage buckets: keep two days.
  if exists (select 1 from cron.job where jobname = 'agent-usage-prune') then perform cron.unschedule('agent-usage-prune'); end if;
  perform cron.schedule('agent-usage-prune', '17 3 * * *', $c$delete from public.agent_model_usage where bucket < 'd:' || to_char(now() - interval '2 days', 'YYYY-MM-DD') and bucket like 'd:%' or (bucket like 'm:%' and bucket < 'm:' || to_char(now() - interval '1 day', 'YYYY-MM-DD'))$c$);
end $$;
