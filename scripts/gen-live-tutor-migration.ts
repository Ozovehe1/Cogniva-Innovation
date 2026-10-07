// Regenerates supabase/migrations/20261007120000_live_tutor.sql from the schema below (no seed lessons: the sample lesson lives in code, src/lib/flagship-lesson.ts).
// Run: npx tsx scripts/gen-live-tutor-migration.ts
import { writeFileSync } from 'node:fs'

const q = (s: string) => `'${s.replace(/'/g, "''")}'`
const sql = `-- Live Tutor: lessons, progress, Manim render jobs, clip storage.
-- Idempotent: safe to re-run.

create or replace function is_tutor()
returns boolean language sql security definer set search_path = public stable as $$
  select exists (select 1 from profiles where user_id = auth.uid() and role = 'tutor');
$$;

create table if not exists lessons (
  id uuid primary key default gen_random_uuid(),
  tutor_id uuid references profiles(id) on delete cascade, -- null = platform sample lesson
  title text not null,
  subject text not null default '',
  objectives text[] not null default '{}',
  status text not null default 'draft' check (status in ('draft', 'approved')),
  script jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists lessons_tutor_idx on lessons(tutor_id);
create index if not exists lessons_status_idx on lessons(status);

create table if not exists lesson_progress (
  student_id uuid not null references profiles(id) on delete cascade,
  lesson_id uuid not null references lessons(id) on delete cascade,
  step_index integer not null default 0,
  events jsonb not null default '[]'::jsonb,
  completed_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (student_id, lesson_id)
);

create table if not exists manim_jobs (
  id uuid primary key default gen_random_uuid(),
  lesson_id uuid references lessons(id) on delete set null,
  requested_by uuid not null references profiles(id) on delete cascade,
  prompt text not null,
  code text,
  scene_name text not null default 'GeneratedScene',
  status text not null default 'queued' check (status in ('queued', 'rendering', 'done', 'failed', 'approved')),
  attempts integer not null default 0,
  video_path text,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists manim_jobs_lesson_idx on manim_jobs(lesson_id);
create index if not exists manim_jobs_requested_by_idx on manim_jobs(requested_by);

create or replace function touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

drop trigger if exists lessons_touch on lessons;
create trigger lessons_touch before update on lessons for each row execute procedure touch_updated_at();
drop trigger if exists lesson_progress_touch on lesson_progress;
create trigger lesson_progress_touch before update on lesson_progress for each row execute procedure touch_updated_at();
drop trigger if exists manim_jobs_touch on manim_jobs;
create trigger manim_jobs_touch before update on manim_jobs for each row execute procedure touch_updated_at();

alter table lessons enable row level security;
alter table lesson_progress enable row level security;
alter table manim_jobs enable row level security;

-- lessons: tutors manage their own; any signed-in user reads approved lessons.
drop policy if exists "tutors_manage_own_lessons" on lessons;
create policy "tutors_manage_own_lessons" on lessons
  for all using (tutor_id = get_my_profile_id() and is_tutor())
  with check (tutor_id = get_my_profile_id() and is_tutor());
drop policy if exists "read_approved_lessons" on lessons;
create policy "read_approved_lessons" on lessons
  for select using (status = 'approved' and auth.uid() is not null);

-- lesson_progress: students own theirs; tutors read progress on their lessons.
drop policy if exists "students_manage_own_progress" on lesson_progress;
create policy "students_manage_own_progress" on lesson_progress
  for all using (student_id = get_my_profile_id())
  with check (student_id = get_my_profile_id());
drop policy if exists "tutors_read_progress_on_their_lessons" on lesson_progress;
create policy "tutors_read_progress_on_their_lessons" on lesson_progress
  for select using (exists (select 1 from lessons l where l.id = lesson_progress.lesson_id and l.tutor_id = get_my_profile_id()));

-- manim_jobs: only tutors, only their own jobs. The render callback uses the service role.
drop policy if exists "tutors_manage_own_jobs" on manim_jobs;
create policy "tutors_manage_own_jobs" on manim_jobs
  for all using (requested_by = get_my_profile_id() and is_tutor())
  with check (requested_by = get_my_profile_id() and is_tutor());

-- Storage bucket for rendered clips (public read; writes only via service-role signed upload URLs).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('manim-clips', 'manim-clips', true, 104857600, array['video/mp4'])
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
`
writeFileSync(new URL('../supabase/migrations/20261007120000_live_tutor.sql', import.meta.url), sql)
console.log('wrote migration', sql.length, 'bytes')
