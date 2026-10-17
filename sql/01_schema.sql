-- ════════════════════════════════════════════════════════════════════════════
--  Daura · database schema v1
--  Run once in Supabase → SQL Editor → New query → paste all → Run.
--  Safe to re-run: it only creates what is missing and replaces functions.
--  This file holds NO staff data. Staff, entities and assignments come from the
--  private seed file (never put that one on GitHub).
-- ════════════════════════════════════════════════════════════════════════════

create schema if not exists daura_private;
revoke all on schema daura_private from public, anon;
grant usage on schema daura_private to authenticated;

-- ─────────────────────────────── tables ───────────────────────────────

create table if not exists public.branches (
  code        int primary key,
  name        text not null,
  lat         double precision,
  lng         double precision,
  mobile      text,
  is_ro       boolean not null default false,
  active      boolean not null default true,
  updated_at  timestamptz not null default now()
);

create table if not exists public.staff (
  emp_id            int primary key,
  name              text not null,
  designation       text,
  grade             text,
  branch_code       int references public.branches(code),
  phone             text,
  email             text,            -- from udairo.js, only used to auto-match a Gmail
  dob               date,            -- only used to confirm identity
  dept              text,
  second_in_command boolean not null default false,
  is_branch_head    boolean not null default false,
  role              text not null default 'field' check (role in ('field','viewer','admin')),
  active            boolean not null default true,   -- false = not in the latest udairo.js
  blocked           boolean not null default false,  -- set by admin: cuts off all access at once
  updated_at        timestamptz not null default now()
);

-- Many Gmails → one employee
create table if not exists public.staff_logins (
  gmail       text primary key check (gmail = lower(gmail)),
  emp_id      int not null references public.staff(emp_id) on delete cascade,
  linked_via  text not null check (linked_via in ('email','dob','admin')),
  linked_at   timestamptz not null default now(),
  last_seen   timestamptz
);
create index if not exists staff_logins_emp on public.staff_logins(emp_id);

-- Gmails that are admin even before the staff list is loaded (bootstrap)
create table if not exists public.admin_emails (
  gmail text primary key check (gmail = lower(gmail))
);

create table if not exists public.settings (
  key   text primary key,
  value jsonb not null
);

