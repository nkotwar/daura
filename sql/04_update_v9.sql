-- ════════════════════════════════════════════════════════════════════════════
--  Daura · database update for app version 9: show who a place is allotted to.
--  Run once in Supabase → SQL Editor → New query → paste → Run. Safe to re-run.
-- ════════════════════════════════════════════════════════════════════════════

-- Who a place is allotted to (name, branch, due date, whether visited). Any signed-in staff can see this,
-- the same way they already see who visited a place. No phone numbers or other personal details.
create or replace function public.entity_assignees(p_entity uuid)
returns table(assignment_id uuid, emp_id int, name text, designation text, branch text, scheduled_on date, visited boolean, verified boolean)
language sql stable security definer set search_path = public as $$
  select a.id, a.assignee, s.name, s.designation, b.name, a.scheduled_on,
         exists (select 1 from public.visits v where v.assignment_id = a.id),
         exists (select 1 from public.visits v where v.assignment_id = a.id and v.status = 'verified')
  from public.assignments a
  join public.staff s on s.emp_id = a.assignee
  left join public.branches b on b.code = s.branch_code
  where daura_private.signed_in() and a.entity_id = p_entity and a.status = 'open'
  order by a.scheduled_on
$$;

revoke execute on function public.entity_assignees(uuid) from public, anon;
grant execute on function public.entity_assignees(uuid) to authenticated;

select 'Daura database is up to date for version 9' as status;
