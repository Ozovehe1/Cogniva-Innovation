-- Narration voice (Kokoro TTS): cached audio per narration line, per-user usage for rate limits,
-- and the narration a Manim clip is timed to. Idempotent: safe to re-run.

-- Public bucket: <voice>/<key>.mp3 (audio) and <voice>/<key>.json (word timings).
-- Writes only through the service role (server routes).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('lesson-audio', 'lesson-audio', true, 5242880, array['audio/mpeg', 'application/json'])
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- One row per synthesized line. key = sha256(engine|voice|speed|text), so unchanged lines are reused.
create table if not exists narration_audio (
  key text primary key,
  voice text not null,
  text text not null,
  audio_path text not null,
  ms integer not null,
  words jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);
alter table narration_audio enable row level security;

-- On-demand synthesis log (cache misses only), for per-user rate limits.
create table if not exists tts_usage (
  id bigserial primary key,
  profile_id uuid not null references profiles(id) on delete cascade,
  lines integer not null default 1,
  chars integer not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists tts_usage_profile_time_idx on tts_usage(profile_id, created_at desc);
alter table tts_usage enable row level security;

-- Narration a Manim clip is timed to (spoken over the clip in the lesson).
alter table manim_jobs add column if not exists narration text;
