-- When the owner's lesson page last polled drafting status: a watched lesson drafts at Ask priority.
alter table public.lessons add column if not exists watched_at timestamptz;
