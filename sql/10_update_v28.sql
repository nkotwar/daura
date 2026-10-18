-- ════════════════════════════════════════════════════════════════════════════
--  TASC Connect · database update for app version 28
--  A. Admin adds a place and allots it in one go; Allot / Reallot on any place; a note for the staff member.
--  B. Sign in with name + date of birth (no Google needed). The phone gets its own ID ("device:…"),
--     stored next to Gmails, so every existing rule keeps working. Admin and Viewer need Google.
--  Before running: Supabase → Authentication → Sign In / Providers → turn on "Allow anonymous sign-ins".
--  Run once in Supabase → SQL Editor → New query → paste → Run. Safe to re-run.
-- ════════════════════════════════════════════════════════════════════════════

-- ───────── A. Allotment ─────────
alter table public.assignments add column if not exists note text;
alter table public.entities    add column if not exists contact_person text;

-- Allot a place that has no open allotment
create or replace function public.admin_allot(p_entity uuid, p_to int, p_date date, p_campaign int default null, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare a public.assignments; ename text; cur int;
begin
  if not daura_private.is_admin() then raise exception 'NOT_ALLOWED'; end if;
  select name into ename from public.entities where id = p_entity;
  if ename is null then raise exception 'NOT_FOUND'; end if;
  if not exists (select 1 from public.staff where emp_id = p_to and active) then raise exception 'NOT_FOUND' using hint = 'Pick someone from the current staff list.'; end if;
  select assignee into cur from public.assignments where entity_id = p_entity and status = 'open' limit 1;
  if cur is not null then raise exception 'ALREADY_ALLOTTED' using hint = 'This place is already allotted. Use Reallot to give it to someone else.'; end if;
  insert into public.assignments(entity_id, assignee, scheduled_on, campaign_id, assigned_by, note)
  values (p_entity, p_to, p_date, p_campaign, daura_private.my_gmail(), nullif(trim(coalesce(p_note, '')), ''))
  returning * into a;
  insert into public.assignment_history(assignment_id, from_emp, to_emp, by_gmail, reason) values (a.id, null, p_to, daura_private.my_gmail(), 'allotted');
  perform daura_private.log('allotted', p_to::text, jsonb_build_object('entity', ename, 'on', p_date));
  return jsonb_build_object('id', a.id, 'entity_id', a.entity_id, 'assignee', a.assignee, 'scheduled_on', a.scheduled_on,
    'status', a.status, 'campaign_id', a.campaign_id, 'note', a.note);
end $$;

-- Reallot to someone else, and/or change the visit date or note
create or replace function public.admin_update_allotment(p_assignment uuid, p_to int, p_date date, p_note text default null, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare a public.assignments; ename text;
begin
  if not daura_private.is_admin() then raise exception 'NOT_ALLOWED'; end if;
  select * into a from public.assignments where id = p_assignment and status = 'open' for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  select name into ename from public.entities where id = a.entity_id;
  if p_to is not null and p_to <> a.assignee then
    if not exists (select 1 from public.staff where emp_id = p_to and active) then raise exception 'NOT_FOUND' using hint = 'Pick someone from the current staff list.'; end if;
    insert into public.assignment_history(assignment_id, from_emp, to_emp, by_gmail, reason) values (a.id, a.assignee, p_to, daura_private.my_gmail(), nullif(trim(coalesce(p_reason, '')), ''));
    perform daura_private.log('assignment_reassigned', p_to::text, jsonb_build_object('entity', ename, 'from', a.assignee, 'to', p_to));
  end if;
  update public.assignments set assignee = coalesce(p_to, assignee), scheduled_on = p_date, note = nullif(trim(coalesce(p_note, '')), '')
   where id = a.id returning * into a;
  return jsonb_build_object('id', a.id, 'entity_id', a.entity_id, 'assignee', a.assignee, 'scheduled_on', a.scheduled_on,
    'status', a.status, 'campaign_id', a.campaign_id, 'note', a.note);
end $$;

revoke execute on function public.admin_allot(uuid, int, date, int, text) from public, anon;
revoke execute on function public.admin_update_allotment(uuid, int, date, text, text) from public, anon;
grant execute on function public.admin_allot(uuid, int, date, int, text) to authenticated;
grant execute on function public.admin_update_allotment(uuid, int, date, text, text) to authenticated;

-- ───────── B. Sign in with name + date of birth ─────────
-- Who is calling: a Google Gmail, or "device:<id>" for a phone signed in by name + date of birth
create or replace function daura_private.my_gmail() returns text
language sql stable set search_path = public as $$
  select case
    when (auth.jwt() -> 'app_metadata' ->> 'provider') = 'google' then lower(coalesce(auth.jwt() ->> 'email', ''))
    when coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) and coalesce(auth.jwt() ->> 'sub', '') <> '' then 'device:' || lower(auth.jwt() ->> 'sub')
    else '' end
$$;

create or replace function daura_private.is_google() returns boolean
language sql stable set search_path = public as $$
  select daura_private.my_gmail() <> '' and daura_private.my_gmail() not like 'device:%'
$$;

-- Admin and Viewer only with Google
create or replace function daura_private.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select daura_private.is_google() and (
    exists (select 1 from public.admin_emails where gmail = daura_private.my_gmail())
    or exists (select 1 from public.staff where emp_id = daura_private.my_emp() and role = 'admin'))
$$;

create or replace function daura_private.is_viewer() returns boolean
language sql stable security definer set search_path = public as $$
  select daura_private.is_admin()
      or (daura_private.is_google() and exists (select 1 from public.staff where emp_id = daura_private.my_emp() and role = 'viewer'))
$$;

alter table public.staff_logins drop constraint if exists staff_logins_linked_via_check;
alter table public.staff_logins add constraint staff_logins_linked_via_check check (linked_via in ('email','dob','admin','device'));

create or replace function public.whoami() returns jsonb
language plpgsql security definer set search_path = public as $$
declare g text := daura_private.my_gmail(); r public.staff; adm boolean := daura_private.is_admin(); dev boolean;
begin
  if g = '' then return jsonb_build_object('state', 'not_google'); end if;
  dev := g like 'device:%';
  select s.* into r from public.staff_logins l join public.staff s on s.emp_id = l.emp_id where l.gmail = g;
  if found then
    update public.staff_logins set last_seen = now() where gmail = g;
    if r.blocked then return jsonb_build_object('state', 'blocked', 'gmail', g, 'device', dev); end if;
    if not r.active then return jsonb_build_object('state', 'inactive', 'gmail', g, 'device', dev); end if;
    return jsonb_build_object('state', 'linked', 'gmail', g, 'device', dev, 'admin', adm,
      'viewer', daura_private.is_viewer(), 'needs_google', dev and r.role in ('admin', 'viewer'),
      'me', daura_private.profile_json(r.emp_id, true));
  end if;
  if not dev then
    select s.* into r from public.staff s
     where s.email = g and s.active and not s.blocked
       and (select count(*) from public.staff x where x.email = g) = 1;
    if found then
      return jsonb_build_object('state', 'email_match', 'gmail', g, 'admin', adm, 'candidate', daura_private.profile_json(r.emp_id, true));
    end if;
  end if;
  return jsonb_build_object('state', 'unlinked', 'gmail', g, 'device', dev, 'admin', adm);
end $$;

-- Name + DOB check. The preview shows only the last 4 digits of the mobile. Links only when p_confirm = true.
create or replace function public.claim_by_dob(p_emp int, p_dob date, p_confirm boolean default false) returns jsonb
language plpgsql security definer set search_path = public as $$
declare g text := daura_private.my_gmail(); ok boolean; ph text; dev boolean := g like 'device:%';
begin
  if g = '' then raise exception 'NOT_GOOGLE'; end if;
  if exists (select 1 from public.staff_logins where gmail = g) then raise exception 'ALREADY_LINKED'; end if;
  select true, s.phone into ok, ph from public.staff s where s.emp_id = p_emp and s.dob = p_dob and s.active and not s.blocked;
  if ok is null then
    perform daura_private.log('claim_failed', p_emp::text, jsonb_build_object('gmail', g, 'via', case when dev then 'device' else 'dob' end));
    return null;
  end if;
  if not p_confirm then
    return daura_private.profile_json(p_emp, true) - 'phone'
      || jsonb_build_object('phone_last4', nullif(right(regexp_replace(coalesce(ph, ''), '\D', '', 'g'), 4), ''));
  end if;
  insert into public.staff_logins(gmail, emp_id, linked_via, last_seen) values (g, p_emp, case when dev then 'device' else 'dob' end, now());
  perform daura_private.log('login_linked', p_emp::text, jsonb_build_object('gmail', g, 'via', case when dev then 'device' else 'dob' end));
  return public.whoami();
end $$;

-- sync(): now also sends a place's contact person and an allotment's note
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
                   'account_numbers', v.account_numbers, 'verified_by', v.verified_by, 'created_by_admin', v.created_by_admin)
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

select 'TASC Connect database is up to date for version 28' as status;
