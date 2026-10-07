-- Class materials: tutors upload PDF / PPTX / DOCX files to a lesson. Text is extracted
-- on the server and can drive the lesson draft. Files live in a private bucket and are
-- only ever served through short-lived signed URLs. Idempotent: safe to re-run.

create table if not exists lesson_materials (
  id uuid primary key default gen_random_uuid(),
  lesson_id uuid not null references lessons(id) on delete cascade,
  tutor_id uuid not null references profiles(id) on delete cascade,
  file_name text not null,
  mime text not null,
  size bigint not null check (size > 0 and size <= 26214400),
  path text not null unique,
  extracted_text text,
  page_count integer,
  status text not null default 'uploading' check (status in ('uploading', 'reading', 'ready', 'failed')),
  error text,
  visible_to_students boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists lesson_materials_lesson_idx on lesson_materials(lesson_id, created_at);

drop trigger if exists lesson_materials_touch on lesson_materials;
create trigger lesson_materials_touch before update on lesson_materials for each row execute procedure touch_updated_at();

alter table lesson_materials enable row level security;

-- Tutors manage materials on their own lessons.
drop policy if exists "tutors_manage_own_materials" on lesson_materials;
create policy "tutors_manage_own_materials" on lesson_materials
  for all using (
    is_tutor() and tutor_id = get_my_profile_id()
    and exists (select 1 from lessons l where l.id = lesson_materials.lesson_id and l.tutor_id = get_my_profile_id())
  )
  with check (
    is_tutor() and tutor_id = get_my_profile_id()
    and exists (select 1 from lessons l where l.id = lesson_materials.lesson_id and l.tutor_id = get_my_profile_id())
  );

-- Students read shared, ready materials of approved lessons from a tutor they are linked to
-- (or platform lessons, which have no tutor).
drop policy if exists "students_read_visible_materials" on lesson_materials;
create policy "students_read_visible_materials" on lesson_materials
  for select using (
    visible_to_students and status = 'ready' and auth.uid() is not null
    and exists (
      select 1 from lessons l
      where l.id = lesson_materials.lesson_id and l.status = 'approved'
        and (
          l.tutor_id is null
          or exists (select 1 from tutor_students ts where ts.tutor_id = l.tutor_id and ts.student_id = get_my_profile_id())
        )
    )
  );

-- Lessons: style notes derived from the materials (used by drafting and the Manim prompt),
-- and whether the current draft should follow the materials.
alter table lessons add column if not exists style_notes jsonb;
alter table lessons add column if not exists draft_from_materials boolean not null default false;

-- Private bucket. No storage.objects policies: only the service role touches it, the API
-- checks lesson_materials (with RLS) before issuing signed upload / download URLs.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'lesson-materials', 'lesson-materials', false, 26214400,
  array[
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ]
)
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
