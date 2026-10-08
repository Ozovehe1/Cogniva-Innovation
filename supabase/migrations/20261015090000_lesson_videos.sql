-- Lesson videos: an MP4 of a lesson as it plays (boards drawn by the hand, narration, clips, maths), rendered on
-- demand when a learner taps Download -> Video (.mp4). One row per lesson + script hash: a finished row is the cache
-- (served again with no re-render while the script is unchanged); an active row de-duplicates repeated taps.
-- Rows are written only by the server (service role) after it has checked the learner may open the lesson with their
-- own session, so RLS is on with no policies. Files live in the private lesson-videos bucket at
-- <lesson_id>/<script_hash>.mp4 and are handed out as short-lived signed links. Idempotent.
create table if not exists lesson_videos (
  id uuid primary key default gen_random_uuid(),
  lesson_id uuid not null references lessons(id) on delete cascade,
  script_hash text not null,
  status text not null default 'queued' check (status in ('queued', 'preparing', 'rendering', 'done', 'failed')),
  requested_by uuid references profiles(id) on delete set null,
  storage_path text,
  bytes bigint,
  duration_ms integer,
  est_ms integer,
  progress real not null default 0,
  call_id text,
  error text,
  meta jsonb,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (lesson_id, script_hash)
);
create index if not exists lesson_videos_requested_by_idx on lesson_videos (requested_by, created_at desc);
alter table lesson_videos enable row level security;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('lesson-videos', 'lesson-videos', false, 52428800, array['video/mp4'])
on conflict (id) do update set public = false, file_size_limit = 52428800, allowed_mime_types = array['video/mp4'];