create table if not exists public.entities (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  type        text not null,
  area        text,                 -- free label (e.g. the branch column of an allotment sheet)
  address     text,
  contact     text,
  lat         double precision,     -- set only from a live-captured, geotagged photo
  lng         double precision,
  loc_at      timestamptz,
  closure     text,                 -- mirrors the latest visit's closure (for quick filtering)
  created_by  int references public.staff(emp_id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists entities_name on public.entities (lower(name));

create table if not exists public.campaigns (
  id          serial primary key,
  name        text not null unique,
  starts_on   date,
  ends_on     date,
  created_at  timestamptz not null default now()
);

create table if not exists public.assignments (
  id            uuid primary key default gen_random_uuid(),
  entity_id     uuid not null references public.entities(id) on delete cascade,
  assignee      int not null references public.staff(emp_id),
  scheduled_on  date,
  campaign_id   int references public.campaigns(id),
  status        text not null default 'open' check (status in ('open','cancelled')),
  assigned_by   text,               -- admin gmail
  created_at    timestamptz not null default now()
);
create index if not exists assignments_assignee on public.assignments(assignee);
create index if not exists assignments_entity on public.assignments(entity_id);

create table if not exists public.assignment_history (
  id             bigserial primary key,
  assignment_id  uuid not null references public.assignments(id) on delete cascade,
  from_emp       int,
  to_emp         int,
  by_gmail       text,
  reason         text,
  at             timestamptz not null default now()
);

create table if not exists public.visits (
  id                  uuid primary key default gen_random_uuid(),
  entity_id           uuid not null references public.entities(id) on delete cascade,
  assignment_id       uuid references public.assignments(id) on delete set null,
  visit_no            int not null default 1,
  visitor             int not null references public.staff(emp_id),
  visitor_branch      int,          -- branch at the time of the visit
  visited_at          timestamptz not null default now(),
  logged_at           timestamptz not null default now(),
  lat                 double precision,
  lng                 double precision,
  accuracy_m          int,
  loc_source          text check (loc_source in ('gps','manual','none')),
  person_name         text,
  person_designation  text,
  person_mobile       text,
  banking_with        text,         -- 'us' | 'other' | 'none'
  other_bank          text,
  headcount           int,
  headcount_kind      text,         -- staff | students | beds | members
  potential_rs        numeric(16,2),
  products            text[] not null default '{}',
  outcome             text,
  remarks             text,
  next_step           text,
  followup_on         date,
  closure             text check (closure in ('account_opened','rejected','not_feasible')),
  closure_note        text,
  mobilised_rs        numeric(16,2),
  account_numbers     text[] not null default '{}',
  status              text not null default 'submitted' check (status in ('submitted','verified')),
  verified_by         int references public.staff(emp_id),
  verified_by_gmail   text,
  verified_at         timestamptz,
  created_by_admin    boolean not null default false,
  created_by_gmail    text,
  updated_at          timestamptz not null default now()
);
create index if not exists visits_entity on public.visits(entity_id, visit_no);
create index if not exists visits_visitor on public.visits(visitor);
create index if not exists visits_branch on public.visits(visitor_branch);

create table if not exists public.visit_joint (
  visit_id uuid not null references public.visits(id) on delete cascade,
  emp_id   int  not null references public.staff(emp_id),
  primary key (visit_id, emp_id)
);

create table if not exists public.visit_photos (
  id          uuid primary key default gen_random_uuid(),
  visit_id    uuid not null references public.visits(id) on delete cascade,
  provider    text not null default 'supabase' check (provider in ('supabase','drive')),
  path        text not null,
  bytes       int,
  source      text not null check (source in ('capture','upload')),
  taken_at    timestamptz,
  lat         double precision,
  lng         double precision,
  created_at  timestamptz not null default now()
);
create index if not exists visit_photos_visit on public.visit_photos(visit_id);

create table if not exists public.requests (
  id              uuid primary key default gen_random_uuid(),
  kind            text not null check (kind in ('delete_visit','delete_assignment','reassign','unverify')),
  visit_id        uuid references public.visits(id) on delete set null,
  assignment_id   uuid references public.assignments(id) on delete set null,
  raised_by       int not null references public.staff(emp_id),
  reason          text not null,
  status          text not null default 'pending' check (status in ('pending','approved','declined')),
  decided_by      text,
  decision_note   text,
  created_at      timestamptz not null default now(),
  decided_at      timestamptz
);

create table if not exists public.activity_log (
  id          bigserial primary key,
  at          timestamptz not null default now(),
  actor_gmail text,
  actor_emp   int,
  action      text not null,
  target      text,
  detail      jsonb
);
create index if not exists activity_log_at on public.activity_log(at desc);

-- ─────────────────────────────── helpers ───────────────────────────────
-- Identity = the Google-verified email in the sign-in token, matched to staff_logins.

create or replace function daura_private.my_gmail() returns text
language sql stable set search_path = public as $$
  select case when (auth.jwt() -> 'app_metadata' ->> 'provider') = 'google'
              then lower(coalesce(auth.jwt() ->> 'email', '')) else '' end
$$;

create or replace function daura_private.my_emp() returns int
language sql stable security definer set search_path = public as $$
  select s.emp_id from public.staff_logins l join public.staff s on s.emp_id = l.emp_id
  where l.gmail = daura_private.my_gmail() and l.gmail <> '' and s.active and not s.blocked
  limit 1
$$;

create or replace function daura_private.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select daura_private.my_gmail() <> '' and (
    exists (select 1 from public.admin_emails where gmail = daura_private.my_gmail())
    or exists (select 1 from public.staff where emp_id = daura_private.my_emp() and role = 'admin'))
$$;

create or replace function daura_private.is_viewer() returns boolean
language sql stable security definer set search_path = public as $$
  select daura_private.is_admin()
      or exists (select 1 from public.staff where emp_id = daura_private.my_emp() and role = 'viewer')
$$;

create or replace function daura_private.my_branch() returns int
language sql stable security definer set search_path = public as $$
  select branch_code from public.staff where emp_id = daura_private.my_emp()
$$;

create or replace function daura_private.is_bh() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select is_branch_head from public.staff where emp_id = daura_private.my_emp()), false)
$$;

create or replace function daura_private.signed_in() returns boolean
language sql stable security definer set search_path = public as $$
  select daura_private.my_emp() is not null or daura_private.is_admin()
$$;

-- Can the caller see this visit?
create or replace function daura_private.can_see_visit(p_id uuid, p_visitor int, p_branch int) returns boolean
language sql stable security definer set search_path = public as $$
  select daura_private.is_viewer()
      or p_visitor = daura_private.my_emp()
      or exists (select 1 from public.visit_joint j where j.visit_id = p_id and j.emp_id = daura_private.my_emp())
      or (daura_private.is_bh() and p_branch = daura_private.my_branch())
$$;

create or replace function daura_private.log(p_action text, p_target text, p_detail jsonb default null) returns void
language sql security definer set search_path = public as $$
  insert into public.activity_log(actor_gmail, actor_emp, action, target, detail)
  values (nullif(daura_private.my_gmail(), ''), daura_private.my_emp(), p_action, p_target, p_detail)
$$;

create or replace function daura_private.bypass() returns boolean
language sql stable as $$ select coalesce(current_setting('daura.bypass', true), '') = 'on' $$;

grant execute on all functions in schema daura_private to authenticated;

-- ─────────────────────────────── row-level security ───────────────────────────────

alter table public.branches           enable row level security;
alter table public.staff              enable row level security;
alter table public.staff_logins       enable row level security;
alter table public.admin_emails       enable row level security;
alter table public.settings           enable row level security;
alter table public.entities           enable row level security;
alter table public.campaigns          enable row level security;
alter table public.assignments        enable row level security;
alter table public.assignment_history enable row level security;
alter table public.visits             enable row level security;
alter table public.visit_joint        enable row level security;
alter table public.visit_photos       enable row level security;
alter table public.requests           enable row level security;
alter table public.activity_log       enable row level security;

revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;

