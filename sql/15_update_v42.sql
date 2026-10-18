-- ════════════════════════════════════════════════════════════════════════════
--  TASC Connect · database update for app version 42
--  · Staff who add a place get it allotted to themselves (with a visit date).
--  · The person who added a place can delete it, as long as no visit report exists for it
--    and it isn't allotted to someone else. (The admin can delete any place.)
--  Run once in Supabase → SQL Editor → New query → paste → Run. Safe to re-run.
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.self_allot(p_entity uuid, p_date date) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me int := daura_private.my_emp(); e public.entities; a public.assignments;
begin
  if me is null then raise exception 'NOT_LINKED'; end if;
  select * into e from public.entities where id = p_entity;
  if not found then raise exception 'NOT_FOUND'; end if;
  if e.created_by is distinct from me then raise exception 'NOT_ALLOWED' using hint = 'Only places you added can be allotted to yourself.'; end if;
  if exists (select 1 from public.assignments where entity_id = p_entity and status = 'open') then
    raise exception 'ALREADY_ALLOTTED' using hint = 'This place is already allotted.';
  end if;
  insert into public.assignments(entity_id, assignee, scheduled_on, campaign_id, assigned_by)
  values (p_entity, me, coalesce(p_date, current_date), (select max(id) from public.campaigns), daura_private.my_gmail())
  returning * into a;
  insert into public.assignment_history(assignment_id, from_emp, to_emp, by_gmail, reason) values (a.id, null, me, daura_private.my_gmail(), 'added the place');
  perform daura_private.log('allotted', me::text, jsonb_build_object('entity', e.name, 'on', a.scheduled_on, 'self', true));
  return jsonb_build_object('id', a.id, 'entity_id', a.entity_id, 'assignee', a.assignee, 'scheduled_on', a.scheduled_on,
    'status', a.status, 'campaign_id', a.campaign_id, 'note', a.note);
end $$;

create or replace function public.delete_my_place(p_entity uuid) returns void
language plpgsql security definer set search_path = public as $$
declare me int := daura_private.my_emp(); e public.entities;
begin
  if me is null then raise exception 'NOT_LINKED'; end if;
  select * into e from public.entities where id = p_entity;
  if not found then raise exception 'NOT_FOUND'; end if;
  if e.created_by is distinct from me then raise exception 'NOT_ALLOWED' using hint = 'Only the person who added this place, or the admin, can delete it.'; end if;
  if exists (select 1 from public.visits where entity_id = p_entity) then
    raise exception 'HAS_VISITS' using hint = 'A visit report exists for this place. Delete the visit report first.';
  end if;
  if exists (select 1 from public.assignments where entity_id = p_entity and assignee <> me) then
    raise exception 'NOT_ALLOWED' using hint = 'This place is now allotted to someone else. Ask the admin.';
  end if;
  delete from public.entities where id = p_entity;   -- its allotment goes with it
  perform daura_private.log('place_deleted', null, jsonb_build_object('entity', e.name, 'type', e.type, 'visits', 0, 'by', 'self'));
end $$;

revoke execute on function public.self_allot(uuid, date) from public, anon;
revoke execute on function public.delete_my_place(uuid) from public, anon;
grant execute on function public.self_allot(uuid, date) to authenticated;
grant execute on function public.delete_my_place(uuid) to authenticated;

select 'TASC Connect database is up to date for version 42' as status;
