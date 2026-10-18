-- ════════════════════════════════════════════════════════════════════════════
--  TASC Connect · database update for app version 41: a read-only People list for viewers.
--  Shows who has signed up and their role. No dates of birth, no Gmails, no changes.
--  Run once in Supabase → SQL Editor → New query → paste → Run. Safe to re-run.
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.viewer_people() returns table(
  emp_id int, name text, designation text, branch_code int, branch text, phone text,
  role text, is_branch_head boolean, active boolean, signins int, last_seen timestamptz)
language sql stable security definer set search_path = public as $$
  select s.emp_id, s.name, s.designation, s.branch_code, b.name, s.phone, s.role, s.is_branch_head, s.active,
         (select count(*)::int from public.staff_logins l where l.emp_id = s.emp_id),
         (select max(l.last_seen) from public.staff_logins l where l.emp_id = s.emp_id)
  from public.staff s left join public.branches b on b.code = s.branch_code
  where daura_private.is_viewer() and s.active and not s.blocked
  order by b.name, s.name
$$;
revoke execute on function public.viewer_people() from public, anon;
grant execute on function public.viewer_people() to authenticated;

select 'TASC Connect database is up to date for version 41' as status;
