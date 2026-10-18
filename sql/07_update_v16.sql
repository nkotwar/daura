-- ════════════════════════════════════════════════════════════════════════════
--  TASC Connect · database update for app version 16: every new visit is now recorded in Activity too.
--  Run once in Supabase → SQL Editor → New query → paste → Run. Safe to re-run.
-- ════════════════════════════════════════════════════════════════════════════

-- Every new visit is recorded in Activity (so it can show there and notify)
create or replace function daura_private.visit_logged() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform daura_private.log('visit_logged', new.id::text,
    jsonb_build_object('entity', (select name from public.entities where id = new.entity_id), 'visit_no', new.visit_no));
  return null;
end $$;
drop trigger if exists t_visit_logged on public.visits;
create trigger t_visit_logged after insert on public.visits for each row execute function daura_private.visit_logged();

select 'TASC Connect database is up to date for version 16' as status;
