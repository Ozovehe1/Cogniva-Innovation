-- AI-tutor-only GeniusMap: learner intake, adaptive prerequisite diagnostic,
-- learning paths with mastery checks, private short-lived mood check-ins,
-- and AI lessons owned by one student. Idempotent: safe to re-run.
-- No tables are dropped and no data is deleted (tutor/project/materials tables stay as they are).

-- ── Learner profile: the intake answers (one row per student) ──
create table if not exists learner_profiles (
  student_id uuid primary key references profiles(id) on delete cascade,
  -- Raw answers keyed by intake item id (skips and "not sure" kept as such).
  answers jsonb not null default '{}'::jsonb,
  current_item text,                       -- where the intake was left (resume)
  learner_status text,                     -- in_school | finished | break
  age_band text check (age_band is null or age_band in ('under13', '13to17', '18plus')),
  level text,                              -- e.g. 'SS2', 'University 300L'
  school_system text,
  last_studied text,
  goal_text text,                          -- open answer
  goal text,                               -- narrowed goal
  subject text,
  why_text text,
  value_type text,                         -- intrinsic | attainment | utility | mixed
  purpose text,                            -- curiosity | project | exam | career | helping
  deadline date,
  weekly_hours numeric,
  efficacy smallint check (efficacy is null or efficacy between 1 and 5),
  goal_orientation text check (goal_orientation is null or goal_orientation in ('mastery', 'performance_avoid')),
  anxiety jsonb,                           -- AMAS-style items {item: 1-5}; maths/science only
  example_pref text check (example_pref is null or example_pref in ('worked', 'try')),
  interests text[] not null default '{}',
  barriers text,
  guardian_email text,
  guardian_consent_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ── Mood / energy / confidence check-ins: private and short-lived (14 days) ──
create table if not exists learner_checkins (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references profiles(id) on delete cascade,
  context text not null default 'lesson' check (context in ('intake', 'lesson', 'mastery')),
  lesson_id uuid references lessons(id) on delete set null,
  mood smallint check (mood is null or mood between 1 and 5),
  energy smallint check (energy is null or energy between 1 and 5),
  confidence smallint check (confidence is null or confidence between 1 and 5),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '14 days'
);
create index if not exists learner_checkins_student_idx on learner_checkins(student_id, created_at desc);
create index if not exists learner_checkins_expiry_idx on learner_checkins(expires_at);

-- ── Learning paths: goal, prerequisite graph, diagnostic state ──
create table if not exists learning_paths (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references profiles(id) on delete cascade,
  goal text not null,
  subject text not null default '',
  status text not null default 'diagnosing' check (status in ('diagnosing', 'ready', 'archived')),
  -- { nodes: [{ id, title, summary, prereqs: [ids], level }], goalNode }
  graph jsonb not null default '{}'::jsonb,
  -- server-only item bank and answers; never sent to the client with answers
  diagnostic jsonb not null default '{}'::jsonb,
  known text[] not null default '{}',
  ready text[] not null default '{}',
  -- pacing/scope plan derived from the profile
  plan jsonb not null default '{}'::jsonb,
  rediagnosed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists learning_paths_student_idx on learning_paths(student_id, created_at desc);

create table if not exists path_topics (
  id uuid primary key default gen_random_uuid(),
  path_id uuid not null references learning_paths(id) on delete cascade,
  student_id uuid not null references profiles(id) on delete cascade,
  node_id text not null,
  position integer not null,
  title text not null,
  summary text not null default '',
  status text not null default 'locked' check (status in ('locked', 'ready', 'learning', 'mastered', 'review')),
  lesson_id uuid references lessons(id) on delete set null,
  target_minutes integer,
  due_on date,
  -- current mastery quiz (server-only answers) and attempts
  mastery jsonb not null default '{}'::jsonb,
  mastery_attempts integer not null default 0,
  wrong_streak integer not null default 0,
  mastered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (path_id, node_id)
);
create index if not exists path_topics_path_idx on path_topics(path_id, position);
create index if not exists path_topics_lesson_idx on path_topics(lesson_id);

-- ── AI lessons belong to one student; no tutor approval ──
alter table lessons add column if not exists owner_student_id uuid references profiles(id) on delete cascade;
alter table lessons add column if not exists generated_by text not null default 'tutor';
alter table lessons drop constraint if exists lessons_generated_by_check;
alter table lessons add constraint lessons_generated_by_check check (generated_by in ('tutor', 'ai', 'platform'));
create index if not exists lessons_owner_idx on lessons(owner_student_id);
alter table manim_jobs add column if not exists auto_insert boolean not null default false;

-- triggers
drop trigger if exists learner_profiles_touch on learner_profiles;
create trigger learner_profiles_touch before update on learner_profiles for each row execute procedure touch_updated_at();
drop trigger if exists learning_paths_touch on learning_paths;
create trigger learning_paths_touch before update on learning_paths for each row execute procedure touch_updated_at();
drop trigger if exists path_topics_touch on path_topics;
create trigger path_topics_touch before update on path_topics for each row execute procedure touch_updated_at();

-- ── RLS ──
alter table learner_profiles enable row level security;
alter table learner_checkins enable row level security;
alter table learning_paths enable row level security;
alter table path_topics enable row level security;

drop policy if exists "own_learner_profile" on learner_profiles;
create policy "own_learner_profile" on learner_profiles
  for all using (student_id = get_my_profile_id()) with check (student_id = get_my_profile_id());

-- Check-ins: only the student, only unexpired rows, never visible to anyone else.
drop policy if exists "own_checkins_insert" on learner_checkins;
create policy "own_checkins_insert" on learner_checkins
  for insert with check (student_id = get_my_profile_id());
drop policy if exists "own_checkins_select" on learner_checkins;
create policy "own_checkins_select" on learner_checkins
  for select using (student_id = get_my_profile_id() and expires_at > now());
drop policy if exists "own_checkins_delete" on learner_checkins;
create policy "own_checkins_delete" on learner_checkins
  for delete using (student_id = get_my_profile_id());

-- Paths and topics are read by the student; writes go through server routes
-- (service role) so diagnostic and mastery answers cannot be tampered with.
drop policy if exists "own_paths_select" on learning_paths;
create policy "own_paths_select" on learning_paths for select using (student_id = get_my_profile_id());
drop policy if exists "own_topics_select" on path_topics;
create policy "own_topics_select" on path_topics for select using (student_id = get_my_profile_id());

-- Lessons: shared lessons are readable when approved; a student's own AI lessons only by that student.
drop policy if exists "read_approved_lessons" on lessons;
create policy "read_approved_lessons" on lessons
  for select using (status = 'approved' and owner_student_id is null and auth.uid() is not null);
drop policy if exists "students_read_own_lessons" on lessons;
create policy "students_read_own_lessons" on lessons
  for select using (owner_student_id = get_my_profile_id());

-- Purge expired check-ins (called by the daily cron and opportunistically by the app).
create or replace function purge_expired_checkins()
returns integer language sql security definer set search_path = public as $$
  with d as (delete from learner_checkins where expires_at <= now() returning 1) select count(*)::int from d;
$$;
revoke all on function purge_expired_checkins() from public, anon, authenticated;

update lessons set generated_by = 'platform' where tutor_id is null and owner_student_id is null and generated_by = 'tutor';
