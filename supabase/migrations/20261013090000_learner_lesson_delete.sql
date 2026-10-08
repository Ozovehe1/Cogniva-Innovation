-- Learners can delete their own AI lessons. The app deletes through a server action that first
-- checks ownership with the learner's session; this policy lets the same delete run under RLS too.
-- Dependents: lesson_progress, lesson_sections, lesson_materials cascade; manim_jobs, path_topics
-- and learner_checkins are set null (the action also removes clip jobs and their storage objects,
-- and returns the path topic to a re-generatable state). Idempotent.
drop policy if exists "students_delete_own_lessons" on lessons;
create policy "students_delete_own_lessons" on lessons
  for delete using (owner_student_id is not null and owner_student_id = get_my_profile_id());
