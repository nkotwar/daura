-- ════════════════════════════════════════════════════════════════════════════
--  Daura · database update for app version 2 (visit logging, verification, requests).
--  Run once in Supabase → SQL Editor → New query → paste → Run. Safe to re-run.
-- ════════════════════════════════════════════════════════════════════════════

-- Visit history of a place now carries each visit's id, so you can open the ones you are allowed to see.
drop function if exists public.entity_timeline(uuid);
create function public.entity_timeline(p_entity uuid)
returns table(id uuid, visit_no int, visited_at timestamptz, visitor_emp int, visitor text, branch text,
              outcome text, next_step text, followup_on date, status text, closure text, can_open boolean)
language sql stable security definer set search_path = public as $$
  select v.id, v.visit_no, v.visited_at, v.visitor, s.name, b.name, v.outcome, v.next_step, v.followup_on, v.status, v.closure,
         daura_private.can_see_visit(v.id, v.visitor, v.visitor_branch)
  from public.visits v join public.staff s on s.emp_id = v.visitor left join public.branches b on b.code = v.visitor_branch
  where daura_private.signed_in() and v.entity_id = p_entity
  order by v.visit_no
$$;

-- Admin: reopen a closed place (clears the closure on its latest visit) so follow-ups can continue.
create or replace function public.admin_reopen_place(p_entity uuid) returns void
language plpgsql security definer set search_path = public as $$
declare vid uuid;
begin
  if not daura_private.is_admin() then raise exception 'NOT_ALLOWED'; end if;
  select id into vid from public.visits where entity_id = p_entity order by visit_no desc limit 1;
  if vid is null then return; end if;
  perform set_config('daura.bypass', 'on', true);
  update public.visits set closure = null, closure_note = null where id = vid;
  perform set_config('daura.bypass', '', true);
  perform daura_private.log('place_reopened', p_entity::text, null);
end $$;

-- Names for the visit lists of branch heads, viewers and admin (who can see other people's visits).
create or replace function public.visit_people(p_emps int[]) returns table(emp_id int, name text, branch text, is_branch_head boolean, is_ro boolean, phone text)
language sql stable security definer set search_path = public as $$
  select s.emp_id, s.name, b.name, s.is_branch_head, coalesce(b.is_ro, false),
         case when daura_private.is_viewer() or daura_private.is_bh() then s.phone end
  from public.staff s left join public.branches b on b.code = s.branch_code
  where daura_private.signed_in() and s.emp_id = any(p_emps)
$$;

revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;
grant execute on function public.ping() to anon;

select 'Daura database is up to date for version 2' as status;
