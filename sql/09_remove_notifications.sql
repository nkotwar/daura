-- ════════════════════════════════════════════════════════════════════════════
--  TASC Connect · removes the admin notifications added in version 16.
--  (New visits keep showing in Admin → Activity.)
--  Run once in Supabase → SQL Editor → New query → paste → Run. Safe to re-run.
-- ════════════════════════════════════════════════════════════════════════════
drop trigger if exists push_activity on public.activity_log;   -- the Database Webhook, if you created it
drop function if exists public.push_payload(bigint);
drop function if exists public.save_push_subscription(jsonb, text[]);
drop function if exists public.remove_push_subscription(text);
drop function if exists public.my_push_kinds(text);
drop table if exists public.push_subscriptions;

select 'Notifications removed' as status;
