-- ════════════════════════════════════════════════════════════════════════════
--  Daura · database update for app version 15: the phone keeps its own copy and asks only "what changed?"
--  · every table records when a row last changed, and deletions are logged
--  · one function, sync(since), returns who you are + everything changed since your last sync,
--    limited to what you are allowed to see
--  Run once in Supabase → SQL Editor → New query → paste → Run. Safe to re-run.
--  (Run 04_update_v11.sql and 05_update_v12.sql first if you have not.)
-- ════════════════════════════════════════════════════════════════════════════

-- 1. "last changed" on every table the app keeps a copy of
alter table public.settings     add column if not exists updated_at timestamptz not null default now();
alter table public.campaigns    add column if not exists updated_at timestamptz not null default now();
alter table public.assignments  add column if not exists updated_at timestamptz not null default now();
alter table public.requests     add column if not exists updated_at timestamptz not null default now();
alter table public.visit_joint  add column if not exists updated_at timestamptz not null default now();
alter table public.visit_photos add column if not exists updated_at timestamptz not null default now();

create or replace function daura_private.touch() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;

do $$ declare t text; begin
  foreach t in array array['branches','staff','settings','campaigns','assignments','requests','visit_joint','visit_photos'] loop
    execute format('drop trigger if exists t_touch on public.%I', t);
    execute format('create trigger t_touch before update on public.%I for each row execute function daura_private.touch()', t);
  end loop;
end $$;
create index if not exists visits_updated on public.visits(updated_at);
create index if not exists entities_updated on public.entities(updated_at);
create index if not exists assignments_updated on public.assignments(updated_at);
create index if not exists requests_updated on public.requests(updated_at);

-- 2. deletions log, so phones can drop rows that no longer exist
create table if not exists public.deletions (
  id   bigserial primary key,
  tbl  text not null,
  key  text not null,
  at   timestamptz not null default now()
);
create index if not exists deletions_at on public.deletions(at);
alter table public.deletions enable row level security;   -- no policies: read only through sync()
revoke all on public.deletions from anon, authenticated;

create or replace function daura_private.log_delete() returns trigger
language plpgsql security definer set search_path = public as $$
declare k text;
begin
  if tg_table_name = 'visit_joint' then
    k := (to_jsonb(old) ->> 'visit_id') || ':' || (to_jsonb(old) ->> 'emp_id');
  else
    k := to_jsonb(old) ->> 'id';
  end if;
  insert into public.deletions(tbl, key) values (tg_table_name, k);
  return old;
end $$;
do $$ declare t text; begin
  foreach t in array array['entities','assignments','visits','visit_photos','visit_joint','requests'] loop
    execute format('drop trigger if exists t_log_delete on public.%I', t);
    execute format('create trigger t_log_delete after delete on public.%I for each row execute function daura_private.log_delete()', t);
  end loop;
end $$;

-- 3. sync(since): one call returns everything that changed since `since` (or everything when null).
--    Phones send back the previous `now` minus a small overlap; applying a row twice is harmless.
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
                 'contact', e.contact, 'lat', e.lat, 'lng', e.lng, 'closure', e.closure, 'created_by', e.created_by))
                 from public.entities e where e.updated_at > s), '[]'),
    -- allotments: everyone sees all of them (who is allotted where is already shown on every place)
    'assignments', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'entity_id', a.entity_id, 'assignee', a.assignee,
                 'scheduled_on', a.scheduled_on, 'status', a.status, 'campaign_id', a.campaign_id))
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

-- old deletion records are not needed once every phone has synced past them
create or replace function public.admin_prune_deletions() returns int
language sql security definer set search_path = public as $$
  with d as (delete from public.deletions where daura_private.is_admin() and at < now() - interval '60 days' returning 1) select count(*)::int from d
$$;

revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;
grant execute on function public.ping() to anon;

select 'Daura database is up to date for version 15' as status;
