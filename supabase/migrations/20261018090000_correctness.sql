-- Correctness loop: learner mistake reports, an admin-triaged regression set, and a blocklist fed by confirmed reports.
-- Reports are the learner's own (owner-read under RLS); the server writes with the service role after checking the
-- session. Regression cases and the blocklist are anonymised and server-only (no learner ids, no learner notes).
-- Idempotent: safe to re-run.

create table if not exists mistake_reports (
  id uuid primary key default gen_random_uuid(),
  student_id uuid references profiles(id) on delete cascade,
  -- where the learner saw it
  surface text not null check (surface in ('lesson_step', 'stage', 'diagram', 'illustration', 'animation', 'ask', 'check', 'practice', 'mastery')),
  category text check (category in ('wrong_maths', 'wrong_picture', 'confusing', 'typo', 'other')),
  note text,
  -- the exact artefact: block JSON / step JSON / interactive spec / illustration id / query / clip job
  artefact jsonb not null default '{}'::jsonb,
  -- stable key of the artefact for this learner (e.g. chat:<session>:<block>, lesson:<id>:step:<n>, illus:<item id>)
  artefact_key text,
  lesson_id uuid references lessons(id) on delete set null,
  step_index integer,
  chat_session_id uuid,
  block_id text,
  illustration_id text,
  clip_job_id uuid,
  query text,
  model text,
  trace jsonb,
  -- what the guard said about this artefact when it was reported (deterministic re-check)
  guard jsonb,
  status text not null default 'open' check (status in ('open', 'confirmed', 'invalid')),
  triage_note text,
  triaged_at timestamptz,
  regression_case_id uuid,
  created_at timestamptz not null default now()
);
create index if not exists mistake_reports_status_idx on mistake_reports(status, created_at desc);
create index if not exists mistake_reports_student_idx on mistake_reports(student_id, created_at desc);
create index if not exists mistake_reports_lesson_idx on mistake_reports(lesson_id) where lesson_id is not null;
alter table mistake_reports enable row level security;
drop policy if exists own_mistake_reports on mistake_reports;
create policy own_mistake_reports on mistake_reports for select using (student_id = get_my_profile_id());

-- Regression set: seed cases live in code (src/lib/correctness/regression.ts); promoted reports live here, anonymised.
create table if not exists regression_cases (
  id uuid primary key default gen_random_uuid(),
  source text not null default 'report' check (source in ('seed', 'report', 'manual')),
  report_id uuid references mistake_reports(id) on delete set null,
  kind text not null,
  title text not null,
  input jsonb not null default '{}'::jsonb,
  expect jsonb not null default '{}'::jsonb,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists regression_cases_active_idx on regression_cases(active, created_at);
alter table regression_cases enable row level security;

-- Blocklist: illustration ids (for a topic or everywhere), prompt patterns the generators must avoid, clip specs.
create table if not exists correctness_blocklist (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('illustration', 'prompt_pattern', 'clip_spec')),
  value text not null,
  topic text not null default '',
  reason text,
  report_id uuid references mistake_reports(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (kind, value, topic)
);
alter table correctness_blocklist enable row level security;

-- Vision verdicts on library illustrations (public pictures, not learner content), so each item/topic pair is checked once.
create table if not exists illustration_verdicts (
  item_id text not null,
  topic text not null,
  ok boolean not null,
  confidence real,
  depicts text,
  model text,
  created_at timestamptz not null default now(),
  primary key (item_id, topic)
);
alter table illustration_verdicts enable row level security;

-- Animations: the render pipeline's deterministic verifier verdict ({ ok, failed: [...], checks: n }); a failed verdict blocks the clip.
alter table manim_jobs add column if not exists verdict jsonb;
