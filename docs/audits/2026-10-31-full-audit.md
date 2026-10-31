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

Five things are not fine, in order:

1. **botchelor.com went down for ~5 minutes at 08:01 UTC** (Cloudflare and the DigitalOcean ingress both answered 504,
   DO's own health said "HEALTHY"). It came back on its own at 08:06, as the merge of #1067 started a deploy. Nothing
   paged anyone. Cause not proven; the last thing loaded before it was /graph. See *Outage* below.
2. **The default face model changes a character's ethnicity.** Teo's look says Black; the show portrait (fal) is a
   Black man; "Draw 3" on the default After Dark face model (Lustify) gave three light-skinned Mediterranean men, 0/3.
   Qwen Image 3 got 3/3 right. A new user never finds out why their character looks like someone else.
3. **A Studio shoot sent none of its picks** (pose, wardrobe, place, light) because a late "remembered picks" restore
   wiped them; every shoot came back as copies of the body reference. *Fixed in #1067.* Separately, even with the picks
   in the prompt, the default shoot model only swaps the background (see F24).
4. **The "Safe for work" showcase serves a post rated Suggestive that reads as explicit** (lingerie, visible fluids) to
   every signed-in person. 23 live posts carry that rating. The rating line needs tightening and a re-check.
5. **Explicit moment pictures at stage 4 fall apart** (one character drawn twice, the other missing) while the PG and
   undressing pictures are excellent. Hive passes them because everyone is an adult; nobody checks composition.

Everything else is polish, listed below with severity. Nine of the smaller ones are already fixed in #1067.

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
  plan ("1 shot kept", then "2", then "1"); a plan the user was shaping shouldn't be thrown away on close.
- The texts thread, the live room, predictions, reviews, account export and ml-consent all round-trip cleanly (table
  above).

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
Upscale, More like this, Export, Captions, Rate deck, Favorites and Archive, the reel storyboard, own-key After Dark, the
Create tab's own prompts/venues/roleplays, and the Shared-with-you consent flow between two owners.

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

## Still open for David (decisions or money)

- F17 default face model → Qwen Image 3 (settings page; cost per face on Venice to compare).
- F24 which model handles pose/wardrobe shoots.
- F30 re-rating the 23 suggestive posts (a script can re-run the VLM; the line itself is a product call).
- Outage follow-ups: alerting that reaches a phone, a Cloudflare cache rule for `/api/assets/*` (the thumbs are
  `public, immutable` already; the edge just needs telling), a second replica ($12/month), and the DO health-check
  question. Until #1068 is live, nobody should open /graph in a browser.
- A faststart backfill for the ~200 existing clips (a bucket rewrite, from #1036's notes).
