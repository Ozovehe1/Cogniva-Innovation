-- Pooled calibration of item writers' difficulty tags (docs/design/assessment.md §8).
-- Statistics only: key = subject|bloom|tag, never item text or learner data. Service role only.
create table if not exists assessment_calibration (
  key text primary key,
  offset_logit double precision not null default 0,
  n integer not null default 0,
  updated_at timestamptz not null default now()
);
alter table assessment_calibration enable row level security;
