-- Unattended lesson drafting on the free plans: Vercel Hobby crons run only once a day, so a
-- Supabase pg_cron job checks every minute whether a lesson needs a drafting worker (its
-- hand-over did not land, its worker died, or its quota pause is over) and, only then, calls
-- /api/cron/lesson-drafts?tick=1 through pg_net. The bearer secret lives in Supabase Vault
-- under the name 'draft_tick_secret' (same value as the DRAFT_TICK_SECRET env var on Vercel);
-- create it once with: select vault.create_secret('<secret>', 'draft_tick_secret');
-- Idempotent.
create extension if not exists pg_cron;
create extension if not exists pg_net;

create or replace function public.draft_tick() returns void
language plpgsql security definer set search_path = public, extensions as $$
declare
  s text;
begin
  if not exists (
    select 1 from lessons
    where draft_status in ('outlining', 'drafting', 'paused')
      and created_at > now() - interval '2 days'
      and (draft_lock_until is null or draft_lock_until < now())
      and (draft_status <> 'paused' or draft_retry_at is null or draft_retry_at <= now())
  ) then
    return;
  end if;
  select decrypted_secret into s from vault.decrypted_secrets where name = 'draft_tick_secret' limit 1;
  if s is null then return; end if;
  perform net.http_get(
    url := 'https://cogniva-innovation.vercel.app/api/cron/lesson-drafts?tick=1',
    headers := jsonb_build_object('Authorization', 'Bearer ' || s),
    timeout_milliseconds := 10000
  );
end $$;
revoke all on function public.draft_tick() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'lesson-draft-tick') then
    perform cron.unschedule('lesson-draft-tick');
  end if;
  perform cron.schedule('lesson-draft-tick', '* * * * *', 'select public.draft_tick()');
end $$;
