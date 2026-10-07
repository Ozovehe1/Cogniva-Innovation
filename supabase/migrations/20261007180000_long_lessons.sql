-- Long lessons: sections drafted one at a time in the background, chapter index
-- for the player, and resumable student progress. Idempotent: safe to re-run.

-- Lessons: target length, chapter index of the flattened script, drafting job state.
alter table lessons add column if not exists target_minutes integer;
alter table lessons drop constraint if exists lessons_target_minutes_check;
alter table lessons add constraint lessons_target_minutes_check check (target_minutes is null or target_minutes between 5 and 180);
-- [{ "title", "start", "count", "ms" }] describing sections of lessons.script (start = index of the section's first step).
alter table lessons add column if not exists chapters jsonb not null default '[]'::jsonb;
alter table lessons add column if not exists draft_status text not null default 'idle';
alter table lessons drop constraint if exists lessons_draft_status_check;
alter table lessons add constraint lessons_draft_status_check
  check (draft_status in ('idle', 'outlining', 'drafting', 'paused', 'ready', 'partial', 'failed'));
alter table lessons add column if not exists draft_error text;
alter table lessons add column if not exists draft_notes text;
alter table lessons add column if not exists draft_retry_at timestamptz;
-- Lease held by the background worker drafting this lesson (one worker per lesson).
alter table lessons add column if not exists draft_lock_until timestamptz;
create index if not exists lessons_draft_status_idx on lessons(draft_status) where draft_status in ('outlining', 'drafting', 'paused');

-- Backfill a single chapter for existing flat lessons.
update lessons
set chapters = jsonb_build_array(jsonb_build_object('title', title, 'start', 0, 'count', jsonb_array_length(script)))
where chapters = '[]'::jsonb and jsonb_typeof(script) = 'array' and jsonb_array_length(script) > 0;

-- Sections of a long lesson (tutor-only; students read the flattened lessons.script).
create table if not exists lesson_sections (
  id uuid primary key default gen_random_uuid(),
  lesson_id uuid not null references lessons(id) on delete cascade,
  position integer not null,
  title text not null,
  goal text not null default '',
  key_points text[] not null default '{}',
  minutes numeric not null default 8,
  status text not null default 'pending' check (status in ('pending', 'drafting', 'ready', 'failed')),
  steps jsonb not null default '[]'::jsonb,
  notes text,
  error text,
  attempts integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists lesson_sections_lesson_idx on lesson_sections(lesson_id, position);

drop trigger if exists lesson_sections_touch on lesson_sections;
create trigger lesson_sections_touch before update on lesson_sections for each row execute procedure touch_updated_at();

alter table lesson_sections enable row level security;
drop policy if exists "tutors_manage_own_lesson_sections" on lesson_sections;
create policy "tutors_manage_own_lesson_sections" on lesson_sections
  for all using (is_tutor() and exists (select 1 from lessons l where l.id = lesson_sections.lesson_id and l.tutor_id = get_my_profile_id()))
  with check (is_tutor() and exists (select 1 from lessons l where l.id = lesson_sections.lesson_id and l.tutor_id = get_my_profile_id()));

-- Progress: where exactly the student is, their check answers, and how far they got.
alter table lesson_progress add column if not exists section_index integer not null default 0;
alter table lesson_progress add column if not exists answers jsonb not null default '{}'::jsonb;
alter table lesson_progress add column if not exists furthest_index integer not null default 0;
-- Length of the script the position refers to; a different length means the lesson changed since.
alter table lesson_progress add column if not exists script_steps integer;
