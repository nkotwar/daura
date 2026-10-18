-- ════════════════════════════════════════════════════════════════════════════
--  TASC Connect · database update for app version 33: viewers can sign in with their name too.
--  Only the admin needs Google sign-in now.
--  Run once in Supabase → SQL Editor → New query → paste → Run. Safe to re-run.
-- ════════════════════════════════════════════════════════════════════════════
create or replace function daura_private.is_viewer() returns boolean
language sql stable security definer set search_path = public as $$
  select daura_private.is_admin()
      or exists (select 1 from public.staff where emp_id = daura_private.my_emp() and role = 'viewer')
$$;

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
      'viewer', daura_private.is_viewer(), 'needs_google', dev and r.role = 'admin',
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

select 'TASC Connect database is up to date for version 33' as status;
