-- Zero wait for a new learner's first lesson: while the adaptive diagnostic is still running, the
-- likely starting topic's lesson is planned and drafted ahead (an AI lesson row not yet attached to
-- any path topic, so the learner never sees it). learning_paths.speculation tracks it:
--   { lessonId, nodeId, at, asked, tries, lastPrediction, stableFor, discarded: [nodeId...],
--     outcome: 'reused' | 'discarded' | 'none', outcomeAt }
-- On finish the draft is attached to the first topic when the start topic matches, otherwise deleted.
-- Idempotent.
alter table public.learning_paths add column if not exists speculation jsonb;
