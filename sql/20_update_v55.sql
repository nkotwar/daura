-- ════════════════════════════════════════════════════════════════════════════
--  TASC Connect · database update for app version 55: the admin can mark a place as a duplicate.
--  A duplicate keeps everything (allotment, visit reports, photos); the app just leaves it out of every list
--  and count except Places → Duplicates. Unmarking brings it all back as it was.
--  While a place is a duplicate, nobody can add a visit report to it or allot it.
--  Older app versions keep working; they show the duplicate as a normal place until updated.
--  Run once in Supabase → SQL Editor → New query → paste → Run. Safe to re-run.
-- ════════════════════════════════════════════════════════════════════════════

alter table public.entities add column if not exists is_duplicate boolean not null default false;
alter table public.entities add column if not exists duplicate_note text;
alter table public.entities add column if not exists duplicate_by text;
alter table public.entities add column if not exists duplicate_at timestamptz;

-- Only the admin (through the function below) changes the duplicate mark
create or replace function daura_private.entity_dup_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if daura_private.bypass() then return new; end if;
  if tg_op = 'INSERT' then
    new.is_duplicate := false; new.duplicate_note := null; new.duplicate_by := null; new.duplicate_at := null;
  else
    new.is_duplicate := old.is_duplicate; new.duplicate_note := old.duplicate_note; new.duplicate_by := old.duplicate_by; new.duplicate_at := old.duplicate_at;
  end if;
  return new;
end $$;
drop trigger if exists t_entity_dup_guard on public.entities;
create trigger t_entity_dup_guard before insert or update on public.entities for each row execute function daura_private.entity_dup_guard();

-- Mark / unmark (admin)
create or replace function public.admin_set_duplicate(p_entity uuid, p_dup boolean, p_note text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare e public.entities;
begin
  if not daura_private.is_admin() then raise exception 'NOT_ALLOWED'; end if;
  perform set_config('daura.bypass', 'on', true);
  update public.entities set is_duplicate = p_dup,
         duplicate_note = case when p_dup then nullif(trim(coalesce(p_note, '')), '') end,
         duplicate_by = case when p_dup then daura_private.my_gmail() end,
         duplicate_at = case when p_dup then now() end
   where id = p_entity returning * into e;
  perform set_config('daura.bypass', '', true);
  if not found then raise exception 'NOT_FOUND'; end if;
  perform daura_private.log(case when p_dup then 'place_duplicate' else 'place_not_duplicate' end, e.id::text,
    jsonb_build_object('entity', e.name, 'note', e.duplicate_note));
  return jsonb_build_object('is_duplicate', e.is_duplicate, 'duplicate_note', e.duplicate_note, 'duplicate_at', e.duplicate_at);
end $$;
revoke execute on function public.admin_set_duplicate(uuid, boolean, text) from public, anon;
grant execute on function public.admin_set_duplicate(uuid, boolean, text) to authenticated;

-- No new visit reports on a duplicate (edits to existing reports still work)
create or replace function daura_private.visit_not_duplicate() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from public.entities where id = new.entity_id and is_duplicate) then
    raise exception 'PLACE_DUPLICATE' using hint = 'This place is marked as a duplicate. Please submit your report on the original place.';
  end if;
  return new;
end $$;
drop trigger if exists t_visit_not_duplicate on public.visits;
create trigger t_visit_not_duplicate before insert on public.visits for each row execute function daura_private.visit_not_duplicate();

-- No allotting, reallotting or self-allotting a duplicate (cancelling still works)
create or replace function daura_private.asg_not_duplicate() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'open' and (tg_op = 'INSERT' or new.assignee is distinct from old.assignee or new.scheduled_on is distinct from old.scheduled_on
                              or old.status <> 'open' or new.entity_id is distinct from old.entity_id)
     and exists (select 1 from public.entities where id = new.entity_id and is_duplicate) then
    raise exception 'PLACE_DUPLICATE' using hint = 'This place is marked as a duplicate, so it cannot be allotted. Unmark it first, or allot the original place.';
  end if;
  return new;
end $$;
drop trigger if exists t_asg_not_duplicate on public.assignments;
create trigger t_asg_not_duplicate before insert or update on public.assignments for each row execute function daura_private.asg_not_duplicate();

