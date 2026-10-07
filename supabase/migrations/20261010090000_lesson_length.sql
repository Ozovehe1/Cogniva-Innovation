-- Lesson length: drafted sections are measured against their target play time and
-- lengthened (bounded) when they fall short. Idempotent: safe to re-run.
alter table lesson_sections add column if not exists expansions integer not null default 0;
alter table lesson_sections add column if not exists play_ms integer;
