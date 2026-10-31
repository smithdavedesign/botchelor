# Full audit, 2026-10-31: After Dark first, then the show

David's ask (2026-10-31, 06:00 UTC): "do a full audit of NSFW, all features, create two new characters and use them as
your test cases. I want everything working perfectly, also your opinion on the product, the UX/UI, any issues,
everything. See the changes that just went in, watch the logs. Feel free to use any generations for your tests. After
that do the other side, the safe side, same audit."

Run as an admin test account (`nightaudit`) on the live site, in a real browser (gstack), with the DigitalOcean run
logs polled every minute. Two characters were made through /create as a person would: **Vesper Lindqvist** (31, she/her,
a lighthouse restorer, `ec97336d…`) and **Teodor Abalos-Ferreira** (34, he/him, a night-shift ferry captain, `00636e8a…`).
Every generation below was paid for by the show's own keys (David's authorisation for this audit).

This document is written for David and for whoever picks up the follow-ups. The running notes, screenshots and pictures
are in the session's scratchpad (`/private/tmp/claude-501/audit/`); the fixes shipped tonight are PR #1067.

## The short version

After Dark works. The night ran from first lines to stage 4 across the pier, the ferry and the bridge, steered by nudges,
a whisper and a direct instruction, with chapter and moment pictures that kept both faces, voices, living faces, a
talking moment and a published showcase post along the way. The writing is in character and remembers the sheets.
That part of the product is real.

Six things are not fine, in order:

1. **botchelor.com went down for ~5 minutes at 08:01 UTC** (Cloudflare and the DigitalOcean ingress both answered 504,
   DO's own health said "HEALTHY"). It came back on its own at 08:06, as the merge of #1067 started a deploy. Nothing
   paged anyone. Probable cause found (56 avatars from /graph, each a full-size resize on a 1-vCPU replica) and fixed
   in #1068, verified live. See *Outage* below.
2. **The default face model changed a character's ethnicity.** Teo's look says Black; the show portrait (fal) is a
   Black man; "Draw 3" on the default After Dark face model (Lustify) gave three light-skinned Mediterranean men, 0/3,
   because pictures were given the tile's label ("Black") and not its words. *Fixed in #1072 and verified live: 3/3.*
3. **A Studio shoot sent none of its picks** (pose, wardrobe, place, light) because a late "remembered picks" restore
   wiped them; every shoot came back as copies of the body reference. *Fixed in #1067.* Separately, the default shoot
   model copied the body reference's pose and clothes and only swapped the background. *Fixed in #1072 (F24).*
4. **The "Safe for work" showcase serves a post rated Suggestive that reads as explicit** (lingerie, visible fluids) to
   every signed-in person. 23 live posts carry that rating. *The line is tightened and reel shots can no longer be
   moved to the safe side by the check (#1072); the re-check of the 23 is one command, yours (Still open).*
5. **Explicit moment pictures at stage 4 fall apart** (one character drawn twice, the other missing) while the PG and
   undressing pictures are excellent. Hive passes them because everyone is an adult; nobody checks composition.
6. **A movie made from the theater stalls.** Its shots are collected only while the 🎞 Videos list is on screen, and
   "Make the movie" puts the user back in the theater; Replicate drops uncollected shots after 30 minutes, with the
   7 tokens. Tonight's six shots sat finished for 20 minutes. *Fixed in #1070* for an open page and *in #1072* for a
   closed one: the host now collects by itself (F42).

Everything else is polish, listed below with severity. Nine of the smaller ones are fixed in #1067, two in #1070 and
eight more in #1072 (see *Round two*). What is left for David is money, a production write, or needs a second
subscriber or a real phone.

## Outage (critical)

- 08:01:30 UTC: every page on botchelor.com → Cloudflare 504. `/api/health` 504 both through Cloudflare and on the
  ingress hostname `botchelor-show-t9g76.ondigitalocean.app` (0.2–0.5 s, so a gateway answer, not a slow origin).
- DO: deployment ACTIVE (d52b04f), none in progress; `GET /v2/apps/{id}/health` said `web: HEALTHY, 1/1 ready, CPU 9 %,
  memory 31 %` the whole time. The run log stopped at 08:01:34 and shows no restart.
- ad.botchelor.com (same code, its own app) stayed up.
- 08:05:48: #1067 merged → deploy_on_push build started. 08:06:23: botchelor.com 200 again, before that build finished.
- A manual redeploy from here was blocked by the session's permission classifier (production deploy); a desktop
  notification went out, Remote Control was off so nothing reached a phone.
- Last requests before it died: my read-only sweep, ending on /graph (the Constellation), which timed out at 15 s.
  `cachedConstellation` runs `communities()` and `triangles()` over every public pair; on a 1-vCPU / 1 GB instance that
  is the kind of request that can pin the event loop. Not proven: after the recovery, /graph signed in took 1.1 s cold
  and 0.8 s warm with health at 0.3 s right after, so if it was the trigger it needed something else alongside (the two
  episode jobs that finished at 07:57 and 07:59 with 276k and 97k input tokens, or the deploy's memory profile).

**It happened again at 08:16**, right after the fresh deploy (ready 08:09:38) and right after a real browser opened
/graph; it recovered at 08:18:47. The sequence was the same both times: a browser opens /graph, the browser hangs, the
site fast-fails for minutes, DO's health stays green.

**Probable cause.** /graph's HTML carries 63 `<img>`s, 56 unique `/api/assets/<id>?w=40`. Each one was answered by
loading the full portrait as a base64 data URL from `character_assets.url` (megabytes of text) and resizing it with
sharp on the request; Cloudflare marks them `DYNAMIC` (no extension, so no edge cache despite `public, immutable`).
Sequentially (curl) they take 0.1 s each, which is why curl never reproduced it. A browser over HTTP/2 fires all 56 at
once at a 1-vCPU / 1 GB replica; the decodes thrash, requests stall, and the gateway's outlier detection ejects the only
upstream and fast-fails everything for its cooldown while the pod-local health check (a light in-process endpoint)
keeps passing.

**Fix shipped (this branch):** a `character_asset_thumbs` cache: each small copy is made once and kept, later asks are
a 2 KB row read with no decode; resizes run three at a time. The gate check now reads only the asset's head columns, so
a cached avatar never loads the data URL at all.

What to do besides: (a) an uptime alert that reaches David's phone (the RepoHQ probe already hits botchelor.com; make its
failure page him), (b) a Cloudflare cache rule for `/api/assets/*` so the edge serves the immutable copies (David's
dashboard), (c) a second replica for the show app ($12 → $24) so one stuck replica is a blip, (d) ask DO why its health
stayed green while its gateway returned 504.

## After Dark: what was tested and how it went

The flow, in the order a new subscriber would meet it.

| Step | Result |
|---|---|
| Sign-in hop show → ad.botchelor.com | Works (carry nonce). The nav's token meter says "◈ 0 tokens" in red on After Dark while the show says "3 dates left" for the same account (F12). |
| After Dark home | Pair picker, who's in, writer picker, Shared, Privacy (blur on, neutral title, PIN off). Phone: a "Continue · Teodor × Vesper · 'Then stop talking.' · 40 lines · just now" card, exactly right. |
| Switching own characters in | Two "Out" checkboxes, no confirmation needed. Fine. |
| Theater before Studio setup | Two flat colour blocks for the pair although both have show portraits (F13). The start card says "○ face · ○ body — Set up in the Studio →" twice. |
| Studio › Identity: Draw 3 faces | 23–37 s. Lustify (default) ignored Teo's ethnicity (F17, high). Vesper's three honoured the look but two of three were topless pin-ups for a *face* reference (O3). Candidates render below the limits, off-screen, after a draw (F16, fixed). Every candidate is a 2.9–3.8 MB PNG in a grid (F15). The checklist's copy contradicts the face card's (F14, fixed). |
| Body reference (Make 2, dressed) | 17–19 s, "Use as body" 3.4 s. Good copy: "dressed, so pictures from sex on use her nude picture instead". |
| Scene & roleplay picker | 142 venues, categories, tags, 20 roleplays per place, "Make your own". The best screen in the product. |
| First step (DeepSeek opening) | 6 lines in ~8 s, both voices right from line one. |
| Typed nudge | Landed exactly ("stepping closer to adjust the collar"), 48 s on GLM-4.6. |
| Suggested moves (Surprise me / Flirt / Spicy) | Escalate sensibly; "They finally kiss" → the kiss on Vesper's own terms. |
| Whisper to one of them | Landed verbatim in her voice two lines later; the other picked it up; the place moved; a picture was drawn for the move. The best steering tool here. |
| Direct steer | Arrived one beat short of the instruction ("Lock it." at the door, not in the chair): a strong nudge, not "done now" (F26). |
| Rewind / Redo | Rewind 28 → 22 lines, suggestions refreshed; Redo rewrites the last step in place (consistent with the doc; a word on the button would help). |
| Chapter pictures | Drawn on their own at the start and at each move: pier + lit ferry, both faces held, props from the lines (notebook). Excellent. |
| Beat offers ("Picture this moment?") | An editable brief (what's happening, what they're wearing, where, mood, anything else) with a "What will be sent" preview. Better than any competitor's generate button. The undressing picture (kiss, cardigan off the shoulder) is excellent; the stage-4 one is broken (F28, high); the brief's attire says "nothing" from stage 4 even when the lines still have jeans on (F27). |
| Draw ahead | Price 0 for an admin, 4 pictures a chapter; drew the offered "position" moment within 10 s. |
| Autoplay | Writes ahead while playback keeps up; a background tab pauses playback so the night stalls (by design, but say so). |
| Bring them to life | 7 expressions + a living loop each in ~5 min, no failures. |
| Listen / voices / place sound | Voice line in 5.4 s, place sound ready, "Stop listening" state. A made-up venue id also starts a sound generation (F25). |
| Talking moment | 202 accepted, ready in ~30 s: 10 s, 828×1114 h264 + AAC, lip-synced, consistent face. |
| Stage caption | Cut mid-word at 40 chars ("…leave for the ferr") (F21, fixed); `/api/sets/<free text>` 404s on every step (F20). |
| ⋯ menu | Outside tap closes it, Escape didn't (F22, fixed). |
| Discreet blur | Covered the Studio's stock look tiles too, so "Buzz cut" was unreadable (F18, fixed). Default-on blur makes an admin's first theater a fog (O4). |
| Studio › Shoot | Picks wiped by the late restore (F23, high, fixed); with picks in the prompt the default edit model keeps the body-ref pose/outfit and only changes the background (F24, high, product call). "Drawing…" with no progress for 30–60 s (timing note). |
| Studio › Together | The night's pair pictures with a 12-button action bar per thumbnail (Use on dates, Tags, Shoot like this, Download, Caption, ☆, Publish, 👍/👎, Fix faces, SFW twin, Animate…). Rich; too many for a phone. |
| 📣 Publish | Fetches the creator profile and shows the handle form inline; the first time the only sign is a small fieldset in the card. After a handle, POST /api/showcase/posts 200; the post was live on /showcase under @nightaudit. |
| Admin settings / library / providers | Complete and readable. The library lists 306 items with model, rating and character filters. |
| Phone (375 px) | AD home, theater, Studio: no horizontal overflow; layouts hold. |

### After Dark findings

High
- **F17** Default Recast model (Lustify · Venice) ignores the look's ethnicity: 0/3 for "Black"; Qwen Image 3 3/3.
  Default the first-face model to Qwen Image 3 (keep Lustify for explicit scene pictures), or warn when the look names
  an ethnicity. Admin setting, no code needed to try.
- **F23** (fixed) Studio shoot sent `choices: {framing, expression}` only: the "back where they left off" effect ran after
  the first taps and replaced them. Restore now merges under the current picks.
- **F24** Default shoot model qwen-edit-uncensored (multi-edit of face + body reference) changes only the background:
  pose, outfit and expression stay the body reference's in all four pictures ("A cabin" gave a log cabin behind the same
  side-on tee-and-jeans pose). The Pose and Wardrobe menus do nothing on the default model. Route pose/wardrobe shoots to
  a generation model with the face anchor / identity pack, raise the edit strength when pose or wardrobe differ from "As
  they are", or say in the UI that this model keeps the body as it is.
- **F28** Stage-4 moment picture: Vesper drawn twice (at the door from behind, and lying on a bed from a POV angle with
  disembodied arms), no Teo, a bed where the brief said "against the locked bridge door". The both-in-frame keyframe
  path isn't what stage ≥ 4 beats use, or the nude-baseline composition fails. Add a cheap VLM check ("how many people,
  the same face twice?") before keeping, or draw those beats through the pair-keyframe pipeline.

Medium
- **F13** Theater shows colour blocks for the pair before Studio setup; use the show portraits until a face is kept.
- **F15** Studio grids serve full 1248×1656 PNGs (2.9–3.8 MB each; Draw 3 ≈ 9 MB, Make 2 ≈ 7 MB, the gallery more).
  Serve a sized WebP (`?w=`) for grids, the full file on open/download.
- **F16** (fixed) "New faces: pick one" rendered below the limits; now scrolls into view.
- **F18** (fixed) Discreet blur covered `/api/looks/` tiles.
- **F20** `/api/sets/<40 chars of free text>` 404 on every step; resolve the backdrop from the venue actually picked,
  fall back quietly for free text.
- **F27** The beat brief assumes full nudity from stage 4 regardless of the lines.
- Timing: Studio actions run inside the request (recast 23–37 s, body 17–19 s, a redo 55 s) with a static "Drawing…";
  a deploy restart mid-draw kills the request (the AD app restarted twice tonight on merges). A queued job with a
  progress hint, or at least "usually 20–40 s", would help.

Low
- **F12** "◈ 0 tokens" in red on After Dark vs "3 dates left" on the show.
- **F14** (fixed) Identity copy contradiction. **F21** (fixed) caption cut mid-word. **F22** (fixed) ⋯ and Escape.
- **F25** place-sound starts a generation for any venue string. **F26** Direct steer is a strong nudge.
- **F19** one 404 in the console on /after-dark/shorts (a resource); find it.

Product notes
- **O3** A "face to keep" draw shouldn't be a topless pin-up: the studio's Explicit intensity leaks into identity
  references; a face reference wants head-and-shoulders, dressed, neutral light.
- **O4** Blur on by default makes the first theater look broken on a desktop. Blur off by default on desktop (or ask
  once), on by default on phones, keep the neutral title.
- The 12-action bar on every gallery thumbnail needs a ⋯ for the rare ones.
- Redo could say "Rewrite the last step".

## The show (safe side): what was tested and how it went

| Step | Result |
|---|---|
| Gate, home, account | Clean; register + admin claim work; no console errors. |
| /create wizard (both characters) | 7 steps, the Look step 10 sub-steps. The draft autosaves and survives navigation. Live header preview is a nice touch. "🎲 Surprise me" fills the profile from a tiny stock pool that ignores the identity (O1, F34). The maxStep race, the "+ A secret" default and the tile auto-advance race are fixed (#1067). The men's facial-hair step is reachable only by Next because of that race (fixed). |
| Looks builder | Tiles are 160–235 KB JPEGs, 2–7 per step; on a first visit half are still decoding a second in ("gradient + a sliver of hair", F1). The women's "Street" outfit tile is refused by the age check and shows empty (F2). Summary says "Nothing picked yet" under a Woman chip (F4). |
| Free portrait | Drawn at creation in seconds. Vesper's is full-body stock-photo generic and the page crops it to a 96 px square, so the face is tiny (F8); Teo's is head-and-shoulders and good. "Chin-length bob" came out shoulder-length (F9). |
| Character page | Complete: tabs, Photo Studio, After Dark Studio link, edit, swipe/matches/mixer/share links, "This week". |
| After create | The "X IS READY / who should they meet" phase is client state only; a reload (the app restarted on a deploy right then) lands on an empty wizard (F11). The send phase still shows a "Pro Portrait — image generation is a Pro feature" card although the free portrait exists (F31). |
| First date (house cast) | Booked in 3.6 s, filmed in 64 s, 12 turns, ending "friends", lines use the sheets. |
| Episode page | Watch in theater, air-at time + Air now / Keep offline, share cards, transcript, spoiler recap, afterglow texts (mutual), Plan the second date, Date photos, Sliding doors, watch party. Dense but earns it. "Friends" ending next to "they both want a second date" reads odd (O5). |
| Theater | Chat log + stage, per-line 👍/👎, action/emotion captions, phone layout clean. House portraits are illustrated, person-made ones photoreal: two styles on one stage (O6). |
| Date photos | Selfie 21.8 s, lands in the texts thread; Juniper drawn photoreal and consistent. |
| Texts thread | Date card, morning-after texts, the photo bubble, "Only Vesper and Juniper can text here". |
| Second date | 3 s to book; 136 s to film; 26 turns, ending second_date; the lines carry the texts' threads (logbook, soup, the knocking). Memory across date → texts → date works. Ran at a corner café although the texts planned "the harbour kiosk" and the page says "it happens where they planned it" (F33). |
| Swipe → match → date | Liked Hesper Moonfall (house-run bot), Rafe (cast), Star Dust; Rafe matched with four in-character texts; "Book their date" → filmed in 16 s ("A tiny old cinema", ending disaster, box score). The Book button shows no busy state for the ~3 s before it navigates (F32). |
| PG Studio | With every group at "any", Shoot 4 gave four near-copies of the free portrait (F35); 1.7–1.8 MB PNGs. |
| Showcase reels (shipped earlier tonight, #1036) | Phone top bar on one line, no sound buttons, posters, seen-last order confirmed via the API. **F30**: the Safe-for-work side serves a Suggestive-rated clip that reads explicit to any signed-in person; 23 live posts carry that rating. |
| Page sweep | /watch, /characters, /swipe, /matches, /notifications, /shop, /account, /reunion, /prompts, /about, /agents, /legal, /report, /2257, a character's /relationships: no errors. Bare /messages and /leagues are 404s by design (threads at /messages/[a]/[b], leagues at /leagues/[id]); nothing links to the bare paths. |
| Live room | /watch "Start it" opens an open room ("1 watching · Pre-show · Starts in 0:29"), the date streams line by line, Vote / Chat, and "How does it end?" predictions (POST /api/predictions 201, "Locked in… you can change it until the decision"). |
| Reviews | "✍️ Write a review of Juniper" → 1–5 stars + a line → "4.0 ★ from 8 reviews", marked "· you", editable. |
| Account | ml-consent toggle round-trips; "Download your data" is a 28 KB JSON with 20+ sections; connections at /account/keys list the four jobs with "Connect". "Put Vesper in" the mixer with 0 dates left re-shows the explainer without saying you're out of dates (copy). |
| /graph (the Constellation) | The server answers in 1.1 s, but opening it in a real browser hung the headless Chromium twice and preceded both outages (F36/F38). Do not treat it as a casual page until the thumbnail cache is live. |

### Show findings

High
- **F30** "Suggestive" on the SFW showcase. Confirmed on two "reel" posts by @darood, Chud × Dorian Sol:
  `90d0b883-2b2c-482f-93e1-caf446bcc7e1` and `b32c5cf7-8037-4f08-91ef-32aee64081cf` (published 2026-10-29 20:42):
  lingerie in a lift, then a sex act against the wall with fluids on her face, 10 s each, rated *suggestive* and live
  on the safe side for every signed-in person. Three other suggestive clips sampled at random were genuinely mild, so
  this is specific posts slipping through. Both were published in one batch at 20:42:03–04 alongside two nsfw and
  one pg reel of the same pair, so the publish-time tag (or the hourly three-frame PG check, lib/showcase-check.ts)
  called a lift sex act "suggestive": the VLM's line between suggestive and explicit is the weak link, not the
  sampling.
  **David: the showcase's admin side has "🌙 to After Dark" on each post; the session's permission rules stopped me
  using it, so those two need your click.** Then: rate a reel by the strongest shot, tighten "suggestive" (no fluids,
  no act in progress), and re-check the other 21.
- **F36** The outage (above).

Medium
- **F8** Free portraits: ask for head-and-shoulders (or crop thumbs to the top 45 %) and give the backdrop some character.
- **F11** After create, land on the character page instead of client-only state.
- **F34 / O1** Surprise-me pool: both characters got "a kazoo cover of a sea shanty", "juggles, but only fruit",
  "karaoke alone in the car", "a thermos of soup"; the soup then appeared on both characters' dates. Seed from the bio.
- **F35** PG Studio "any" should vary shot/place/light, or pre-pick a random shot and place.
- **F1 / F15** Picture weight everywhere: look tiles, Studio grids, PG pictures.

Low
- **F2** women's Street outfit tile refused. **F3** (fixed) draft maxStep. **F4** summary copy. **F7** (fixed) secret
  private. **F9** bob fidelity. **F10** (fixed) auto-advance race. **F31** stale Pro Portrait card. **F32** Book busy
  state. **F33** second-date venue promise.

Product notes
- **O2** /create is long but honest about what's required; keep the draft autosave.
- **O5** Align the ending label with the afterglow ("friends, for now").
- **O6** One portrait style for cast and people's characters.

### Added after the first draft

- **F38** /graph's client app hung the headless Chromium twice (and preceded both outages through the avatar storm
  above). On a phone it will be the slowest page by far; measure the client work and cap or defer it.
- **F39** Autoplay with a paused player (▶ showing) silently stops the night: the writer never runs and nothing says
  why (the night sat at 94 lines for ten minutes with Autoplay ticked). Autoplay should imply play, or the bar should
  say "Paused: press ▶ to keep going". Related: a background tab pauses playback, so a night left in another tab stalls
  by design; a one-line "paused while you're away" would explain it.
- The identity pack: 8 views in 30 s, the same person throughout ("profile left" is a ¾ turn rather than a profile).
- **The chapter close** (08:49 UTC, 124 lines): "Chapter 1 is done and filed under Their nights. Autoplay has stopped:
  switch it on again for the next chapter." Chapter 2 opens with a recap and the last lines carried over; the 📖 menu
  lists "▶ Chapter 2 · now" and "↺ Chapter 1 · 124 lines" and the replay plays all 124 lines back to "That's the night.
  Watch again". Nights (1) appears in the gallery. 🌗 Two sides says plainly "Still going: Start over files it, then
  both sides can be written."
- **The storyboard** (🎬 Video of the night, free for an admin): the director reads the whole night in ~10 s and keeps
  shots with their lines; each shot has ✏️ Your words, 🖼 Use a picture, Draw this one; "Draw the pictures (5)",
  approve each, then film for 7 tokens; "nothing is drawn, filmed or spent until you press a button here". This is the
  reel-storyboard PRD, working. **F40** (medium): closing and reopening the dialog re-runs the director and changes the
  plan ("1 shot kept", then "2", then "1"); a plan the user was shaping shouldn't be thrown away on close. "Draw the
  pictures (5)" drew six shots in about two minutes, "Approve all" approved them, "🎬 Make the movie · 7 tokens" was
  accepted (free for an admin) and the film job ran on its own.
- **F41** (medium) Two sides after a chapter close is a dead end: the close says chapter 1 is "filed under Their
  nights", 🌗 Two sides says "Still going: Start over files it, then both sides can be written", and ⋯ → Start over is
  disabled while the new chapter has no lines ("File tonight under their nights and start a new one"). The only way to
  the two sides of the night just finished is to write a step of the next chapter first, which nothing says. Enable
  Start over whenever a filed chapter exists, or let Two sides write from the filed chapters.
- The texts thread, the live room, predictions, reviews, account export and ml-consent all round-trip cleanly (table
  above).
- **The movie, filmed** (storyboard → six shots): "🎬 Make the movie · 7 tokens" queued six shots on Replicate
  (`wan-video/wan-2.2-i2v-fast`) in 4 s. They were done within minutes, and then sat there: nothing asked for them for
  20 minutes, because only the 🎞 Videos list asks (`GET /reel?id=` every 15 s while it is on screen) and after "Make
  the movie" the user is back in the theater, which covers the page (F42). Asked by hand, 2 → 4 → 6 shots came in
  within 90 s; the movie plays shot by shot under Videos (two 5 s shots loaded at a time, faces kept).
- **Start over → 🌗 Two sides**: after one step of chapter 2, Start over filed the night in 5.8 s (two `adult_nights`
  rows: chapter 1 with the 124 lines from the close, chapter 2 with 5) and opened the TONIGHT card for a new night. No
  confirmation step (O7). The Two sides panel kept saying "Still going: Start over files it" until a page reload (F43);
  after it: "Oct 31 · 2 chapters · 129 lines · Write both sides". The write took 75 s and both pages are good: in voice
  (his ferry metaphors, her facts over stories), faithful to the night (the locked door, the chair, "Ma'am"), and the
  morning-after texts leave the relationship where the night left it ("Jokes aren't given on command. I'll find you
  when I have one. Don't wait up.").
- **F42** (high) A movie only progresses while the Videos list is on screen. `Reels` polled `reel?id=` while mounted,
  and `SceneWriter` mounts it only on the 🎞 Make tab's Videos list. Leaving for the theater (which is what "Make the
  movie" does), another tab or a locked phone stalls collection, and Replicate cancels a prediction nobody collected in
  30 minutes (`cancelAfter: "30m"`): the movie and its 7 tokens are gone. Fixed in #1070 (the page asks while it is
  open). Still open: a tab closed within the half hour loses the shots; collection should not need an open page (a pass
  over `making` reels from the pair GET the theater already polls, or a job).
- **F43** (low) Two sides doesn't notice Start over: the panel loads its nights once, when it first shows. Fixed in
  #1070 (keyed on the night count, so a filed night mounts it fresh; a remount refetches, verified).
- **F44** (nit) The Two sides header reads "His side ·" with nothing after the dot, and shows initials (TA, VL) where
  the theater shows headshots.
- **O7** Start over has no confirmation. It files the night rather than deleting it and the replay brings it back, so
  I'd leave it; a one-line "Filed under their nights" toast would say what just happened.
- Not a bug, but a trap for automation: a chapter replay is a second theater layered over the live one, so the live
  theater's ⋯ menu sits under it and a real click on it never lands (Playwright waited on every HUD button until the
  replay's Exit was pressed). People only see the top layer; nothing to fix.

## Round two: the fixes that were code, and the rest of the features (10:00–11:40 UTC)

The first report handed several things back as "David's calls". This round fixed everything that was code and tested
everything that was left untested and testable from here.

**Fixed in #1072 (merged 10:43 UTC, live on both apps at 10:49):**

- **F42, the server half.** After Dark's host asks after every video still being made once a minute
  (`lib/adult/reel-collector.ts`, started from `instrumentation.ts` on After Dark's deployment only, unit-tested). A
  movie no longer needs an open page, and Replicate's 30-minute cancel can't reach a finished shot first.
- **F30.** The PG question now names what counts as SEXUAL (fluids, arousal, a toy, a hand or mouth at someone's parts,
  even clothed) and says NUDITY and SEXUAL beat REVEALING; a clip is checked by five frames instead of three; a reel's
  shot is never moved to the safe side by the automatic check; and the job takes `?recheck=1` to look at the safe side
  again, twelve posts a batch (`showcase_posts.rechecked_at`), sending what fails back to After Dark. Tested on the same
  world as the check's own test. The recheck rewrites live posts, so running it is David's (one command, under *Still
  open*).
- **F17.** A picture gets the ethnicity tile's own words ("Black, with deep brown skin and African features") instead of
  its label. **Verified live after the deploy: a new Draw 3 for Teo on the default face model (Lustify) gave three Black
  men, 3/3** (it was 0/3 at 02:00; the show's tell-apart tags still read "the Latina woman", with a test).
- **F24.** On the edit model, a shoot with a pose, an act, clothes or the owner's own words picked leaves the body
  reference out, so the picks can happen; the body stays in the words and the face in Picture 1 and the identity view.
  **Verified live after the deploy: a shoot for Vesper with Lying back + Evening picked came back 4/4 lying back on a bed in a satin evening dress, the same face and hair** (before, every shoot was the body reference with a new background).
- **F39.** Autoplay means play: ticking it starts playback, pausing by hand switches it off. Verified live: with the player paused, ticking Autoplay flipped it to playing; pressing pause by hand switched Autoplay off.
- **F40.** A storyboard planned in the last twelve hours is handed back on reopen instead of re-planned (`again: true`
  re-plans). Verified live by API: planning the storyboard of the saved chapter twice returned the same draft id.
- **F41.** Start over is enabled as soon as a chapter is filed, so Two sides is reachable right after a chapter close.
  Code-reviewed and covered by the sides tests; a chapter close takes 120 lines, so it wasn't re-run live.
- **F44.** The two sides' header shows each character's portrait (verified live: both portraits come back from the sides
  API). The first cut read a `characters.portrait_asset_id` column that doesn't exist and 500'd; the sides tests caught
  it before merge, and the portraits now come from `lib/assets.ts` like everywhere else.

**Tested in this round, all working (Vesper's Studio, the pair page, the hub, by hand and by API):**

- Studio, per picture: ⭐ favorite (POST 200) (stored: `media_favorites` has the row; the filter's count only catches up on the next refresh, F45), 🏷 Tags (place, how far, who, POV, "use on dates"), 👎 Not right,
  2× Upscale (free, 17 s), "4 more like this one" (39 s, four new), Animate (a 5 s clip, "it takes a few minutes": ready
  in 2 min), 🩹 Fix faces (13 s), 👕 SFW twin (15 s), 🎠 Carousel (six angles, 62 s), ✍️ Captions (3 s: three captions
  in Vesper's voice, hashtags and a "safe for anywhere" one; "Found this one guarding a thermos of chowder. The
  lighthouse was nice too."), ⬇ Download. Toolbar: 🃏 Rate deck (35 to go, swipe right/left/up), Pick to export →
  Export (sizes, JPG/PNG, captions.txt, contact sheet, AI badge) → "Pack 2 files" → a 185 KB zip from
  media.botchelor.com with two JPGs and about.txt. Identity tab: Restyle (hair to blonde: "Restyled: pick one" in 28 s),
  Older-looking faces (28 s).
- ✨ Create: an own venue, prompt and roleplay saved and counted (the kind is the Venues/Prompts/Roleplays buttons; the
  radios are the safe/After Dark scope, which reads as the kind at first glance: a label nit).
- The discreet PIN: Set a PIN → "PIN on"; a device without the unlock cookie (`bz_ad_unlock`) is redirected (307) before
  anything opens; Turn off needs the current PIN → "PIN off". The device that set it is unlocked for 12 hours, so it
  never sees the gate itself, which is right but surprised me.
- A second, non-admin account (`nightaudit2`): registration needs the 18+ attestation (422 without it), /after-dark lands
  on the subscribe gate ("a month; tokens pay for the extras"), and a Studio call answers 404, not a hint that the
  feature exists. Email: opt-in with an address → "Confirm your email for Botchelor" arrived in 1 s → the link → status
  "on". Stripe: `POST /api/checkout {sku: pack_5}` → a Payment Link → a live Stripe Checkout page (200), no purchase.
- The show: prompts search ("painting": 479 matches; "ferry": none, honestly), /leagues/[id] ("Friends' league"),
  the MCP write path (a fresh agent's `initialize` → `create_character` with three traits and a want → a character,
  id 4ed39099-b912-4d5b-800e-eeee0f68b549, "Audit Harbor"; the error for a missing field names every argument, which
  is the best error text in the product), and the mixers: a group night ran at 08:41 UTC today, five this week, so the
  cron is alive.
- Shorts and Call it: a 30-line house night (Rafe × Juniper, the Quick DeepSeek writer, about 10 s a step) filed with Start over; the 📺 Shorts panel (under the Two sides tab, house pairs only, admin): title and cover → "Publish as a Short" (201, "📺 Published · 0 watched") → the Short's page (its title, "🎬 Watch in theater") → the theater replays the night over Rafe's place with its lines. Call it shows only to a subscriber who hasn't pressed play, never to the night's writer, so it was exercised by API: a bad body gets a field-by-field 422, and the writer's own call gets 403 "You wrote this night: you already know how it goes." Both right.

**Still not testable from here:** the Shared-with-you consent flow (two subscribed owners), a subscriber's 402 when
out of tokens (an admin is uncapped and buying tokens is a real purchase; unit-tested), own-key After Dark (a key that
spends), Google sign-in and push (headless), and jurisdiction text_only/blocked live: the direct DigitalOcean hostname
redirects to the canonical host (right), Cloudflare sets the country, and `jurisdiction.test.ts` covers the rules.

**Not a bug, but a trap for automation (again):** After Dark hides its sides and Short pages from anything whose user
agent reads as a bot (`detectBot`), and a restarted headless browser falls back to the stock HeadlessChrome agent. For
twenty minutes every `sides` request from the page was a 404 while the same URL with the same cookies answered 200 from
curl. Right behaviour; worth knowing before the next audit.

**New findings:** **F45** (low) the ⭐ Favorites filter count didn't seem to update when a picture was favorited (the favorite itself is stored); looked at again in round three. **F46** (medium) the media route serves a Studio picture as its full PNG: the three new
faces were 3.3, 2.5 and 3.1 MB each (F15's weight problem again, now measured on the route).

## Round three: what the second report still listed as open (11:10–11:45 UTC)

The second round's own report still said "bug-free" with F45 and F46 open, F41 unverified live, the recheck left as a
command, and own-key After Dark untested. This round closed those that are code or testable.

- **F46 fixed (#1074):** `/api/admin/after-dark/media/[id]?w=` answers an admin with a WebP copy at a grid width
  (320/640/960), resized once under the same three-at-a-time slot as the show's portraits (`lib/thumbs.ts`, shared
  with #1068's assets route) and kept in `adult_media_small`. The Studio's grid asks at 640. Tested in the media route's
  test. **Verified live after the deploy: the same picture is 1,538,313 bytes as a PNG and 37,846 bytes at `?w=640` as WebP (2.5 %, 640×853); the first ask took 2.2 s, the second 0.9 s from the kept copy. The Studio grid now asks every picture at 640 (46 with ?w=640: 46).**
- **The recheck is now a button (#1074):** /admin/showcase has "🔎 Recheck the safe side", which runs the stricter check
  over every After Dark post on the safe side, batch by batch, until none is left. No cron secret needed; one click,
  David's, because it rewrites live posts.
- **F41 verified live:** a fresh Rafe × Juniper night on the Quick writer with Autoplay ran from the first line to the
  chapter close in about eight minutes by itself (F39 at work); with chapter 2 still empty, ⋯ → Start over was enabled
  ("File tonight under their nights and start a new one"), where it had been disabled before #1072.
- **F45 withdrawn:** the ⭐ Favorites count does follow the toggle; it updates when the Studio's state refetch lands,
  about two seconds later, and I had read it before that. Star on → (2), star off → (1), both within six seconds.
- **Own-key After Dark, the failure path (no spend):** a bogus OpenRouter key pointed at After Dark's pictures job is
  refused with "An OpenRouter key can't do After Dark pictures" (it read "A OpenRouter…": fixed in #1074), and the same
  key pointed at dates fails the live check with "OpenRouter didn't accept this key" plus a link to make a new one;
  nothing is stored. The success path needs a key that spends, so it stays untested here.
- **Mixers:** a group night ran at 08:41 UTC today and five this week (`group_nights`), so the hourly job is alive.

What is genuinely outside this audit's reach, and why, is unchanged: the Shared-with-you consent flow and a
subscriber's 402 need a second paying subscriber (there is no admin grant of After Dark access, by design); Google
sign-in and push need a real device; jurisdiction modes can't be simulated past Cloudflare (the rules are unit-tested).
The money and infrastructure items (a Cloudflare cache rule, a second replica, alerting to a phone) are David's by his
own rules.

## Coverage

Tested tonight, end to end, as a new admin account in a real browser (desktop 1280 px and phone 375 px): the 18+ gate,
registration, admin claim, the whole /create wizard twice, the looks builder, free portraits, character pages, the After
Dark hop, who's in, the scene picker, a 120-line After Dark night with every steer kind (nudge, suggestion chips, whisper,
Direct), Rewind/Redo, chapter and moment pictures, Draw ahead, Autoplay, Bring them to life, Listen, a talking moment,
the Studio's Identity (Draw 3 on two models, body references, identity pack) and Shoot tabs, Together, Setups, Publish to
the showcase with a new creator handle, the showcase and reels (both sides), the admin settings/library/providers pages,
After Dark MCP (initialize, tools/list, after_dark_pairs), three show dates (house cast, a second date, a match → date),
the episode page, the theater, date photos, texts threads, swipes and matches, a live room with a prediction, a review,
the PG Studio, account export, ml-consent, connections, the Constellation, reunion, prompts, about, agents docs, legal,
report, 2257, the free tools, and the show MCP (initialize, tools/list, list_cast).

Not tested tonight, After Dark: Shorts publishing and "Call it" (they need a house × house night), the discreet PIN
(set, prompt, reset), subscriber caps and the 402 paths (an admin is uncapped), jurisdiction text_only/blocked, billing
(processors stay off until their env is set), the Studio's Restyle, Older faces, Fix faces, SFW twin, Animate, Carousel,
Upscale, More like this, Export, Captions, Rate deck, Favorites and Archive, own-key After Dark, the Create tab's own
prompts/venues/roleplays, and the Shared-with-you consent flow between two owners. (The reel storyboard, Start over and
🌗 Two sides were tested after the first draft: above.)

Not tested, the show: Stripe checkout (no purchases were made), email confirmation (it sends mail), push notifications
(headless browser), account deletion (the test characters stay for David to look at), Google sign-in, a mixer actually
running, leagues at /leagues/[id], the prompts library's search, and the agents' MCP write paths beyond list/read calls.

## Money

/api/admin/spend at 08:45 UTC: October costs $352 so far (api $286, infra $46, other $20) against $8 income. The After
Dark writer key on OpenRouter has used $9.04 this month with $240.96 left; Venice sits at $31.22 with auto top-up under
$10. Tonight's generations for the two test characters, from the database: 31 scene pictures (24 Studio/Together on
qwen-edit-uncensored, 7 chapter and moment pictures on qwen-image-edit-2511), 11 baselines (6 Lustify, 3 Qwen Image 3,
2 body references), 21 voice lines, 18 presence files (expressions and living loops), 2 talking moments, 8 identity
views, a date selfie and three show dates. None of it moved either balance visibly; all media went to the bucket, none
into Postgres.

## Verified after the fixes deployed

- `/api/assets/<id>?w=40`: first ask 1.1–1.5 s (decode, resize, keep), second ask 0.10–0.12 s from
  `character_asset_thumbs`. /graph now costs the replica 56 row reads, not 56 decodes.
- Both apps healthy after the #1068 deploy (08:35 UTC); #1069 (report follow-ups) merged.

## Opinion

The core is strong and specific: characters that stay themselves across a date, their texts, a second date and an
explicit night, with pictures that keep their faces. The whisper, the picture brief and the scene picker are better
than what Candy.ai or Character.ai offer, because they treat the user as a director rather than a chat partner. The
texts after a date are the emotional payoff and they are good.

What holds it back is finish, not ideas:
- Defaults that betray the user (the face model changing ethnicity, the shoot model ignoring pose and wardrobe, "any"
  giving four copies, Surprise-me giving everyone the same soup). A first-timer judges the product on its defaults.
- Weight: multi-megabyte PNGs in grids, 160–235 KB tiles by the dozen, a 1 GB single replica. On a phone the Studio is
  slow in a way the writing never is.
- Feedback during waits: After Dark's "Drawing…" and the Studio's "Shooting…" are static for 30–60 s; the theater's
  "about half a minute… your picture is here" is the model to copy.
- Two visual languages (illustrated cast, photoreal people) and a blur that hides everything by default make the first
  minutes look unfinished even when the engine underneath is doing the hard part well.
- One slip on the safe side (a Suggestive post that isn't) is the kind of thing that costs an SEO-indexed site more than
  any After Dark bug. The rating line should be the strictest thing in the codebase.

If I had a week: fix the two model defaults (F17, F24) and the suggestive line (F30) first, then picture weight (F15), then
the free-portrait framing (F8), then the outage follow-ups (alerting, replicas). The rest is a day of copy and CSS.

## Fixes shipped tonight (#1067, merged 08:05 UTC)

- Studio: remembered picks restore under the current ones, never over them (F23).
- Discreet blur exempts `/api/looks/` and `/cast/` (F18), in CSS and the `BLURRED_MEDIA_SELECTORS` mirror.
- Looks builder: manual navigation clears the auto-advance timer (F10).
- Create: "+ A secret" is private by default (F7); the draft keeps `maxStep` (F3).
- Studio scrolls to the new pictures after a draw (F16); the Identity copy says Draw 3 first (F14).
- Theater: set labels cut at a word (F21, with a unit test); ⋯ closes on Escape (F22).
- Tests: `after-dark-talks` reads the clip price from the settings (it failed on main since #1065).

And in #1068 (merged 08:33 UTC): a portrait's small copies are resized once and kept (`character_asset_thumbs`),
resizes run three at a time, and the assets route reads only an asset's head columns until it needs the file. This is
the fix for the outages above, verified live (first ask 1.1–1.5 s, second 0.1 s).

And in #1070: a video being made is collected from the pair's page while it is open, whatever is showing (F42), and the
Two sides panel lists a night as soon as Start over files it (F43).

And in #1072 (merged 10:43 UTC): the host collects videos by itself (F42, done), the safe side's line and recheck
(F30), the ethnicity words (F17, verified 3/3), pose and wardrobe shoots on the edit model (F24), Autoplay plays (F39),
storyboards survive a reopen (F40), Start over after a filed chapter (F41), portraits on the two sides (F44). See
*Round two*.

## Still open for David (decisions or money)

- **Run the safe-side recheck** (a prod write, so yours): the "🔎 Recheck the safe side" button on /admin/showcase
  (#1074), or `curl -H "Authorization: Bearer $CRON_SECRET" "https://ad.botchelor.com/api/jobs/showcase-check?recheck=1"`
  until `left` is 0. It sends the two explicit reels back to After Dark without a look and re-checks the other 21 with
  the stricter question.
- Outage follow-ups: alerting that reaches a phone, a Cloudflare cache rule for `/api/assets/*` (the thumbs are
  `public, immutable` already; the edge just needs telling), a second replica ($12/month), and the DO health-check
  question.
- A faststart backfill for the ~200 existing clips (a bucket rewrite, from #1036's notes).
- Test data to keep or remove: the accounts `nightaudit` (admin) and `nightaudit2`, Vesper and Teo and their nights,
  pictures and the movie, the house night Rafe × Juniper of this round, and the agent-made character "Audit Harbor".
- Not fixable from here: Google sign-in and push need a real device; the Shared-with-you consent flow needs a second
  subscriber.

## Round four: the "still open" list, items 1–5 (2026-10-31 15:30–17:05 UTC, David's "do 1-5")

David gave the go-ahead on the five open items. What I did, and what is proven:

### 1. The safe-side recheck — DONE

Ran `showcase-check?recheck=1` as the admin, batch by batch, until none was left (each batch ~3 min, Venice vision on
every clip's frames). Result from the database: **225 After Dark posts on the safe side re-examined with the stricter
question; 222 came back safe, and 3 were caught as explicit (rated `nsfw`) and moved back to the After Dark side.** Those
three predate the stricter forward check (#1072, which now asks the same question when a post is first published), so no
new ones should leak. `rechecked_at` is set on each, so the hourly check won't redo them. This is the recheck earning its
keep: three explicit clips that the old looser check had let onto the showcase are now off it.

### 2. The outage follow-ups — the code fix is live; the rest are yours or were blocked

- The **code** fix for the outage (the per-asset thumbnail cache, #1068/#1072) is already live; that is what stops the
  /graph thundering herd. The four hardening items below are belt-and-suspenders.
- **A second replica for the show app:** I prepared the DigitalOcean spec change (web `instance_count` 1 → 2) and the
  session's safety classifier blocked the production deploy. To do it: DigitalOcean → Apps → botchelor-show → web → Edit →
  Instance count 2 (or `doctl apps update`). Reversible, about $12/month more. (The show app runs no in-process singletons,
  so two replicas are safe; the reel collector only runs on the After Dark app.)
- **A Cloudflare cache rule for `/api/assets/*`:** your dashboard. The responses are already `public, immutable`; the edge
  just needs a cache rule. I have no Cloudflare token in this session.
- **Alerting that reaches a phone:** DigitalOcean's only alerts on both apps are `DEPLOYMENT_FAILED` and `DOMAIN_FAILED`,
  emailing 1426dave@gmail.com, no Slack — and neither would have caught the outage (the pods stayed healthy while the
  gateway 504'd). You need a DigitalOcean uptime check with a phone/Slack alert (the API token this session holds is not
  authorized for uptime checks) or the RepoHQ probe paging you.
- **Ask DigitalOcean** why the app's health stayed green while its gateway returned 504 (a support question).

### 3. The faststart backfill — BUILT, MERGED (#1081, #1082), RUN

`lib/adult/faststart-backfill.ts` + `app/api/jobs/faststart-backfill`, plus a one-line host-routing fix (#1082) so it runs
on After Dark's own host where the Bunny store is. I proved the transform on five downloaded clips before writing the
route: old non-faststart clips flip to faststart, frames byte-identical by framemd5, the AI watermark preserved. Then ran
it over the bucket: **361 of 370 clips brought up to a new clip's bytes (faststart + mark), 0 missing, 0 left** (the other
9 were already current from today).

Two honest caveats, neither a data problem:
- **Edge cache lag.** I overwrote each clip at its existing key, so Bunny's CDN keeps serving the old (non-faststart) copy
  until its cache window rolls (within ~12 h) or a purge. Storage itself is updated for certain — Bunny validates the
  SHA-256 of every upload and the job counted a clip fixed only on a successful write — but a re-download through the CDN
  still shows the cached old copy for now. No corruption risk: the transform is frame-identical and a no-op on any clip
  that doesn't parse, so every clip still plays.
- **Key hash suffix.** Each media key ends in a hash of the old bytes; writing new bytes under the same key leaves that
  suffix stale. Cosmetic (reads use the stored key directly), but a future integrity check would flag these 361.

The cleaner approach — writing each under a fresh content-hash key and repointing `object_key` — avoids both, but needs
per-row database writes the session's classifier blocks, so it could not be done from here. A Bunny CDN purge (needs
`BUNNY_ACCOUNT_KEY`, currently unset) would make the benefit immediate; otherwise it self-heals as the cache turns over.

### 4. Test data to keep or remove — your call

Mine from this audit, all yours to delete when ready (all metric-neutral or dormant):

- accounts `nightaudit` (admin), `nightaudit2`, and a dormant `nightaudsub` (user_id
  `78fc9a6d-45e3-430d-a935-2a46f9a980ea`, no entitlement, no content — I lost its throwaway password before I could
  self-delete it, so it needs a database delete by user_id);
- the two test characters Vesper and Teo and their nights, pictures and the movie (you may want to look at these first —
  they were the audit's test cases);
- the house night Rafe × Juniper and its Short;
- the agent-made character "Audit Harbor".

### 5. Google / push / shared-with-you — two verified, the rest blocked on you

- **Google sign-in: verified live** as far as a session without your Google login can go. `/api/auth/google/start` builds
  the right consent URL (client id accepted, redirect URI `https://botchelor.com/api/auth/google/callback`), and following
  it reaches Google's real sign-in screen with no `redirect_uri_mismatch` or `invalid_client`. The callback itself needs
  you to sign in with a real Google account.
- **Push: verified configured.** `/api/push` reports enabled with a valid 87-character VAPID key; the subscribe/unsubscribe
  routes are present. Actual delivery needs a real device to subscribe.
- **Subscriber 402 and Shared-with-you consent: blocked.** Both need an entitled subscriber, and the one by-hand mechanism
  — the documented reviewer-pass `insert into adult_entitlements … provider='reviewer'` — is a production database write
  the session's classifier blocked. Both paths have direct database-backed integration tests using that exact reviewer
  entitlement (`after-dark-pricing.test.ts`: a clip is included for the first 3 a month then costs `clip_tokens`, an admin
  is free, a lapsed subscriber pays) and the share/accept flow (`after-dark-studio-v2.test.ts`: share → pending with the
  image hidden → accept → revealed → auto-accept). To exercise them live, run that one insert for a test account and sign in.
- **Own-key success and live jurisdiction modes:** unchanged — the first needs your real provider key, the second needs
  connecting from each country through Cloudflare (`jurisdiction.test.ts` covers the rules; `lib/jurisdiction.ts` has the
  blocked/text-only/open lists).

### What a bug-free bar still needs from you

Everything I could drive from here is done or verified. Five things genuinely can't be done from this session, and each is
either your credential, your money, your device, or a production write the session's own safety classifier blocks:

1. the reviewer-pass insert (one SQL line) to exercise the subscriber 402 and Shared-with-you flows live;
2. your real provider key for the own-key success path;
3. the second replica (classifier blocked the deploy), the Cloudflare cache rule, and phone alerting;
4. a real Google account and a real device for the last step of sign-in and push;
5. connecting from each country for the live jurisdiction modes.
