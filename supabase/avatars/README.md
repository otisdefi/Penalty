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

## Automatic picture checks (no manual review for clear cases)

After an upload the picture is "pending" (only its owner can see it). The app then calls the **check-avatar** Edge Function
(Verify JWT on, so it runs as the signed-in player). The function reads the player's own file with the service role, sends it
to an image moderation service, and applies the answer through the database:

| Answer | What happens |
|---|---|
| clearly safe | approved at once, public |
| flagged (nudity, violence, hate symbols, weapons, ...) | rejected, the file is deleted (queued for the purge function) |
| unsure, the service is down, or the answer is not understood | stays **pending**: the owner sees "Waiting for review" and you decide (`admin_pending_pictures`, which now has a `last_check` column) |

Extra protection, all in the database: only accounts older than 24 hours may upload; 3 uploads a day; only the service role
can set "approved" or "rejected" (a player can never approve their own picture); a picture that was **reported** is never
approved automatically (a person decides); after **any** report on an approved picture the reporter's app asks for a fresh
check (flagged = removed, unsure = hidden for your review, safe or service down = stays), and 3 different reporters still hide a
picture at once. Each picture version is checked at most 3 times, so nobody can run up your bill.

### Run order (after the 5 avatar parts and, if you used it, `avatars_fix1_upload_returning.sql`)
1. SQL Editor: `moderation_part1_of_2.sql` (last line `-- END OF PART 1 OF 2`), then `moderation_part2_of_2.sql` (last line `-- END OF PART 2 OF 2`). Both are safe to run again.
2. SQL Editor: CHECK 1 in `moderation_checks.sql`. Every row must say true.
3. Deploy the Edge Function `supabase/functions/check-avatar/index.ts` (same steps as purge-avatars below: Edge Functions, Deploy a new function, Via Editor, name `check-avatar`, paste, Deploy, keep Verify JWT on).
4. Add the secrets below (Edge Functions, Secrets). Without a provider configured nothing is approved automatically: every picture just stays pending, as before.
5. Upload a test picture from an account older than 24 hours. Open Edge Functions, check-avatar, Logs: you should see a line like `{"check":"upload","provider":"sightengine","verdict":"safe","decision":"approved"}`.

### Which service (free limits read from the providers' own pages; they change, so read the terms before you rely on them)
| Service | Free allowance | Sees | Notes and where to read the terms |
|---|---|---|---|
| **Sightengine** (default) | 2,000 operations a month, max 500 a day, 1 request a second, no time limit, no card | nudity, hate symbols and offensive gestures, gore, weapons; optional: minors (`face-attributes`), self-harm, violence | One operation per model per picture. The default 4 models = 4 operations, about 500 pictures a month. https://sightengine.com/pricing, docs https://sightengine.com/docs/ |
| **OpenAI omni-moderation** | free to use; free tier 250 requests a minute and 5,000 a day; images up to 20 MB | for images only: sexual, violence, graphic violence, self-harm. **Not** hate symbols and **not** minors | Good as a free second opinion. https://developers.openai.com/api/docs/guides/moderation |
| **Azure AI Content Safety** | 5,000 images a month, 5 requests a second; stops at the limit | hate, sexual, violence, self-harm with severity levels | Needs an Azure account with a payment card. https://azure.microsoft.com/pricing/details/cognitive-services/content-safety/, docs https://learn.microsoft.com/azure/ai-services/content-safety/ |
| Google Cloud Vision SafeSearch, AWS Rekognition | 1,000 units / 1,000 images a month (AWS: first 12 months) | adult, violence, racy, spoof, medical | Not built in; add one function next to `sightengine`, `openai` and `azure` in `PROVIDERS` and register it there. |

Each service's full Terms of Service are linked at the bottom of its website. The picture itself is sent to the service you choose
(the upload screen says so: "Pictures are checked automatically by a safety service"). Start with `sightengine`; for a free second
opinion use `sightengine,openai` (the strictest answer wins, and a service that fails counts as "not clearly safe").

### Exact secret names (Dashboard, Edge Functions, Secrets, Add new secret; on a phone: open the project, the menu, Edge Functions, Secrets)
| Secret | Value |
|---|---|
| `MODERATION_PROVIDER` | `sightengine` (default), `openai`, `azure`, or a list like `sightengine,openai` |
| `SIGHTENGINE_API_USER`, `SIGHTENGINE_API_SECRET` | from sightengine.com, Dashboard, API keys |
| `SIGHTENGINE_MODELS` (optional) | default `nudity-2.1,offensive,gore-2.0,weapon`; add `face-attributes` for minors, `self-harm`, `violence` |
| `OPENAI_API_KEY` | platform.openai.com, API keys, Create new secret key |
| `AZURE_CONTENT_SAFETY_ENDPOINT`, `AZURE_CONTENT_SAFETY_KEY` | Azure portal, your Content Safety resource, Keys and Endpoint (endpoint looks like `https://NAME.cognitiveservices.azure.com`) |

Keys live only in these secrets: not in the repo, not in the app, and never sent to the browser. `SUPABASE_URL` and
`SUPABASE_SERVICE_ROLE_KEY` are provided by Supabase to the function itself.

### Honest limits
The three adapters follow each service's published request and answer formats and are tested here against sample answers shaped
like their documentation, not against the live services (no keys in the build environment). Anything the function does not
understand counts as an error, which keeps the picture pending: it can never approve something it could not read. Check the first
few uploads in the function logs. Only the owner's app or a reporter's app can trigger a check; if that call never happens
(network loss), the picture just stays pending and appears in your review list.