do $$ declare r record; begin
  for r in select schemaname, tablename, policyname from pg_policies where schemaname = 'public' loop
    execute format('drop policy %I on %I.%I', r.policyname, r.schemaname, r.tablename);
  end loop;
end $$;

-- branches / settings / campaigns: everyone signed in reads, admin writes
create policy branches_read  on public.branches  for select to authenticated using (daura_private.signed_in());
create policy branches_admin on public.branches  for all    to authenticated using (daura_private.is_admin()) with check (daura_private.is_admin());
create policy settings_read  on public.settings  for select to authenticated using (daura_private.signed_in());
create policy settings_admin on public.settings  for all    to authenticated using (daura_private.is_admin()) with check (daura_private.is_admin());
create policy campaigns_read  on public.campaigns for select to authenticated using (daura_private.signed_in());
create policy campaigns_admin on public.campaigns for all    to authenticated using (daura_private.is_admin()) with check (daura_private.is_admin());

-- staff: own row, or admin. (Names for pickers come through staff_directory(), without DOB/email.)
create policy staff_read  on public.staff for select to authenticated using (emp_id = daura_private.my_emp() or daura_private.is_admin());
create policy staff_admin on public.staff for all    to authenticated using (daura_private.is_admin()) with check (daura_private.is_admin());

-- logins: own, or admin. All writes go through functions.
create policy logins_read on public.staff_logins for select to authenticated using (emp_id = daura_private.my_emp() or daura_private.is_admin());

-- admin_emails: admin only
create policy admins_admin on public.admin_emails for all to authenticated using (daura_private.is_admin()) with check (daura_private.is_admin());

-- entities: everyone signed in reads and adds; creator or admin edits; admin deletes
create policy entities_read   on public.entities for select to authenticated using (daura_private.signed_in());
create policy entities_insert on public.entities for insert to authenticated with check (daura_private.signed_in());
create policy entities_update on public.entities for update to authenticated
  using (created_by = daura_private.my_emp() or daura_private.is_admin())
  with check (created_by = daura_private.my_emp() or daura_private.is_admin());
create policy entities_delete on public.entities for delete to authenticated using (daura_private.is_admin());

-- assignments: assignee, branch head of the assignee's branch, viewers; admin writes
create policy assignments_read on public.assignments for select to authenticated using (
  daura_private.is_viewer() or assignee = daura_private.my_emp()
  or (daura_private.is_bh() and exists (select 1 from public.staff s where s.emp_id = assignee and s.branch_code = daura_private.my_branch())));
create policy assignments_admin on public.assignments for all to authenticated using (daura_private.is_admin()) with check (daura_private.is_admin());
create policy ahist_read on public.assignment_history for select to authenticated using (
  daura_private.is_viewer() or exists (select 1 from public.assignments a where a.id = assignment_id and a.assignee = daura_private.my_emp()));

-- visits
create policy visits_read on public.visits for select to authenticated using (daura_private.can_see_visit(id, visitor, visitor_branch));
create policy visits_insert on public.visits for insert to authenticated with check (
  daura_private.is_admin() or (visitor = daura_private.my_emp()));
create policy visits_update on public.visits for update to authenticated
  using (daura_private.is_admin() or (visitor = daura_private.my_emp() and status = 'submitted'))
  with check (daura_private.is_admin() or (visitor = daura_private.my_emp() and status = 'submitted'));
-- staff delete only their own, unverified, self-added visits (not tied to an admin assignment)
create policy visits_delete on public.visits for delete to authenticated using (
  daura_private.is_admin() or (visitor = daura_private.my_emp() and status = 'submitted'
                               and assignment_id is null and not created_by_admin));

create policy joint_read on public.visit_joint for select to authenticated using (
  exists (select 1 from public.visits v where v.id = visit_id and daura_private.can_see_visit(v.id, v.visitor, v.visitor_branch)));
create policy joint_write on public.visit_joint for all to authenticated
  using (daura_private.is_admin() or exists (select 1 from public.visits v where v.id = visit_id and v.visitor = daura_private.my_emp() and v.status = 'submitted'))
  with check (daura_private.is_admin() or exists (select 1 from public.visits v where v.id = visit_id and v.visitor = daura_private.my_emp() and v.status = 'submitted'));

create policy photos_read on public.visit_photos for select to authenticated using (
  exists (select 1 from public.visits v where v.id = visit_id and daura_private.can_see_visit(v.id, v.visitor, v.visitor_branch)));
create policy photos_write on public.visit_photos for all to authenticated
  using (daura_private.is_admin() or exists (select 1 from public.visits v where v.id = visit_id and v.visitor = daura_private.my_emp() and v.status = 'submitted'))
  with check (daura_private.is_admin() or exists (select 1 from public.visits v where v.id = visit_id and v.visitor = daura_private.my_emp() and v.status = 'submitted'));

-- requests: raiser sees own; admin sees and decides. Raised through raise_request().
create policy requests_read on public.requests for select to authenticated using (raised_by = daura_private.my_emp() or daura_private.is_admin());
create policy requests_admin on public.requests for all to authenticated using (daura_private.is_admin()) with check (daura_private.is_admin());

-- activity log: admin and viewers read; written only by functions/triggers
create policy log_read on public.activity_log for select to authenticated using (daura_private.is_viewer());

