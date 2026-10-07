-- Lessons drafted as small beats (about 45-90 s each), each written by its own small model call.
-- lesson_sections rows are now beats: `chapter` groups them into the chapters learners see,
-- `kind` is demo / example / check / your_turn / wrap, `optional` beats are written only when the
-- lesson runs short, and `skipped` marks optional beats that were not needed. Idempotent.
alter table lesson_sections add column if not exists kind text;
alter table lesson_sections add column if not exists chapter text;
alter table lesson_sections add column if not exists optional boolean not null default false;
alter table lesson_sections add column if not exists seconds integer;
alter table lesson_sections drop constraint if exists lesson_sections_status_check;
alter table lesson_sections add constraint lesson_sections_status_check
  check (status in ('pending', 'drafting', 'ready', 'failed', 'skipped'));
