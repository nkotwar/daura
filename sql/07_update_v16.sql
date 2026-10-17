-- ════════════════════════════════════════════════════════════════════════════
--  TASC Connect · database update for app version 16: push notifications of activity, for admins.
--  · admins' phones register for notifications (which kinds is their choice)
--  · every new visit is now recorded in Activity too
--  · push_payload() turns an Activity entry into a short notification; only the sender function can use it
--  Run once in Supabase → SQL Editor → New query → paste → Run. Safe to re-run.
-- ════════════════════════════════════════════════════════════════════════════

create table if not exists public.push_subscriptions (
  endpoint   text primary key,
  gmail      text not null,
  emp_id     int,
  keys       jsonb not null,
  kinds      text[] not null default '{visits,requests,alerts}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.push_subscriptions enable row level security;   -- no policies: only through the functions below
revoke all on public.push_subscriptions from anon, authenticated;

-- An admin's phone turns notifications on (or changes which kinds it wants)
create or replace function public.save_push_subscription(p_sub jsonb, p_kinds text[]) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not daura_private.is_admin() then raise exception 'NOT_ALLOWED'; end if;
  if coalesce(p_sub ->> 'endpoint', '') = '' or p_sub -> 'keys' is null then raise exception 'BAD_SUBSCRIPTION'; end if;
  insert into public.push_subscriptions(endpoint, gmail, emp_id, keys, kinds)
  values (p_sub ->> 'endpoint', daura_private.my_gmail(), daura_private.my_emp(), p_sub -> 'keys', coalesce(p_kinds, '{}'))
  on conflict (endpoint) do update set gmail = excluded.gmail, emp_id = excluded.emp_id, keys = excluded.keys,
    kinds = excluded.kinds, updated_at = now();
end $$;

create or replace function public.remove_push_subscription(p_endpoint text) returns void
language sql security definer set search_path = public as $$
  delete from public.push_subscriptions where endpoint = p_endpoint and gmail = daura_private.my_gmail()
$$;

create or replace function public.my_push_kinds(p_endpoint text) returns text[]
language sql stable security definer set search_path = public as $$
  select kinds from public.push_subscriptions where endpoint = p_endpoint and gmail = daura_private.my_gmail()
$$;

-- Every new visit is recorded in Activity (so it can show there and notify)
create or replace function daura_private.visit_logged() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform daura_private.log('visit_logged', new.id::text,
    jsonb_build_object('entity', (select name from public.entities where id = new.entity_id), 'visit_no', new.visit_no));
  return null;
end $$;
drop trigger if exists t_visit_logged on public.visits;
create trigger t_visit_logged after insert on public.visits for each row execute function daura_private.visit_logged();

-- One Activity entry → { kind, title, body, url, tag, actor_gmail } for a notification.
-- Only the sender function (service role) may call it.
create or replace function public.push_payload(p_id bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  a public.activity_log; actor text; who text; k text; t text; b text; u text := './';
  v record; r record;
  role text := coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '');
begin
  if role <> 'service_role' and not daura_private.is_admin() then raise exception 'NOT_ALLOWED'; end if;
  select * into a from public.activity_log where id = p_id;
  if not found then return null; end if;
  actor := coalesce(initcap(lower((select name from public.staff where emp_id = a.actor_emp))), a.actor_gmail, 'Someone');
  who := case when a.target ~ '^\d+$' then initcap(lower((select name from public.staff where emp_id = a.target::int))) end;
  if a.action = 'visit_logged' then
    select v2.visit_no, v2.outcome, v2.closure, e.name as ename into v
      from public.visits v2 join public.entities e on e.id = v2.entity_id where v2.id::text = a.target;
    k := 'visits';
    t := 'New visit · ' || coalesce(v.ename, a.detail ->> 'entity', 'a place');
    b := actor || ' · Visit ' || coalesce(v.visit_no::text, a.detail ->> 'visit_no', '1')
         || coalesce(' · ' || case v.closure when 'account_opened' then 'Account opened' when 'rejected' then 'Rejected'
                                             when 'not_feasible' then 'Not feasible' end, ' · ' || v.outcome, '');
    u := './?open=visit:' || a.target;
  elsif a.action = 'request_raised' then
    select rq.kind, rq.reason into r from public.requests rq where rq.id::text = a.target;
    k := 'requests';
    t := 'Request · ' || case r.kind when 'reassign' then 'reassign an allotment' when 'delete_assignment' then 'remove an allotment'
                                     when 'delete_visit' then 'delete a visit' when 'unverify' then 'unverify a visit' else 'new' end;
    b := actor || ': ' || coalesce(r.reason, '');
    u := './?go=admin:requests';
  elsif a.action in ('visit_verified', 'visit_unverified') then
    select e.name as ename, v2.visit_no into v from public.visits v2 join public.entities e on e.id = v2.entity_id where v2.id::text = a.target;
    k := 'verify';
    t := case when a.action = 'visit_verified' then 'Visit verified' else 'Visit unverified' end;
    b := actor || ' · ' || coalesce(v.ename || ' · Visit ' || v.visit_no, 'a visit');
    u := './?open=visit:' || a.target;
  elsif a.action = 'login_linked' then
    k := 'signins'; t := 'New sign-in';
    b := coalesce(who, 'Someone') || ' linked ' || coalesce(a.detail ->> 'gmail', 'a Gmail');
    u := './?go=admin:activity';
  elsif a.action = 'claim_failed' then
    k := 'alerts'; t := 'Wrong date of birth';
    b := coalesce(a.detail ->> 'gmail', 'Someone') || ' tried to open ' || coalesce(who, 'a') || '''s profile';
    u := './?go=admin:activity';
  else
    k := 'admin'; t := 'Admin activity';
    b := actor || ': ' || replace(a.action, '_', ' ') || coalesce(' · ' || who, '');
    u := './?go=admin:activity';
  end if;
  return jsonb_build_object('kind', k, 'title', t, 'body', left(b, 180), 'url', u, 'tag', a.action || ':' || coalesce(a.target, ''),
                            'actor_gmail', a.actor_gmail);
end $$;

revoke execute on function public.push_payload(bigint) from public, anon;
grant execute on function public.push_payload(bigint) to service_role;
revoke execute on function public.save_push_subscription(jsonb, text[]) from public, anon;
revoke execute on function public.remove_push_subscription(text) from public, anon;
revoke execute on function public.my_push_kinds(text) from public, anon;
grant execute on function public.save_push_subscription(jsonb, text[]) to authenticated;
grant execute on function public.remove_push_subscription(text) to authenticated;
grant execute on function public.my_push_kinds(text) to authenticated;
grant select, delete on public.push_subscriptions to service_role;

select 'TASC Connect database is up to date for version 16' as status;