-- ─────────────────────────────── triggers ───────────────────────────────

create or replace function daura_private.touch() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;

drop trigger if exists t_touch on public.entities;
create trigger t_touch before update on public.entities for each row execute function daura_private.touch();

-- entities: creator is always the caller
create or replace function daura_private.entity_before() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if not daura_private.is_admin() or new.created_by is null then new.created_by := daura_private.my_emp(); end if;
    new.lat := null; new.lng := null; new.loc_at := null; new.closure := null;   -- location comes only from live photos
  elsif not daura_private.bypass() and not daura_private.is_admin() then
    new.created_by := old.created_by; new.lat := old.lat; new.lng := old.lng; new.loc_at := old.loc_at; new.closure := old.closure;
  end if;
  return new;
end $$;
drop trigger if exists t_entity_before on public.entities;
create trigger t_entity_before before insert or update on public.entities for each row execute function daura_private.entity_before();

-- visits: numbering, follow-up rule, protected fields
create or replace function daura_private.visit_before() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  last_v public.visits;
  a      public.assignments;
  adm    boolean := daura_private.is_admin();
begin
  if tg_op = 'INSERT' then
    if not adm then new.visitor := daura_private.my_emp(); end if;
    if new.visitor is null then raise exception 'NOT_LINKED' using hint = 'Sign in and confirm your profile first.'; end if;
    new.visitor_branch   := (select branch_code from public.staff where emp_id = new.visitor);
    new.logged_at        := now();
    new.status           := 'submitted';
    new.verified_by      := null; new.verified_by_gmail := null; new.verified_at := null;
    new.created_by_admin := adm and new.visitor is distinct from daura_private.my_emp();
    new.created_by_gmail := nullif(daura_private.my_gmail(), '');

    if new.assignment_id is not null then
      select * into a from public.assignments where id = new.assignment_id;
      if not found or a.status <> 'open' or a.entity_id <> new.entity_id or (a.assignee <> new.visitor and not adm) then
        raise exception 'BAD_ASSIGNMENT' using hint = 'This visit is not assigned to you.';
      end if;
    end if;

    perform pg_advisory_xact_lock(hashtext(new.entity_id::text));
    select * into last_v from public.visits where entity_id = new.entity_id order by visit_no desc limit 1;
    if found then
      if not adm and last_v.status <> 'verified' then
        raise exception 'FOLLOWUP_NEEDS_VERIFIED' using hint = 'A follow-up can be added once the latest visit to this place is verified.';
      end if;
      if not adm and last_v.closure is not null then
        raise exception 'ENTITY_CLOSED' using hint = 'This place is closed. Ask the admin to reopen it.';
      end if;
      new.visit_no := last_v.visit_no + 1;
    else
      new.visit_no := 1;
    end if;
  else
    if not daura_private.bypass() and not adm then
      if old.status = 'verified' then raise exception 'VERIFIED_LOCKED' using hint = 'Verified visits cannot be changed. Ask the admin to unverify it.'; end if;
      new.visitor := old.visitor; new.visitor_branch := old.visitor_branch; new.entity_id := old.entity_id;
      new.assignment_id := old.assignment_id; new.visit_no := old.visit_no; new.logged_at := old.logged_at;
      new.status := old.status; new.verified_by := old.verified_by; new.verified_by_gmail := old.verified_by_gmail;
      new.verified_at := old.verified_at; new.created_by_admin := old.created_by_admin; new.created_by_gmail := old.created_by_gmail;
    end if;
    new.updated_at := now();
  end if;
  if new.closure is distinct from 'account_opened' then new.account_numbers := '{}'; end if;
  return new;
end $$;
drop trigger if exists t_visit_before on public.visits;
create trigger t_visit_before before insert or update on public.visits for each row execute function daura_private.visit_before();

-- keep entities.closure in step with the latest visit
create or replace function daura_private.visit_after() returns trigger
language plpgsql security definer set search_path = public as $$
declare eid uuid := coalesce(new.entity_id, old.entity_id);
begin
  perform set_config('daura.bypass', 'on', true);
  update public.entities e set closure = (select v.closure from public.visits v where v.entity_id = eid order by v.visit_no desc limit 1)
  where e.id = eid;
  perform set_config('daura.bypass', '', true);
  return null;
end $$;
drop trigger if exists t_visit_after on public.visits;
create trigger t_visit_after after insert or update or delete on public.visits for each row execute function daura_private.visit_after();

-- a live-captured photo with GPS sets the place's map location (latest capture wins)
create or replace function daura_private.photo_after() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.source = 'capture' and new.lat is not null and new.lng is not null then
    perform set_config('daura.bypass', 'on', true);
    update public.entities e set lat = new.lat, lng = new.lng, loc_at = now()
      from public.visits v where v.id = new.visit_id and e.id = v.entity_id;
    perform set_config('daura.bypass', '', true);
  end if;
  return null;
end $$;
drop trigger if exists t_photo_after on public.visit_photos;
create trigger t_photo_after after insert on public.visit_photos for each row execute function daura_private.photo_after();

