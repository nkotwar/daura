-- ════════════════════════════════════════════════════════════════════════════
--  TASC Connect · restores the rule "a follow-up visit can be added only after the latest visit is verified".
--  Needed only if sql/17_update_v49.sql was run (version 49 was rolled back). Safe to run either way, and to re-run.
--  Run in Supabase → SQL Editor → New query → paste → Run.
-- ════════════════════════════════════════════════════════════════════════════
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

select 'Follow-up rule restored' as status;
