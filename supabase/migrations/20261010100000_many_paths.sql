-- Many paths per learner: each path keeps the intake answers it was planned from,
-- so a later intake for another goal adds a path and never changes an existing one.
alter table learning_paths add column if not exists learner_snapshot jsonb;