-- max 4 photos per visit
create or replace function daura_private.photo_before() returns trigger
language plpgsql as $$
begin
  if (select count(*) from public.visit_photos where visit_id = new.visit_id) >= 4 then
    raise exception 'MAX_PHOTOS' using hint = 'A visit can have at most 4 photos.';
  end if;
  return new;
end $$;
drop trigger if exists t_photo_before on public.visit_photos;
create trigger t_photo_before before insert on public.visit_photos for each row execute function daura_private.photo_before();

-- ─────────────────────────────── photo storage ───────────────────────────────
-- Private bucket. Files live at photos/<visit_id>/<photo_id>.jpg. Links are short-lived (signed).

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('photos', 'photos', false, 2097152, array['image/jpeg','image/webp'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists daura_photos_read   on storage.objects;
drop policy if exists daura_photos_insert on storage.objects;
drop policy if exists daura_photos_delete on storage.objects;

create policy daura_photos_read on storage.objects for select to authenticated using (
  bucket_id = 'photos' and exists (select 1 from public.visits v
    where v.id::text = (storage.foldername(name))[1] and daura_private.can_see_visit(v.id, v.visitor, v.visitor_branch)));
create policy daura_photos_insert on storage.objects for insert to authenticated with check (
  bucket_id = 'photos' and exists (select 1 from public.visits v
    where v.id::text = (storage.foldername(name))[1]
      and (daura_private.is_admin() or (v.visitor = daura_private.my_emp() and v.status = 'submitted'))));
create policy daura_photos_delete on storage.objects for delete to authenticated using (
  bucket_id = 'photos' and exists (select 1 from public.visits v
    where v.id::text = (storage.foldername(name))[1]
      and (daura_private.is_admin() or (v.visitor = daura_private.my_emp() and v.status = 'submitted'))));

-- ─────────────────────────────── sign-in & profile ───────────────────────────────

create or replace function daura_private.profile_json(p_emp int, with_dob boolean) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'emp_id', s.emp_id, 'name', s.name, 'designation', s.designation, 'grade', s.grade,
    'branch_code', s.branch_code, 'branch', b.name, 'is_ro', coalesce(b.is_ro, false),
    'role', s.role, 'is_branch_head', s.is_branch_head, 'phone', s.phone,
    'dob', case when with_dob then to_char(s.dob, 'DD-MM-YYYY') end)
  from public.staff s left join public.branches b on b.code = s.branch_code
  where s.emp_id = p_emp
$$;

-- What the app shows after Google sign-in
create or replace function public.whoami() returns jsonb
language plpgsql security definer set search_path = public as $$
declare g text := daura_private.my_gmail(); r public.staff; adm boolean := daura_private.is_admin();
begin
  if g = '' then return jsonb_build_object('state', 'not_google'); end if;
  select s.* into r from public.staff_logins l join public.staff s on s.emp_id = l.emp_id where l.gmail = g;
  if found then
    update public.staff_logins set last_seen = now() where gmail = g;
    if r.blocked then return jsonb_build_object('state', 'blocked', 'gmail', g); end if;
    if not r.active then return jsonb_build_object('state', 'inactive', 'gmail', g); end if;
    return jsonb_build_object('state', 'linked', 'gmail', g, 'admin', adm,
      'viewer', daura_private.is_viewer(), 'me', daura_private.profile_json(r.emp_id, true));
  end if;
  select s.* into r from public.staff s
   where s.email = g and s.active and not s.blocked
     and (select count(*) from public.staff x where x.email = g) = 1;
  if found then
    return jsonb_build_object('state', 'email_match', 'gmail', g, 'admin', adm, 'candidate', daura_private.profile_json(r.emp_id, true));
  end if;
  return jsonb_build_object('state', 'unlinked', 'gmail', g, 'admin', adm);
end $$;

create or replace function public.confirm_email_match() returns jsonb
language plpgsql security definer set search_path = public as $$
declare g text := daura_private.my_gmail(); e int;
begin
  if g = '' then raise exception 'NOT_GOOGLE'; end if;
  select s.emp_id into e from public.staff s
   where s.email = g and s.active and not s.blocked and (select count(*) from public.staff x where x.email = g) = 1;
  if e is null then raise exception 'NO_MATCH'; end if;
  insert into public.staff_logins(gmail, emp_id, linked_via, last_seen) values (g, e, 'email', now())
  on conflict (gmail) do nothing;
  perform daura_private.log('login_linked', e::text, jsonb_build_object('gmail', g, 'via', 'email'));
  return public.whoami();
end $$;

-- Names for the "pick your name" list: no DOB, no phone, no email
create or replace function public.claim_list() returns table(emp_id int, name text, designation text, branch text)
language sql stable security definer set search_path = public as $$
  select s.emp_id, s.name, s.designation, b.name
  from public.staff s left join public.branches b on b.code = s.branch_code
  where daura_private.my_gmail() <> '' and s.active and not s.blocked
  order by regexp_replace(upper(s.name), '^(MR|MS|MRS|MISS)\.?\s+', '')
$$;

-- Name + DOB check. Returns the profile on a match, null otherwise. Links only when p_confirm = true.
create or replace function public.claim_by_dob(p_emp int, p_dob date, p_confirm boolean default false) returns jsonb
language plpgsql security definer set search_path = public as $$
declare g text := daura_private.my_gmail(); ok boolean;
begin
  if g = '' then raise exception 'NOT_GOOGLE'; end if;
  if exists (select 1 from public.staff_logins where gmail = g) then raise exception 'ALREADY_LINKED'; end if;
  select true into ok from public.staff s where s.emp_id = p_emp and s.dob = p_dob and s.active and not s.blocked;
  if ok is null then
    perform daura_private.log('claim_failed', p_emp::text, jsonb_build_object('gmail', g));
    return null;
  end if;
  if not p_confirm then return daura_private.profile_json(p_emp, true); end if;
  insert into public.staff_logins(gmail, emp_id, linked_via, last_seen) values (g, p_emp, 'dob', now());
  perform daura_private.log('login_linked', p_emp::text, jsonb_build_object('gmail', g, 'via', 'dob'));
  return public.whoami();
end $$;

-- My linked Gmails, and removing one of them
create or replace function public.my_logins() returns table(gmail text, linked_via text, linked_at timestamptz, last_seen timestamptz, is_current boolean)
language sql stable security definer set search_path = public as $$
  select l.gmail, l.linked_via, l.linked_at, l.last_seen, l.gmail = daura_private.my_gmail()
  from public.staff_logins l where l.emp_id = daura_private.my_emp() order by l.linked_at
$$;

create or replace function public.unlink_my_login(p_gmail text) returns void
language plpgsql security definer set search_path = public as $$
declare e int := daura_private.my_emp();
begin
  if e is null then raise exception 'NOT_LINKED'; end if;
  delete from public.staff_logins where gmail = lower(p_gmail) and emp_id = e;
  perform daura_private.log('login_unlinked', e::text, jsonb_build_object('gmail', lower(p_gmail), 'by', 'self'));
end $$;

-- Staff names for pickers (joint visit, reassign, timelines). Phone only for viewers/admin.
create or replace function public.staff_directory() returns table(emp_id int, name text, designation text, branch_code int, branch text, is_branch_head boolean, phone text)
language sql stable security definer set search_path = public as $$
  select s.emp_id, s.name, s.designation, s.branch_code, b.name, s.is_branch_head,
         case when daura_private.is_viewer() then s.phone end
  from public.staff s left join public.branches b on b.code = s.branch_code
  where daura_private.signed_in() and s.active
  order by b.name, s.name
$$;

-- Visit history of a place, for anyone signed in (no photos, no contact numbers)
create or replace function public.entity_timeline(p_entity uuid) returns table(visit_no int, visited_at timestamptz, visitor text, branch text, outcome text, next_step text, status text, closure text)
language sql stable security definer set search_path = public as $$
  select v.visit_no, v.visited_at, s.name, b.name, v.outcome, v.next_step, v.status, v.closure
  from public.visits v join public.staff s on s.emp_id = v.visitor left join public.branches b on b.code = v.visitor_branch
  where daura_private.signed_in() and v.entity_id = p_entity
  order by v.visit_no
$$;

-- ─────────────────────────────── verification & requests ───────────────────────────────

create or replace function public.verify_visit(p_visit uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v public.visits; me int := daura_private.my_emp();
begin
  select * into v from public.visits where id = p_visit;
  if not found then raise exception 'NOT_FOUND'; end if;
  if not (daura_private.is_admin()
          or (daura_private.is_bh() and v.visitor_branch = daura_private.my_branch() and v.visitor <> me)) then
    raise exception 'NOT_ALLOWED' using hint = 'Only the branch head of the visitor''s branch, or the admin, can verify.';
  end if;
  perform set_config('daura.bypass', 'on', true);
  update public.visits set status = 'verified', verified_by = me, verified_by_gmail = daura_private.my_gmail(), verified_at = now() where id = p_visit;
  perform set_config('daura.bypass', '', true);
  perform daura_private.log('visit_verified', p_visit::text, null);
end $$;

create or replace function public.unverify_visit(p_visit uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not daura_private.is_admin() then raise exception 'NOT_ALLOWED'; end if;
  perform set_config('daura.bypass', 'on', true);
  update public.visits set status = 'submitted', verified_by = null, verified_by_gmail = null, verified_at = null where id = p_visit;
  perform set_config('daura.bypass', '', true);
  perform daura_private.log('visit_unverified', p_visit::text, null);
end $$;

create or replace function public.raise_request(p_kind text, p_visit uuid, p_assignment uuid, p_reason text) returns uuid
language plpgsql security definer set search_path = public as $$
declare me int := daura_private.my_emp(); rid uuid;
begin
  if me is null then raise exception 'NOT_LINKED'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'REASON_REQUIRED'; end if;
  if p_kind in ('delete_visit','unverify') and not exists (select 1 from public.visits where id = p_visit and visitor = me) then raise exception 'NOT_ALLOWED'; end if;
  if p_kind in ('delete_assignment','reassign') and not exists (select 1 from public.assignments where id = p_assignment and assignee = me) then raise exception 'NOT_ALLOWED'; end if;
  if exists (select 1 from public.requests where status = 'pending' and kind = p_kind and visit_id is not distinct from p_visit and assignment_id is not distinct from p_assignment) then
    raise exception 'ALREADY_REQUESTED';
  end if;
  insert into public.requests(kind, visit_id, assignment_id, raised_by, reason) values (p_kind, p_visit, p_assignment, me, trim(p_reason)) returning id into rid;
  perform daura_private.log('request_raised', rid::text, jsonb_build_object('kind', p_kind));
  return rid;
end $$;

create or replace function public.admin_reassign(p_assignment uuid, p_to int, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare a public.assignments;
begin
  if not daura_private.is_admin() then raise exception 'NOT_ALLOWED'; end if;
  select * into a from public.assignments where id = p_assignment for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  update public.assignments set assignee = p_to where id = p_assignment;
  insert into public.assignment_history(assignment_id, from_emp, to_emp, by_gmail, reason) values (p_assignment, a.assignee, p_to, daura_private.my_gmail(), p_reason);
  perform daura_private.log('assignment_reassigned', p_assignment::text, jsonb_build_object('from', a.assignee, 'to', p_to));
end $$;

create or replace function public.decide_request(p_request uuid, p_approve boolean, p_note text default null, p_to int default null) returns void
language plpgsql security definer set search_path = public as $$
declare r public.requests;
begin
  if not daura_private.is_admin() then raise exception 'NOT_ALLOWED'; end if;
  select * into r from public.requests where id = p_request and status = 'pending' for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if p_approve then
    if r.kind = 'delete_visit' then delete from public.visits where id = r.visit_id;
    elsif r.kind = 'delete_assignment' then update public.assignments set status = 'cancelled' where id = r.assignment_id;
    elsif r.kind = 'unverify' then perform public.unverify_visit(r.visit_id);
    elsif r.kind = 'reassign' then
      if p_to is null then raise exception 'PICK_PERSON'; end if;
      perform public.admin_reassign(r.assignment_id, p_to, r.reason);
    end if;
  end if;
  update public.requests set status = case when p_approve then 'approved' else 'declined' end,
         decided_by = daura_private.my_gmail(), decision_note = p_note, decided_at = now() where id = p_request;
  perform daura_private.log('request_decided', p_request::text, jsonb_build_object('approved', p_approve));
end $$;

-- ─────────────────────────────── admin: people & directory ───────────────────────────────

create or replace function daura_private.import_directory(d jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare b jsonb; s jsonb; seen int[] := '{}'; nb int := 0; ns int := 0; nnew int := 0; ninact int := 0; isnew boolean; bseen int[] := '{}';
begin
  if jsonb_typeof(d -> 'branches') is distinct from 'array' then raise exception 'BAD_FILE'; end if;
  for b in select * from jsonb_array_elements(d -> 'branches') loop
    insert into public.branches(code, name, lat, lng, mobile, is_ro, active, updated_at)
    values ((b->>'branchCode')::int, b->>'branchName', (b->>'lat')::float8, (b->>'lng')::float8, b->>'mobile',
            coalesce(b->>'size', '') ilike 'REGIONAL%', true, now())
    on conflict (code) do update set name = excluded.name, lat = excluded.lat, lng = excluded.lng, mobile = excluded.mobile,
      is_ro = excluded.is_ro, active = true, updated_at = now();
    nb := nb + 1; bseen := bseen || (b->>'branchCode')::int;
    for s in select * from jsonb_array_elements(coalesce(b -> 'staff', '[]'::jsonb)) loop
      insert into public.staff(emp_id, name, designation, grade, branch_code, phone, email, dob, dept, second_in_command, is_branch_head, active, updated_at)
      values ((s->>'empId')::int, trim(s->>'name'), s->>'designation', s->>'grade', (b->>'branchCode')::int, s->>'phone',
              lower(nullif(trim(s->>'email'), '')), to_date(nullif(s->>'dob', ''), 'DD-MM-YYYY'), s->>'dept',
              coalesce((s->>'secondInCommand')::boolean, false), coalesce(s->>'designation', '') ilike 'Branch Manager%', true, now())
      on conflict (emp_id) do update set name = excluded.name, designation = excluded.designation, grade = excluded.grade,
        branch_code = excluded.branch_code, phone = excluded.phone, email = excluded.email, dob = excluded.dob, dept = excluded.dept,
        second_in_command = excluded.second_in_command, is_branch_head = excluded.is_branch_head, active = true, updated_at = now()
      returning (xmax = 0) into isnew;
      ns := ns + 1; seen := seen || (s->>'empId')::int;
      if isnew then nnew := nnew + 1; end if;
    end loop;
  end loop;
  update public.staff set active = false, updated_at = now() where active and not (emp_id = any(seen));
  get diagnostics ninact = row_count;
  update public.branches set active = false where active and not (code = any(bseen));
  return jsonb_build_object('branches', nb, 'staff', ns, 'new', nnew, 'inactivated', ninact);
end $$;
revoke execute on function daura_private.import_directory(jsonb) from authenticated, public;

create or replace function public.admin_import_directory(d jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare res jsonb;
begin
  if not daura_private.is_admin() then raise exception 'NOT_ALLOWED'; end if;
  res := daura_private.import_directory(d);
  perform daura_private.log('directory_imported', null, res);
  return res;
end $$;

create or replace function public.admin_people() returns table(
  emp_id int, name text, designation text, branch_code int, branch text, phone text, email text, dob text,
  role text, is_branch_head boolean, active boolean, blocked boolean, logins jsonb, last_seen timestamptz)
language sql stable security definer set search_path = public as $$
  select s.emp_id, s.name, s.designation, s.branch_code, b.name, s.phone, s.email, to_char(s.dob, 'DD-MM-YYYY'),
         s.role, s.is_branch_head, s.active, s.blocked,
         coalesce((select jsonb_agg(jsonb_build_object('gmail', l.gmail, 'via', l.linked_via, 'linked_at', l.linked_at, 'last_seen', l.last_seen) order by l.linked_at)
                   from public.staff_logins l where l.emp_id = s.emp_id), '[]'::jsonb),
         (select max(l.last_seen) from public.staff_logins l where l.emp_id = s.emp_id)
  from public.staff s left join public.branches b on b.code = s.branch_code
  where daura_private.is_admin()
  order by s.active desc, b.name, s.name
$$;

create or replace function public.admin_set_role(p_emp int, p_role text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not daura_private.is_admin() then raise exception 'NOT_ALLOWED'; end if;
  update public.staff set role = p_role, updated_at = now() where emp_id = p_emp;
  perform daura_private.log('role_set', p_emp::text, jsonb_build_object('role', p_role));
end $$;

create or replace function public.admin_set_blocked(p_emp int, p_blocked boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not daura_private.is_admin() then raise exception 'NOT_ALLOWED'; end if;
  if p_emp = daura_private.my_emp() then raise exception 'CANNOT_BLOCK_SELF'; end if;
  update public.staff set blocked = p_blocked, updated_at = now() where emp_id = p_emp;
  perform daura_private.log(case when p_blocked then 'person_blocked' else 'person_unblocked' end, p_emp::text, null);
end $$;

create or replace function public.admin_unlink(p_gmail text) returns void
language plpgsql security definer set search_path = public as $$
declare e int;
begin
  if not daura_private.is_admin() then raise exception 'NOT_ALLOWED'; end if;
  delete from public.staff_logins where gmail = lower(p_gmail) returning emp_id into e;
  perform daura_private.log('login_unlinked', e::text, jsonb_build_object('gmail', lower(p_gmail), 'by', 'admin'));
end $$;

create or replace function public.admin_link(p_gmail text, p_emp int) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not daura_private.is_admin() then raise exception 'NOT_ALLOWED'; end if;
  insert into public.staff_logins(gmail, emp_id, linked_via) values (lower(trim(p_gmail)), p_emp, 'admin')
  on conflict (gmail) do update set emp_id = excluded.emp_id, linked_via = 'admin', linked_at = now();
  perform daura_private.log('login_linked', p_emp::text, jsonb_build_object('gmail', lower(trim(p_gmail)), 'via', 'admin'));
end $$;

create or replace function public.admin_activity(p_limit int default 100) returns table(at timestamptz, actor_gmail text, actor text, action text, target text, target_name text, detail jsonb)
language sql stable security definer set search_path = public as $$
  select a.at, a.actor_gmail, s.name, a.action, a.target,
         (select x.name from public.staff x where a.target ~ '^\d+$' and x.emp_id = a.target::int), a.detail
  from public.activity_log a left join public.staff s on s.emp_id = a.actor_emp
  where daura_private.is_viewer()
  order by a.at desc limit least(greatest(p_limit, 1), 500)
$$;

-- Photo storage used, in bytes (for the 800 MB warning)
create or replace function public.admin_storage_bytes() returns bigint
language sql stable security definer set search_path = public, storage as $$
  select case when daura_private.is_viewer()
    then coalesce(sum((o.metadata ->> 'size')::bigint), 0) end
  from storage.objects o where o.bucket_id = 'photos'
$$;

-- ─────────────────────────────── default settings ───────────────────────────────

insert into public.settings(key, value) values
  ('entity_types',  '["Educational Institute","Hospital","Place of Worship","Trust","Government Office","Corporate","MSME","Other"]'),
  ('products',      '["Salary / payroll accounts","Savings / CASA","Current account","Term deposits","Home loan","Vehicle loan","Education loan","MSME / working capital","Gold loan","Insurance","Mutual funds","PMJJBY / PMSBY / APY","POS / QR / digital banking","Institution / trust accounts"]'),
  ('outcomes',      '["Interested","Follow-up needed","Not interested","Already our customer","Person not available"]'),
  ('closures',      '[{"key":"account_opened","label":"Account opened"},{"key":"rejected","label":"Rejected"},{"key":"not_feasible","label":"Not feasible"}]'),
  ('headcount_kinds','["Staff","Students","Beds","Members"]'),
  ('storage_warn_mb','800')
on conflict (key) do nothing;

-- Lock down function execution: only signed-in users, never anonymous visitors.
revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;

-- Keep-alive: the GitHub Action calls this every 5 days so the free project never pauses.
create or replace function public.ping() returns timestamptz language sql stable as $$ select now() $$;
grant execute on function public.ping() to anon;

-- Health check: every table must have row-level security on. This returns no rows when all is well.
select c.relname as table_without_rls from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity;
