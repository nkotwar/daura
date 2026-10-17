-- ════════════════════════════════════════════════════════════════════════════
--  Daura · database update for app version 11.
--  1. Who a place is allotted to (shown on every place's page).
--  2. Allotments with a pending request are locked: one request at a time, no visit logged until the admin decides.
--  Run once in Supabase → SQL Editor → New query → paste → Run. Safe to re-run.
-- ════════════════════════════════════════════════════════════════════════════

-- 1. Who a place is allotted to (name, branch, due date, visited / verified / on hold). No phone numbers.
drop function if exists public.entity_assignees(uuid);
create function public.entity_assignees(p_entity uuid)
returns table(assignment_id uuid, emp_id int, name text, designation text, branch text, scheduled_on date,
              visited boolean, verified boolean, on_hold boolean)
language sql stable security definer set search_path = public as $$
  select a.id, a.assignee, s.name, s.designation, b.name, a.scheduled_on,
         exists (select 1 from public.visits v where v.assignment_id = a.id),
         exists (select 1 from public.visits v where v.assignment_id = a.id and v.status = 'verified'),
         exists (select 1 from public.requests r where r.assignment_id = a.id and r.status = 'pending')
  from public.assignments a
  join public.staff s on s.emp_id = a.assignee
  left join public.branches b on b.code = s.branch_code
  where daura_private.signed_in() and a.entity_id = p_entity and a.status = 'open'
  order by a.scheduled_on
$$;

-- 2a. One pending request per allotment (reassign OR remove) and per visit (delete OR unverify).
create or replace function public.raise_request(p_kind text, p_visit uuid, p_assignment uuid, p_reason text) returns uuid
language plpgsql security definer set search_path = public as $$
declare me int := daura_private.my_emp(); rid uuid;
begin
  if me is null then raise exception 'NOT_LINKED'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'REASON_REQUIRED'; end if;
  if p_kind in ('delete_visit','unverify') and not exists (select 1 from public.visits where id = p_visit and visitor = me) then raise exception 'NOT_ALLOWED'; end if;
  if p_kind in ('delete_assignment','reassign') and not exists (select 1 from public.assignments where id = p_assignment and assignee = me and status = 'open') then raise exception 'NOT_ALLOWED'; end if;
  if exists (select 1 from public.requests where status = 'pending'
             and ((p_assignment is not null and assignment_id = p_assignment) or (p_visit is not null and visit_id = p_visit))) then
    raise exception 'ALREADY_REQUESTED' using hint = 'A request for this is already waiting with the admin.';
  end if;
  insert into public.requests(kind, visit_id, assignment_id, raised_by, reason) values (p_kind, p_visit, p_assignment, me, trim(p_reason)) returning id into rid;
  perform daura_private.log('request_raised', rid::text, jsonb_build_object('kind', p_kind));
  return rid;
end $$;

-- 2b. No visit can be logged against an allotment while a request about it is pending (admin excepted).
create or replace function daura_private.visit_hold() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.assignment_id is not null and not daura_private.is_admin()
     and exists (select 1 from public.requests r where r.assignment_id = new.assignment_id and r.status = 'pending'
                 and r.kind in ('reassign','delete_assignment')) then
    raise exception 'ALLOTMENT_ON_HOLD' using hint = 'Your request about this allotment is waiting for the admin. You can log it once the admin decides.';
  end if;
  return new;
end $$;
drop trigger if exists t_visit_hold on public.visits;
create trigger t_visit_hold before insert on public.visits for each row execute function daura_private.visit_hold();

revoke execute on function public.entity_assignees(uuid) from public, anon;
grant execute on function public.entity_assignees(uuid) to authenticated;
revoke execute on function public.raise_request(text, uuid, uuid, text) from public, anon;
grant execute on function public.raise_request(text, uuid, uuid, text) to authenticated;

select 'Daura database is up to date for version 11' as status;
