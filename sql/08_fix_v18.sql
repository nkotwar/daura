-- ════════════════════════════════════════════════════════════════════════════
--  TASC Connect · fix: deleting a visit (or anything else) failed with
--  'record "old" has no field "visit_id"'. Run once in Supabase → SQL Editor. Safe to re-run.
-- ════════════════════════════════════════════════════════════════════════════
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

select 'Deleting works again' as status;
