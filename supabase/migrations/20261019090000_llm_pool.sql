-- LLM pool: one shared budget + health ledger for every key × model slot (Groq and Gemini), used by
-- src/lib/agent/pool.ts from every server instance. Service role only (no RLS policies).
--
-- Slot ids: '<model>' for GROQ_API_KEY (kept from v1 so today's counters carry over), 'groq<n>:<model>'
-- for GROQ_API_KEY_n, 'gem<n>:<model>' for GEMINI_API_KEY / GEMINI_API_KEY_n. Per-learner fair-share
-- counters live in the same table under 'u:<student uuid>'.

-- ── Budget take with a provider day bucket (Gemini resets at midnight Pacific, Groq at UTC midnight),
--    a daily cap fraction (background work is paced against the reset) and optional per-learner caps. ──
create or replace function public.agent_budget_take(
  p_model text, p_tokens integer, p_rpm integer, p_rpd integer, p_tpm integer, p_tpd integer,
  p_day text, p_day_cap real default 1, p_user text default null, p_user_tpm integer default null, p_user_tpd integer default null
) returns boolean language plpgsql security definer set search_path = public as $$
declare
  mb text := 'm:' || to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI');
  db text := 'd:' || p_day;
  m agent_model_usage; d agent_model_usage; um agent_model_usage; ud agent_model_usage;
  uk text := case when p_user is null then null else 'u:' || p_user end;
  cap real := least(1, greatest(0, coalesce(p_day_cap, 1)));
begin
  insert into agent_model_usage(model, bucket) values (p_model, mb), (p_model, db) on conflict do nothing;
  select * into m from agent_model_usage where model = p_model and bucket = mb for update;
  select * into d from agent_model_usage where model = p_model and bucket = db for update;
  if m.requests + 1 > p_rpm or m.tokens + p_tokens > p_tpm
     or d.requests + 1 > floor(p_rpd * cap) or d.tokens + p_tokens > floor(p_tpd::real * cap) then
    return false;
  end if;
  if uk is not null then
    insert into agent_model_usage(model, bucket) values (uk, mb), (uk, 'd:' || to_char(now() at time zone 'utc', 'YYYY-MM-DD')) on conflict do nothing;
    select * into um from agent_model_usage where model = uk and bucket = mb for update;
    select * into ud from agent_model_usage where model = uk and bucket = 'd:' || to_char(now() at time zone 'utc', 'YYYY-MM-DD') for update;
    if (p_user_tpm is not null and um.tokens + p_tokens > p_user_tpm) or (p_user_tpd is not null and ud.tokens + p_tokens > p_user_tpd) then
      return false;
    end if;
    update agent_model_usage set requests = requests + 1, tokens = tokens + p_tokens where model = uk and bucket in (mb, 'd:' || to_char(now() at time zone 'utc', 'YYYY-MM-DD'));
  end if;
  update agent_model_usage set requests = requests + 1, tokens = tokens + p_tokens where model = p_model and bucket in (mb, db);
  return true;
end $$;
revoke all on function public.agent_budget_take(text, integer, integer, integer, integer, integer, text, real, text, integer, integer) from public, anon, authenticated;

-- Correct the estimate once real usage is known (cached prompt tokens do not count on Groq). p_req = -1 gives the
-- request back when the provider never served it (quota, invalid key, missing model).
drop function if exists public.agent_budget_adjust(text, integer, text, text);
create or replace function public.agent_budget_adjust(p_model text, p_delta integer, p_day text, p_user text default null, p_req integer default 0)
returns void language sql security definer set search_path = public as $$
  update agent_model_usage set tokens = greatest(0, tokens + p_delta), requests = greatest(0, requests + p_req)
  where (model = p_model and bucket in ('m:' || to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI'), 'd:' || p_day))
     or (p_user is not null and model = 'u:' || p_user and bucket in ('m:' || to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI'), 'd:' || to_char(now() at time zone 'utc', 'YYYY-MM-DD')));
$$;
revoke all on function public.agent_budget_adjust(text, integer, text, text, integer) from public, anon, authenticated;

-- ── Shared health per slot: 429 cooldowns, circuit breaker, rolling latency / error rate, token savings ──
create table if not exists llm_slot_health (
  slot text primary key,
  cooldown_until timestamptz,
  breaker_until timestamptz,
  consecutive_fail integer not null default 0,
  lat_ewma_ms real,
  err_ewma real not null default 0,
  ok_count bigint not null default 0,
  err_count bigint not null default 0,
  quota_count bigint not null default 0,
  tokens_in bigint not null default 0,
  tokens_out bigint not null default 0,
  tokens_cached bigint not null default 0,
  last_error text,
  last_ok_at timestamptz,
  updated_at timestamptz not null default now()
);
alter table llm_slot_health enable row level security;

-- p_kind: ok | quota | missing | overload (provider-wide 503, short rest) | error | timeout
create or replace function public.llm_slot_report(
  p_slot text, p_kind text, p_latency_ms integer default null, p_cooldown_ms integer default null,
  p_in integer default 0, p_out integer default 0, p_cached integer default 0, p_error text default null
) returns void language plpgsql security definer set search_path = public as $$
begin
  insert into llm_slot_health(slot) values (p_slot) on conflict do nothing;
  if p_kind = 'ok' then
    update llm_slot_health set consecutive_fail = 0, breaker_until = null, ok_count = ok_count + 1,
      lat_ewma_ms = case when lat_ewma_ms is null then p_latency_ms else lat_ewma_ms * 0.8 + coalesce(p_latency_ms, lat_ewma_ms) * 0.2 end,
      err_ewma = err_ewma * 0.9, tokens_in = tokens_in + coalesce(p_in, 0), tokens_out = tokens_out + coalesce(p_out, 0),
      tokens_cached = tokens_cached + coalesce(p_cached, 0), last_ok_at = now(), updated_at = now()
    where slot = p_slot;
  elsif p_kind in ('quota', 'missing', 'overload') then
    update llm_slot_health set quota_count = quota_count + case when p_kind = 'quota' then 1 else 0 end,
      cooldown_until = greatest(coalesce(cooldown_until, now()), now() + make_interval(secs => coalesce(p_cooldown_ms, 30000) / 1000.0)),
      last_error = left(p_error, 300), updated_at = now()
    where slot = p_slot;
  else
    update llm_slot_health set consecutive_fail = consecutive_fail + 1, err_count = err_count + 1,
      err_ewma = err_ewma * 0.9 + 0.1,
      lat_ewma_ms = case when p_kind = 'timeout' and p_latency_ms is not null then coalesce(lat_ewma_ms * 0.8 + p_latency_ms * 0.2, p_latency_ms) else lat_ewma_ms end,
      breaker_until = case when consecutive_fail + 1 >= 3 then now() + make_interval(secs => least(300, 30 * power(2, least(consecutive_fail + 1 - 3, 4)))) else breaker_until end,
      last_error = left(p_error, 300), updated_at = now()
    where slot = p_slot;
  end if;
end $$;
revoke all on function public.llm_slot_report(text, text, integer, integer, integer, integer, integer, text) from public, anon, authenticated;

-- Pool-wide daily counters for the dashboard (shed, deferred, trimmed, lighter model, busy, tokens saved).
create table if not exists llm_pool_counters (
  day text not null,
  key text not null,
  n bigint not null default 0,
  primary key (day, key)
);
alter table llm_pool_counters enable row level security;

create or replace function public.llm_pool_count(p_key text, p_n integer default 1)
returns void language sql security definer set search_path = public as $$
  insert into llm_pool_counters(day, key, n) values (to_char(now() at time zone 'utc', 'YYYY-MM-DD'), p_key, p_n)
  on conflict (day, key) do update set n = llm_pool_counters.n + excluded.n;
$$;
revoke all on function public.llm_pool_count(text, integer) from public, anon, authenticated;

-- One round trip for the router: current minute + provider-day usage and health for each slot.
create or replace function public.llm_pool_state(p_slots text[], p_days text[])
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'slot', s.slot,
    'm_req', coalesce(m.requests, 0), 'm_tok', coalesce(m.tokens, 0),
    'd_req', coalesce(d.requests, 0), 'd_tok', coalesce(d.tokens, 0),
    'cooldown_until', h.cooldown_until, 'breaker_until', h.breaker_until,
    'consecutive_fail', coalesce(h.consecutive_fail, 0), 'lat_ewma_ms', h.lat_ewma_ms, 'err_ewma', coalesce(h.err_ewma, 0),
    'ok_count', coalesce(h.ok_count, 0), 'err_count', coalesce(h.err_count, 0), 'quota_count', coalesce(h.quota_count, 0),
    'tokens_in', coalesce(h.tokens_in, 0), 'tokens_out', coalesce(h.tokens_out, 0), 'tokens_cached', coalesce(h.tokens_cached, 0),
    'last_error', h.last_error, 'last_ok_at', h.last_ok_at
  )), '[]'::jsonb)
  from unnest(p_slots, p_days) as s(slot, day)
  left join agent_model_usage m on m.model = s.slot and m.bucket = 'm:' || to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI')
  left join agent_model_usage d on d.model = s.slot and d.bucket = 'd:' || s.day
  left join llm_slot_health h on h.slot = s.slot;
$$;
revoke all on function public.llm_pool_state(text[], text[]) from public, anon, authenticated;

-- Old minute buckets are noise after an hour: prune them nightly.
do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule('llm-pool-prune') where exists (select 1 from cron.job where jobname = 'llm-pool-prune');
    perform cron.schedule('llm-pool-prune', '17 3 * * *', $c$delete from public.agent_model_usage where bucket like 'm:%' and bucket < 'm:' || to_char((now() - interval '2 hours') at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI')$c$);
  end if;
end $$;
