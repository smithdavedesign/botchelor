# Requested clips: your OC's date as a clip to post

Added 2026-11-20. Clips the show posts on its own new accounts get almost no views. A short vertical clip of someone's own date, posted to their own followers and credited to them, is what spreads. So after a date has aired, the owner of either character can ask for a clip of it. David's Mac renders it with the episode-cut pipeline, and the owner gets a notice with a page where they can download it, share it, and copy a suggested caption.

Code: `lib/clip-requests.ts` (the rules and the queue), `app/api/clips/` (the routes), `app/episodes/[id]/ClipRequest.tsx` and `app/clips/` (the pages), `scripts/clips/clip-queue.mjs` (the Mac's worker). Tests: `tests/clip-requests.test.ts` and `tests/clip-queue.test.ts`.

## The flow
1. **Ask.** On the episode page, the owner of one side sees "🎬 Post this date → Make a clip to post", below the predict and share area. The box is its own component, separate from the verdict card. Pressing it calls `POST /api/clips` with `{ episode_id, character_id }`. The request is added to `clip_requests` as `queued`.
2. **Render.** Every 5 minutes, launchd on the Mac runs `scripts/clips/clip-queue.mjs`. It claims the oldest queued request (`POST /api/clips/worker/claim`). The claim leases the request to the worker for 20 minutes, marks it `rendering`, and returns the date as a stranger sees it once it has aired, along with the credit and the caption. The worker then:
   - cuts the date the way the daily episode is cut (`daily-episode.mjs autoEdl`), outside the daily series: no "Day N" label, the cold open labelled "A blind date on Botchelor", and a closing card ("Make your own character. Send them on a date.") with the credit under it;
   - renders it with `episode-cut.mjs renderCut` at 1080×1920, 30 fps, with the voices. Its new `credit` option burns the credit line into the top of every frame (`frameHtml`), so the credit stays on the video wherever it's reposted.
3. **Send back.** The worker posts the MP4 and its cover to `POST /api/clips/worker/done`. The app stores them in the show's media store (`lib/object-store.ts keepBytes`, area `clips`), or in the row itself when no store is configured. The request becomes `ready`, and the owner gets a notification of kind `date_clip` ("🎬 Your clip of A × B is ready", type Showcase). It is also emailed at once if they turned email on. The notice links to `/clips/<id>`.
4. **Post.** `/clips/<id>` and the episode box show the video with:
   - **Download** (`/api/clips/<id>/clip.mp4?download=1`, sent as an attachment);
   - **Share**: the phone's share sheet with the file itself (`navigator.share` with `files`), with the caption also copied to the clipboard. Where files can't be shared, it shares the page instead;
   - the suggested caption, with **Copy caption**.

   While a clip is waiting, the box checks every 15 seconds and says "Rendering your clip. We'll tell you when it's ready."

When a render fails, the worker reports it to `POST /api/clips/worker/failed`:
- **Passing trouble** (a voice service, the network) is reported with `retry`, and the request goes back in the queue. It gets up to 3 attempts in all.
- **A date it can't cut** (fewer than 4 spoken lines, or a cut over the length limit) fails for good. The owner is told, a bought date it used is given back, and they can ask again.
- **A render that goes quiet** (the Mac slept or crashed) is claimed again once its lease runs out.

## The rules
- **Only the owner** of one of the date's two characters, for that character.
- **Only a finished date that can be shared**, under the same rule as the owner's own share of a date (`ShareEnding`):
  - it has aired and is ready;
  - it is public or unlisted, never private;
  - it never carried an After Dark memory (`setup.after_dark`);
  - it has no open report;
  - neither character is private or one of our test characters (`lib/our-traffic.ts`).

  These rules are checked again when the Mac claims the request. A date made private or reported since then fails its request, and any bought date it used is refunded.
- **One live request per date and person.** Asking again returns the request already in the queue, rendering, or ready, and it is never charged twice. Only a failed request can be asked for again.
- **First clip free per account.** A free clip that failed doesn't count as used. After that:
  - with the **Companion Plan** (or as an admin), clips are included (`lib/writing-style.ts hasDepth`);
  - otherwise, each clip costs **1 bought date** (`lib/allowance.ts spendBoughtTokens`, the same paywall as intro clips and stories), refunded if the clip fails.

  Botchelor Plus doesn't exist yet: `lib/plus-interest.ts` is only an interest tile. When it launches, add it to `nextClipCharge`.
- **Daily cap** for everyone together: `CLIP_REQUESTS_DAILY` (default 20) requests per UTC day, because one Mac renders them all.
- **Who can watch.** The owner can always open their clip. Anyone with the link can open it only while the date itself can still be opened by link: aired, public or unlisted, not hidden by reports, and both characters public. A date that is taken down takes its clip with it. The files are never kept by shared caches, and `/clips/<id>` is `noindex`.
- **Their words stay theirs.** The clip quotes only the date's own lines, as whole sentences, with gaps marked "…". The credit and the caption are the show's words, built from the person's public creator page (`creator_profiles`, when not hidden):
  - **credit:** "Nell by @handle · botchelor.com", or "Nell · made on botchelor.com" with no creator page. A login handle is never used.
  - **caption:** names the maker, and names the other character's maker only on a public date where that date's page already credits them.
- **Never After Dark.** No clip is made of an After Dark date, and none of these routes answer on After Dark's own host.
- **The account.** Requests appear in the account export (`clips`). Deleting the account removes their files from the store and then the rows. Claiming an anonymous identity moves its requests to the account.

## Configuration

| Variable | Where | What |
| --- | --- | --- |
| `CLIP_REQUESTS` | the show's app | `1` turns the feature on: the episode box, `POST /api/clips` and the worker's claims. Unset or anything else means off. |
| `CLIP_REQUESTS_DAILY` | the show's app | Requests allowed per UTC day, for everyone together. Default 20. |
| `CLIP_WORKER_SECRET` | the show's app, and the Mac's keychain | The worker's `Authorization: Bearer` secret, at least 16 characters. Unset or shorter, the worker routes answer 404. |

## Running the worker on the Mac
It runs in the house crowd's clone (`~/.botchelor-crowd/repo`) under launchd, like the daily clip. It costs nothing beyond the voices: Chromium and ffmpeg run locally, and Kokoro on Venice costs about a cent per clip (macOS `say` stands in when Venice is down). It never calls a paid render or video API.

One-time setup, once `CLIP_REQUESTS=1` and `CLIP_WORKER_SECRET` are set on the show's app:

```
security add-generic-password -s vault/botchelor/CLIP_WORKER_SECRET -a botchelor -w   # paste the same secret when asked
echo 'CLIP_QUEUE=1' >> ~/.botchelor-crowd/env
scripts/crowd/install.sh                      # adds com.user.botchelor-clip-queue: every 5 minutes
```

By hand: `node scripts/clips/clip-queue.mjs` renders every queued request and stops. `--once` renders at most one, and `--watch` keeps polling every minute. `CROWD_BASE`, `SAY=1`, `CHROMIUM_PATH` and `FFMPEG` work as for the other clips.

Logs go to `~/.botchelor-crowd/logs/clip-queue.log`. To pause the worker, remove `CLIP_QUEUE=1` from the env file and run the installer again. To stop requests on the site, unset `CLIP_REQUESTS`.

Rendered files go to a temporary folder and are deleted once they've been sent: they belong to the person who asked, and from then on they live in the show's media store.
