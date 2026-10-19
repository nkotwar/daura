-- ════════════════════════════════════════════════════════════════════════════
--  TASC Connect · database update for app version 48: the admin can send a visit report back.
--  A returned report counts as pending again; the staff member edits it and it goes back for checking.
--  Run once in Supabase → SQL Editor → New query → paste → Run. Safe to re-run.
-- ════════════════════════════════════════════════════════════════════════════
alter table public.visits add column if not exists return_note text;
alter table public.visits add column if not exists returned_at timestamptz;
alter table public.visits add column if not exists returned_by_gmail text;
alter table public.visits add column if not exists resubmitted_at timestamptz;
alter table public.visits drop constraint if exists visits_status_check;
alter table public.visits add constraint visits_status_check check (status in ('submitted','verified','returned'));

-- Send back (admin): only a submitted report
create or replace function public.admin_return_visit(p_visit uuid, p_note text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v public.visits; ename text;
begin
  if not daura_private.is_admin() then raise exception 'NOT_ALLOWED'; end if;
  if coalesce(trim(p_note), '') = '' then raise exception 'REASON_REQUIRED'; end if;
  select * into v from public.visits where id = p_visit;
  if not found then raise exception 'NOT_FOUND'; end if;
  if v.status <> 'submitted' then raise exception 'NOT_ALLOWED' using hint = 'Only a submitted (not yet verified) report can be sent back.'; end if;
  perform set_config('daura.bypass', 'on', true);
  update public.visits set status = 'returned', return_note = trim(p_note), returned_at = now(), returned_by_gmail = daura_private.my_gmail(), resubmitted_at = null
   where id = p_visit returning * into v;
  perform set_config('daura.bypass', '', true);
  select name into ename from public.entities where id = v.entity_id;
  perform daura_private.log('visit_returned', v.visitor::text, jsonb_build_object('entity', ename, 'visit_no', v.visit_no, 'note', trim(p_note)));
  return jsonb_build_object('status', v.status, 'return_note', v.return_note, 'returned_at', v.returned_at);
end $$;
revoke execute on function public.admin_return_visit(uuid, text) from public, anon;
grant execute on function public.admin_return_visit(uuid, text) to authenticated;

-- When the staff member saves a returned report, it goes back for checking (runs after visit_before)
create or replace function daura_private.visit_resubmit() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.status = 'returned' and not daura_private.bypass() and not daura_private.is_admin() and new.visitor = daura_private.my_emp() then
    new.status := 'submitted'; new.resubmitted_at := now();
    perform daura_private.log('visit_resubmitted', new.visitor::text,
      jsonb_build_object('entity', (select name from public.entities where id = new.entity_id), 'visit_no', new.visit_no));
  end if;
  return new;
end $$;
drop trigger if exists t_visit_resubmit on public.visits;
create trigger t_visit_resubmit before update on public.visits for each row execute function daura_private.visit_resubmit();

-- Staff can edit (and add or remove photos on) their own report while it is submitted or returned
drop policy if exists visits_update on public.visits;
create policy visits_update on public.visits for update to authenticated
  using (daura_private.is_admin() or (visitor = daura_private.my_emp() and status in ('submitted','returned')))
  with check (daura_private.is_admin() or (visitor = daura_private.my_emp() and status in ('submitted','returned')));
drop policy if exists visits_delete on public.visits;
create policy visits_delete on public.visits for delete to authenticated using (
  daura_private.is_admin() or (visitor = daura_private.my_emp() and status in ('submitted','returned')
                               and assignment_id is null and not created_by_admin));
drop policy if exists joint_write on public.visit_joint;
create policy joint_write on public.visit_joint for all to authenticated
  using (daura_private.is_admin() or exists (select 1 from public.visits v where v.id = visit_id and v.visitor = daura_private.my_emp() and v.status in ('submitted','returned')))
  with check (daura_private.is_admin() or exists (select 1 from public.visits v where v.id = visit_id and v.visitor = daura_private.my_emp() and v.status in ('submitted','returned')));
drop policy if exists photos_write on public.visit_photos;
create policy photos_write on public.visit_photos for all to authenticated
  using (daura_private.is_admin() or exists (select 1 from public.visits v where v.id = visit_id and v.visitor = daura_private.my_emp() and v.status in ('submitted','returned')))
  with check (daura_private.is_admin() or exists (select 1 from public.visits v where v.id = visit_id and v.visitor = daura_private.my_emp() and v.status in ('submitted','returned')));
drop policy if exists daura_photos_insert on storage.objects;
create policy daura_photos_insert on storage.objects for insert to authenticated with check (
  bucket_id = 'photos' and exists (select 1 from public.visits v
    where v.id::text = (storage.foldername(name))[1]
      and (daura_private.is_admin() or (v.visitor = daura_private.my_emp() and v.status in ('submitted','returned')))));
drop policy if exists daura_photos_delete on storage.objects;
create policy daura_photos_delete on storage.objects for delete to authenticated using (
  bucket_id = 'photos' and exists (select 1 from public.visits v
    where v.id::text = (storage.foldername(name))[1]
      and (daura_private.is_admin() or (v.visitor = daura_private.my_emp() and v.status in ('submitted','returned')))));

-- sync(): now also sends why a report was sent back
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
                 'contact', e.contact, 'contact_person', e.contact_person, 'lat', e.lat, 'lng', e.lng, 'closure', e.closure, 'created_by', e.created_by))
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
                 || case when daura_private.can_see_visit(v.id, v.visitor, v.visitor_branch) then
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
                 where p.updated_at > s and daura_private.can_see_visit(v.id, v.visitor, v.visitor_branch)), '[]'),
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

select 'TASC Connect database is up to date for version 48' as status;
