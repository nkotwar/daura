-- ════════════════════════════════════════════════════════════════════════════
--  TASC Connect · database update for app version 31: only the admin verifies visits.
--  (Branch heads now see their branch's visits in "My Staff Visits" instead. Visits they already verified stay verified.)
--  Run once in Supabase → SQL Editor → New query → paste → Run. Safe to re-run.
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.verify_visit(p_visit uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v public.visits;
begin
  if not daura_private.is_admin() then raise exception 'NOT_ALLOWED' using hint = 'Only the Regional Office (admin) can verify visits.'; end if;
  select * into v from public.visits where id = p_visit;
  if not found then raise exception 'NOT_FOUND'; end if;
  perform set_config('daura.bypass', 'on', true);
  update public.visits set status = 'verified', verified_by = daura_private.my_emp(), verified_by_gmail = daura_private.my_gmail(), verified_at = now() where id = p_visit;
  perform set_config('daura.bypass', '', true);
  perform daura_private.log('visit_verified', p_visit::text, null);
end $$;

select 'TASC Connect database is up to date for version 31' as status;
