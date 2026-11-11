-- Checks for the automatic picture checks. Read-only: nothing here changes data. Run in the SQL Editor.

-- CHECK 1. Is everything in place?  Every row must say true. (Failing rows are listed first.)
select name, ok from (values
  ('check log table exists with row security on',   exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname = 'avatar_moderation_log' and c.relrowsecurity)),
  ('players cannot read the check log',             not has_table_privilege('authenticated', 'public.avatar_moderation_log', 'select') and not has_table_privilege('anon', 'public.avatar_moderation_log', 'select')),
  ('players cannot write the picture status',       not has_column_privilege('authenticated', 'public.profiles', 'avatar_status', 'update') and not has_column_privilege('anon', 'public.profiles', 'avatar_status', 'update')),
  ('players cannot call the two check functions',   not has_function_privilege('authenticated', 'public.moderation_claim(uuid,text,uuid)', 'execute') and not has_function_privilege('authenticated', 'public.moderation_decide(uuid,bigint,text,text,text,text)', 'execute') and not has_function_privilege('anon', 'public.moderation_decide(uuid,bigint,text,text,text,text)', 'execute')),
  ('service role can call them',                    has_function_privilege('service_role', 'public.moderation_claim(uuid,text,uuid)', 'execute') and has_function_privilege('service_role', 'public.moderation_decide(uuid,bigint,text,text,text,text)', 'execute')),
  ('24 hour account rule is active',                position('avatar_account_new' in pg_get_functiondef('public.request_avatar_upload()'::regprocedure)) > 0),
  ('3 uploads a day rule is still active',          position('avatar_limit_day' in pg_get_functiondef('public.request_avatar_upload()'::regprocedure)) > 0),
  ('review list shows the last automatic check',    exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'admin_pending_pictures' and column_name = 'last_check')),
  ('report auto-hide trigger is still there',       exists (select 1 from pg_trigger where tgname = 'avatar_reports_after_insert' and not tgisinternal))
) as t (name, ok)
order by ok, name;

-- CHECK 2. The last 20 automatic checks (no pictures, only the decision and a short reason).
select created_at, mode, provider, verdict, decision, reasons from public.avatar_moderation_log order by id desc limit 20;

-- CHECK 3. Pictures waiting for you (new uploads the service was unsure about, or could not check, and reported ones).
select * from public.admin_pending_pictures;
