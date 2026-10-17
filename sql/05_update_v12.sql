-- ════════════════════════════════════════════════════════════════════════════
--  Daura · database update for app version 12: places visited by someone other than the allottee.
--  If a place allotted to A is visited by B, A's allotment counts as covered ("Visited by B"),
--  and everyone sees who visited it. Run once in Supabase → SQL Editor → New query → paste → Run. Safe to re-run.
-- ════════════════════════════════════════════════════════════════════════════

-- Who a place is allotted to, and whether it has been visited: by the allottee against the allotment,
-- or by anyone else. Shows the first such visit's visitor. No phone numbers.
drop function if exists public.entity_assignees(uuid);
create function public.entity_assignees(p_entity uuid)
returns table(assignment_id uuid, emp_id int, name text, designation text, branch text, scheduled_on date,
              visited boolean, verified boolean, on_hold boolean, visited_by_emp int, visited_by text, visited_at timestamptz)
language sql stable security definer set search_path = public as $$
  select a.id, a.assignee, s.name, s.designation, b.name, a.scheduled_on,
         fv.id is not null, coalesce(fv.status = 'verified', false),
         exists (select 1 from public.requests r where r.assignment_id = a.id and r.status = 'pending'),
         fv.visitor, vs.name, fv.visited_at
  from public.assignments a
  join public.staff s on s.emp_id = a.assignee
  left join public.branches b on b.code = s.branch_code
  left join lateral (
    select v.* from public.visits v
    where v.assignment_id = a.id or (v.entity_id = a.entity_id and v.visitor <> a.assignee)
    order by (v.assignment_id = a.id) desc nulls last, v.visit_no
    limit 1) fv on true
  left join public.staff vs on vs.emp_id = fv.visitor
  where daura_private.signed_in() and a.entity_id = p_entity and a.status = 'open'
  order by a.scheduled_on
$$;

-- My open allotments that someone else has already visited (and I have not logged myself).
create or replace function public.my_allotment_cover()
returns table(assignment_id uuid, visit_id uuid, visitor_emp int, visitor text, visited_at timestamptz, status text)
language sql stable security definer set search_path = public as $$
  select a.id, fv.id, fv.visitor, s.name, fv.visited_at, fv.status
  from public.assignments a
  join lateral (
    select v.* from public.visits v
    where v.entity_id = a.entity_id and v.visitor <> a.assignee
    order by v.visit_no limit 1) fv on true
  join public.staff s on s.emp_id = fv.visitor
  where a.assignee = daura_private.my_emp() and a.status = 'open'
    and not exists (select 1 from public.visits mv where mv.assignment_id = a.id)
$$;

revoke execute on function public.entity_assignees(uuid) from public, anon;
grant execute on function public.entity_assignees(uuid) to authenticated;
revoke execute on function public.my_allotment_cover() from public, anon;
grant execute on function public.my_allotment_cover() to authenticated;

select 'Daura database is up to date for version 12' as status;
