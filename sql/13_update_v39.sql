-- ════════════════════════════════════════════════════════════════════════════
--  TASC Connect · database update for app version 39: the admin can delete a place.
--  Deleting a place also deletes its allotments and visit reports (and their photo records);
--  the app then removes the photo files. Recorded in Activity.
--  Run once in Supabase → SQL Editor → New query → paste → Run. Safe to re-run.
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.admin_delete_place(p_entity uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare e public.entities; paths text[]; nv int; na int;
begin
  if not daura_private.is_admin() then raise exception 'NOT_ALLOWED'; end if;
  select * into e from public.entities where id = p_entity;
  if not found then raise exception 'NOT_FOUND'; end if;
  select coalesce(array_agg(p.path), '{}') into paths from public.visit_photos p join public.visits v on v.id = p.visit_id where v.entity_id = p_entity;
  select count(*) into nv from public.visits where entity_id = p_entity;
  select count(*) into na from public.assignments where entity_id = p_entity;
  perform set_config('daura.bypass', 'on', true);   -- verified visits may be removed along with the place
  delete from public.entities where id = p_entity;   -- allotments, visits, photos, joint visitors go with it
  perform set_config('daura.bypass', '', true);
  perform daura_private.log('place_deleted', null, jsonb_build_object('entity', e.name, 'type', e.type, 'visits', nv, 'allotments', na));
  return jsonb_build_object('paths', to_jsonb(paths), 'visits', nv, 'allotments', na);
end $$;
revoke execute on function public.admin_delete_place(uuid) from public, anon;
grant execute on function public.admin_delete_place(uuid) to authenticated;

select 'TASC Connect database is up to date for version 39' as status;
