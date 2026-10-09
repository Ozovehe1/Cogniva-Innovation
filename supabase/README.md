# supabase/

- `migrations/` — schema in date order (`YYYYMMDDhhmmss_name.sql`). Applied by hand to the "Cogniva Project" database,
  in order; every table that holds learner data has RLS with owner-only policies.
- `functions/embed` — Edge Function computing gte-small embeddings for `learner_memory` (RAG).
- Scheduled jobs: pg_cron `lesson-draft-tick` (every minute; its secret is in Supabase Vault). The Vercel cron calls
  `/api/cron/lesson-drafts` daily.
- Storage buckets: `manim-clips`, `lesson-audio`, `lesson-videos` (private), plus illustration caches.