-- sync(): also sends the duplicate mark
create or replace function public.sync(p_since timestamptz default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  who jsonb := public.whoami();
  me int := daura_private.my_emp();
  adm boolean := daura_private.is_admin();
  vw boolean := daura_private.is_viewer();
  bh boolean := daura_private.is_bh();
  mybr int := daura_private.my_branch();
  s timestamptz := coalesce(p_since, '-infinity'::timestamptz);
  out jsonb;
begin
  if not daura_private.signed_in() then
    return jsonb_build_object('now', now(), 'who', who);
  end if;
  select jsonb_build_object(
    'now', now(),
    'who', who,
    'full', p_since is null,
    'branches', coalesce((select jsonb_agg(jsonb_build_object('code', b.code, 'name', b.name, 'is_ro', b.is_ro, 'active', b.active))
                 from public.branches b where b.updated_at > s), '[]'),
    'staff', coalesce((select jsonb_agg(jsonb_build_object('emp_id', x.emp_id, 'name', x.name, 'designation', x.designation,
                 'branch_code', x.branch_code, 'is_branch_head', x.is_branch_head, 'active', x.active,
                 'phone', case when vw or (bh and x.branch_code = mybr) then x.phone end))
                 from public.staff x where x.updated_at > s), '[]'),
    'settings', coalesce((select jsonb_object_agg(k.key, k.value) from public.settings k where k.updated_at > s), '{}'),
    'campaigns', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'starts_on', c.starts_on, 'ends_on', c.ends_on))
                 from public.campaigns c where c.updated_at > s), '[]'),
    'entities', coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'name', e.name, 'type', e.type, 'area', e.area, 'address', e.address,
                 'contact', e.contact, 'contact_person', e.contact_person, 'lat', e.lat, 'lng', e.lng, 'closure', e.closure, 'created_by', e.created_by,
                 'is_duplicate', e.is_duplicate, 'duplicate_note', e.duplicate_note, 'duplicate_at', e.duplicate_at))
                 from public.entities e where e.updated_at > s), '[]'),
    -- allotments: everyone sees all of them (who is allotted where is already shown on every place)
    'assignments', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'entity_id', a.entity_id, 'assignee', a.assignee,
                 'scheduled_on', a.scheduled_on, 'status', a.status, 'campaign_id', a.campaign_id, 'note', a.note))
                 from public.assignments a where a.updated_at > s), '[]'),
    -- visits: a short summary of every visit for everyone (as the place page shows); full details only where allowed
    'visits', coalesce((select jsonb_agg(
                 jsonb_build_object('id', v.id, 'entity_id', v.entity_id, 'assignment_id', v.assignment_id, 'visit_no', v.visit_no,
                   'visitor', v.visitor, 'visitor_branch', v.visitor_branch, 'visited_at', v.visited_at, 'status', v.status,
                   'outcome', v.outcome, 'next_step', v.next_step, 'followup_on', v.followup_on, 'closure', v.closure,
                   'verified_at', v.verified_at)
                 || case when (vw or v.visitor = me or (bh and v.visitor_branch = mybr) or exists (select 1 from public.visit_joint j where j.visit_id = v.id and j.emp_id = me)) then
                   jsonb_build_object('f', true, 'logged_at', v.logged_at, 'lat', v.lat, 'lng', v.lng, 'accuracy_m', v.accuracy_m,
                   'loc_source', v.loc_source, 'person_name', v.person_name, 'person_designation', v.person_designation,
                   'person_mobile', v.person_mobile, 'banking_with', v.banking_with, 'other_bank', v.other_bank,
                   'headcount', v.headcount, 'headcount_kind', v.headcount_kind, 'potential_rs', v.potential_rs,
                   'products', v.products, 'remarks', v.remarks, 'closure_note', v.closure_note, 'mobilised_rs', v.mobilised_rs,
                   'account_numbers', v.account_numbers, 'verified_by', v.verified_by, 'created_by_admin', v.created_by_admin,
                   'return_note', v.return_note, 'returned_at', v.returned_at, 'resubmitted_at', v.resubmitted_at)
                 else '{}'::jsonb end)
                 from public.visits v where v.updated_at > s), '[]'),
    'photos', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'visit_id', p.visit_id, 'path', p.path, 'source', p.source,
                 'taken_at', p.taken_at, 'lat', p.lat, 'lng', p.lng, 'created_at', p.created_at))
                 from public.visit_photos p join public.visits v on v.id = p.visit_id
                 where p.updated_at > s and (vw or v.visitor = me or (bh and v.visitor_branch = mybr) or exists (select 1 from public.visit_joint j where j.visit_id = v.id and j.emp_id = me))), '[]'),
    'joint', coalesce((select jsonb_agg(jsonb_build_object('visit_id', j.visit_id, 'emp_id', j.emp_id))
                 from public.visit_joint j where j.updated_at > s), '[]'),
    -- requests: your own (everyone), all of them (admin)
    'requests', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'kind', r.kind, 'visit_id', r.visit_id, 'assignment_id', r.assignment_id,
                 'raised_by', r.raised_by, 'reason', r.reason, 'status', r.status, 'decided_by', r.decided_by, 'decision_note', r.decision_note,
                 'created_at', r.created_at, 'decided_at', r.decided_at))
                 from public.requests r where r.updated_at > s and (adm or r.raised_by = me)), '[]'),
    -- allotments currently on hold (pending reassign/remove), for everyone: always the full current list
    'holds', coalesce((select jsonb_agg(distinct r.assignment_id) from public.requests r
                 where r.status = 'pending' and r.kind in ('reassign','delete_assignment') and r.assignment_id is not null), '[]'),
    'deleted', case when p_since is null then '[]'::jsonb else coalesce((select jsonb_agg(jsonb_build_object('t', d.tbl, 'k', d.key))
                 from public.deletions d where d.at > s), '[]') end
  ) into out;
  return out;
end $$;

select 'TASC Connect database is up to date for version 55' as status;
