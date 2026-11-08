-- Tiebreaker profile pictures: CHECK QUERIES. These only read; they change nothing. Run them after the five parts.
-- Run each numbered query on its own (SQL Editor > New query > paste one > Run).

-- CHECK 1. Is everything in place?  Every row must say true. (Failing rows are listed first.)
select name, ok from (values
  ('bucket "avatars" exists and is private',        exists (select 1 from storage.buckets where id = 'avatars' and public = false)),
  ('bucket size limit is set and at most 512 KB',   exists (select 1 from storage.buckets where id = 'avatars' and file_size_limit between 1 and 524288)),
  ('bucket allows only image/webp and image/jpeg',  exists (select 1 from storage.buckets where id = 'avatars' and cardinality(allowed_mime_types) = 2 and allowed_mime_types @> array['image/webp', 'image/jpeg'])),
  ('exactly 4 storage policies for avatars',        (select count(*) from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname like 'avatars:%') = 4),
  ('5 picture columns on profiles',                 (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'profiles' and column_name in ('avatar_status', 'avatar_version', 'avatar_uploaded_at', 'avatar_reviewed_at', 'avatar_flag')) = 5),
  ('4 picture tables with row security on',         (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname in ('avatar_uploads', 'avatar_tickets', 'avatar_reports', 'avatar_purge_queue') and c.relrowsecurity) = 4),
  ('picture triggers exist',                        (select count(*) from pg_trigger where tgname in ('avatar_reports_after_insert', 'profiles_avatar_cleanup') and not tgisinternal) = 2),
  ('players can call the 5 player functions',       has_function_privilege('authenticated', 'public.request_avatar_upload()', 'execute') and has_function_privilege('authenticated', 'public.confirm_avatar_uploaded()', 'execute') and has_function_privilege('authenticated', 'public.remove_my_avatar()', 'execute') and has_function_privilege('authenticated', 'public.get_avatar_info(text[])', 'execute') and has_function_privilege('authenticated', 'public.report_avatar(text)', 'execute')),
  ('guests cannot upload or report',                not has_function_privilege('anon', 'public.request_avatar_upload()', 'execute') and not has_function_privilege('anon', 'public.report_avatar(text)', 'execute')),
  ('players cannot call the admin functions',       not has_function_privilege('authenticated', 'public.admin_approve_picture(text)', 'execute') and not has_function_privilege('authenticated', 'public.admin_reject_picture(text)', 'execute') and not has_function_privilege('authenticated', 'public.admin_remove_picture(text)', 'execute') and not has_function_privilege('anon', 'public.admin_approve_picture(text)', 'execute')),
  ('players cannot use the clean-up functions',     not has_function_privilege('authenticated', 'public.take_avatar_purge_batch()', 'execute') and not has_function_privilege('authenticated', 'public.done_avatar_purge(text[])', 'execute')),
  ('service role can use admin and clean-up',       has_function_privilege('service_role', 'public.admin_approve_picture(text)', 'execute') and has_function_privilege('service_role', 'public.take_avatar_purge_batch()', 'execute') and has_function_privilege('service_role', 'public.done_avatar_purge(text[])', 'execute')),
  ('players cannot read the review view',           not has_table_privilege('authenticated', 'public.admin_pending_pictures', 'select') and has_table_privilege('service_role', 'public.admin_pending_pictures', 'select'))
) as t (name, ok)
order by ok, name;

-- CHECK 2. Pictures waiting for your decision (new uploads and reported pictures).
--   To look at one: Storage > avatars > tap the file whose name is storage_path.
--   Then:  select public.admin_approve_picture('name');   or   admin_reject_picture('name');   or   admin_remove_picture('name');
select * from public.admin_pending_pictures;

-- CHECK 3. How many pictures are in each state?
select avatar_status, count(*) as players from public.profiles group by avatar_status order by avatar_status;

-- CHECK 4. Files waiting to be deleted from storage by the purge-avatars function (should be 0 soon after it runs).
select count(*) as waiting_for_deletion from public.avatar_purge_queue;

-- CHECK 5. Files in the bucket that no player owns any more (should be 0, or a few waiting in CHECK 4).
select o.name as file, o.created_at
  from storage.objects o
 where o.bucket_id = 'avatars'
   and not exists (select 1 from public.profiles p where p.id::text = o.name)
 order by o.created_at;
