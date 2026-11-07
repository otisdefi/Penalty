# Supabase setup for accounts and chat

Players sign up with a **username and password only**. No email is asked, stored or shown: the app turns the
username into a placeholder identity (`name@players.tiebreaker.invalid`) that can never receive mail.

Everything below is done once, in the Supabase dashboard and in Vercel. No secret goes into the code.

## 1. Create the project and copy two public values

1. Create a project at https://supabase.com (the free plan is enough).
2. **Project Settings > API**: copy the **Project URL** and the **anon / publishable key**.
3. Put them in Vercel (Project > Settings > Environment Variables, for Production, Preview and Development):
   - `VITE_SUPABASE_URL` = the Project URL
   - `VITE_SUPABASE_ANON_KEY` = the anon / publishable key
4. **Never** use the `service_role` key anywhere in the app or in Vercel's `VITE_` variables.

Without these two values the app shows "Chat is not configured" and everything else still works.

## 2. Create the tables, rules and moderation tools

**SQL Editor > New query**: paste the whole of `supabase/schema.sql` and press **Run**. It is safe to run again.
It creates the profiles, messages, reports and recovery tables with Row Level Security, the chat rules
(200 characters, 1 message per 2 seconds, 20 per minute, no links, emails or phone numbers, profanity filter),
the "Report" auto-hide (5 different reporters), and the owner tools listed in step 7.

## 3. Turn off email confirmation (required)

**Authentication > Sign In / Providers > Email**:

- **Confirm email**: turn **OFF** (otherwise sign-up waits for an email that can never arrive).
- **Minimum password length**: set to **8**.
- Leave **Allow new users to sign up** ON.
- Make sure **Anonymous sign-ins** and every other provider are OFF.

## 4. Bot protection on sign-up (Cloudflare Turnstile)

1. Cloudflare dashboard > **Turnstile** > **Add widget**. Add your site's domain (your Vercel domain, and `localhost` while testing).
   You get a **Site key** (public) and a **Secret key** (private).
2. Supabase: **Authentication > Attack Protection > Enable CAPTCHA protection**, provider **Turnstile**, paste the **Secret key**.
3. Vercel: add `VITE_TURNSTILE_SITE_KEY` = the **Site key**.

Supabase then checks the CAPTCHA on sign-up, sign-in and password change. The Site key is public by design; the Secret key
stays in Supabase (and in step 5) and never in the app. Without a Site key the forms show no CAPTCHA, so do not enable
CAPTCHA in Supabase unless the Site key is set in Vercel.

## 5. Deploy the password-reset function

This is the server-side function that checks the recovery code and sets the new password. It is the only place the
service-role key is used, and Supabase injects that key itself.

**Edge Functions > Deploy a new function > Via Editor**: name it exactly `reset-password`, paste
`supabase/functions/reset-password/index.ts`, and deploy. Keep **Verify JWT** on.

Optional secrets (**Edge Functions > Secrets**):
- `TURNSTILE_SECRET_KEY` = the Turnstile **Secret key** (then reset also requires the CAPTCHA)
- `ALLOWED_ORIGIN` = your site's address, for example `https://your-app.vercel.app`

(With the CLI instead: `supabase functions deploy reset-password`.)

## 6. Realtime

`schema.sql` already adds the `messages` table to the `supabase_realtime` publication. Check **Database > Publications**
if live updates do not appear.

## 7. Moderating (you, the owner)

Run these in the **SQL Editor** (players cannot call them):

```sql
select * from public.admin_reports order by reported_at desc;      -- what players reported
select public.admin_hide_message(123);                              -- hide one message (id from the list above)
select public.admin_unhide_message(123);
select public.admin_ban_user('somename', 'spam');                   -- ban: hides all their messages and blocks sign-in
select public.admin_unban_user('somename');
insert into public.blocked_terms (term, whole_word) values ('badword', false);   -- add to the profanity list
```

A message reported by 5 different players is hidden automatically until you review it.
Optional clean-up of old messages (Database > Extensions > enable `pg_cron`, then):

```sql
select cron.schedule('trim-chat', '0 4 * * *', $$delete from public.messages where created_at < now() - interval '30 days'$$);
```

## If sign-up says "not set up correctly"

Supabase rejected the placeholder address. The domain `players.tiebreaker.invalid` appears in two places and must match:
`IDENTITY_DOMAIN` in `src/chat/config.ts` and the `handle_new_user` function in `supabase/schema.sql`. Change both to another
domain you do not use for real mail, re-run the SQL, and redeploy.

## What is stored

| Table | Contains |
|---|---|
| `auth.users` (Supabase) | the placeholder identity and the password **hash** |
| `public.profiles` | username, ban flag |
| `public.messages` | channel, username, text, time |
| `public.reports` | who reported which message |
| `private.recovery` | a SHA-256 hash of the recovery code (the code itself is never stored) |

Deleting an account removes all of it, including the player's messages.
