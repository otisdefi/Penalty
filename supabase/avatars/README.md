# Profile pictures: setup, in order

Everything here is safe to run again. Nothing needs a secret: the service-role key stays inside Supabase.

## Run order

1. `supabase/schema.sql` (once, you already did this)
2. `supabase/profiles_challenges.sql`, or its five files in `supabase/parts/` (you already did this)
3. `supabase/avatars/avatars_part1_of_5.sql`, then `part2`, `part3`, `part4`, `part5`, each in its own SQL Editor query.
   Each part ends with `-- END OF PART n OF 5`; check your paste ends with that line. A part refuses to run
   if an earlier one is missing.
4. Look at the storage bucket (steps below). Part 1 already creates it, so this is a check, not a task.
5. Run **CHECK 1** from `supabase/avatars/avatars_checks.sql`. Every row must say `t` (true).
6. Deploy the `purge-avatars` function (steps below).
7. Open the app and upload a test picture (needs the app update from the next step of this work).

## The storage bucket, from a phone

Part 1 creates a private bucket called `avatars` (limit 512 KB, only WebP and JPEG). To check it by hand:

1. Open supabase.com/dashboard in your phone browser and tap your project. If the page looks cramped, switch the
   browser to "Desktop site".
2. Open the menu and tap **Storage**.
3. You should see a bucket named **avatars** with a lock or "Private" label. Tap the three dots next to it, then
   **Edit bucket**, and confirm:
   - **Public bucket**: OFF
   - **Restrict file upload size**: ON, 0.5 MB (512 KB)
   - **Restrict MIME types**: ON, `image/webp, image/jpeg`

   Tap **Save** if you changed anything.
4. If there is no `avatars` bucket (part 1 was not run): tap **New bucket**, name it exactly `avatars`, leave
   **Public bucket** OFF, switch on the size limit (0.5 MB) and the MIME types above, then **Create bucket**.
   Run part 1 afterwards anyway; it makes the bucket match.
5. Tap **Policies** (in the Storage menu). Under `avatars` you should see exactly four policies:
   `avatars: upload own`, `avatars: replace own`, `avatars: read allowed`, `avatars: delete own`.
   They come from part 2. Do not add or edit policies there, and never use "Make public".

Menu names vary a little between dashboard versions; the settings above are what matter.

## Reviewing pictures (about once a day)

1. SQL Editor, run: `select * from public.admin_pending_pictures;`
2. To look at a picture: Storage > avatars > tap the file whose name equals `storage_path` in that result.
3. Decide:
   - `select public.admin_approve_picture('username');`
   - `select public.admin_reject_picture('username');` (deleted from storage soon after)
   - `select public.admin_remove_picture('username');` (the player gets the default avatar)

A picture reported by 3 different players is hidden automatically and shows up in the same list with why = `reported`.
Banned players' pictures are hidden from everyone.

## The purge-avatars function

Supabase will not delete storage files from SQL, so rejected and removed pictures (and pictures of deleted accounts)
are queued, and this function deletes them through the Storage API.

1. Dashboard > **Edge Functions** > **Deploy a new function** > **Via Editor**.
2. Name it exactly `purge-avatars`.
3. Delete the template code, paste all of `supabase/functions/purge-avatars/index.ts`, tap **Deploy function**.
   Keep "Verify JWT" on. There are no secrets to add.
4. Check it: open `https://YOUR-PROJECT.supabase.co/functions/v1/purge-avatars` in the browser. A 401 or 405 means it
   is deployed. A 404 means the name is wrong.
5. The app calls it quietly (at most once every 30 minutes per device), so the queue empties by itself.
   CHECK 4 shows how many files are still waiting.

If you see "Invalid JWT": use the legacy `anon` key (starts with `eyJ`) in the app, or turn "Verify JWT" off for this
function. It is safe either way: it only deletes files the database has already queued.

## What the database enforces (not just the app)

- One file per player, named by the player's user id, in a private bucket; only WebP or JPEG, at most 512 KB.
- An upload needs a short-lived ticket from `request_avatar_upload()`: signed in, not banned, at most 3 per day.
- A new or changed picture is `pending`: only its owner can see it. It becomes public only after you approve it.
- Other signed-in players can read only approved pictures of players who are not banned and have not blocked them.
- Guests never read pictures; they see a default avatar made from the player's jersey colours and number.

## If the first upload failed with HTTP 400 ("new row violates row-level security policy")

Storage reads the new file row back right after writing it, and the first version of the read rule only allowed a picture
that was already pending or approved. Run `supabase/avatars/avatars_fix1_upload_returning.sql` once (SQL Editor, new query,
paste, Run; it is safe to run again). New installs already get the fix in part 2. After it, the upload should succeed.
The upload screen now also shows the real error under the message (step, text, HTTP status and code) and writes it to the
browser console as `[avatar upload]`; if it fails again, send me that line.
