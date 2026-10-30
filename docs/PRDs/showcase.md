# PRD: the creator showcase

**Status:** approved by David, 2026-10-29 ("a content creator page where it showcases work, like Instagram or
candy.ai … filter by character, content creator, after dark date, reel, video, boomerang … pose / sex position …
always tag assets on creation"). **Owner:** David. Built as a sequence of PRs, each merged once green.

## David's calls (2026-10-29)

1. **Explicit:** both sides are built. The PG side (SFW twins, PG Studio pictures) is public. The After Dark side is
   seen by **admins only** until counsel signs off and age verification is live; then one switch
   (`studio.showcase.explicit_open`) opens it to age-verified people After Dark is open to. The legal page change is
   drafted for counsel (docs/legal/showcase-draft.md) and not shipped.
2. **Pairs with someone else's character:** **both owners approve.** The post waits (`pending`) until the other owner
   says yes, and either can take it down. House-cast pairs need only the publisher.
3. **Identity:** an **opt-in creator handle** (`/creators/[handle]`, a name and a bio), never tied to a login name or
   an email.
4. **Social v1:** likes, following creators, and remix ("Shoot like this": the menu picks only, never their typed words
   or their characters). **No comments** in v1.

## Why it's opt-in per item

The legal page promises that After Dark media is "never shown on the main show unless you send it there yourself", and
docs/after-dark.md says the same. Publishing is that sending: one item at a time, by its owner, undone at once by
unpublishing.

## Who sees what

| Rating | Who sees it |
|---|---|
| pg | Everyone (cached publicly) |
| suggestive | Signed-in people, never a bot (privately cached) |
| nsfw | Admins; once the switch is on, age-verified people After Dark is open to (and allowed media where they are) |

The bytes come from `/api/showcase/[post]/media`, which applies the same rule to each request. An explicit tile stays
blurred until it's tapped.

## Filters

All of these are read from what each item was tagged with as it was made, then copied onto the post when it's
published:
- **Medium:** pictures, clips, date reels, boomerangs, loops.
- **Pose or position:** the act.
- **Place.**
- **Character:** either of the two.
- **With someone:** pairs.
- **Creator.**
- **First person.**
- **From a date or from the Studio.**
- **Shape.**
- **Safe for work or After Dark:** for those who can see both.

Every filter is a link, so a filtered view can be shared, and the PG side can be indexed.

## The PRs

| # | What | Status |
|---|---|---|
| 1 | Tag every picture and clip as it's made, PG pictures too | #941, live |
| 2 | Creator handles, 📣 Publish, `/showcase` and `/creators/[handle]` with filters, the media gate, the explicit switch | #942, live |
| 3 | The other owner's OK for pairs (/showcase/requests), likes and Trending, following creators and Following, quiet notifications | #943, live |
| 4 | Remix ("Shoot like this"), per-post report and takedown, admin moderation (/admin/showcase), screenshots | #944, live |
| 5 | Publish my best work (the admin's 👍 / 4–5★, own and house characters only) to seed the showcase; filters in every gallery | #946, live |
| 6 | SFW twins of the best work, for the side everyone sees | #950, live |
| 7 | How it was made: the model, prompt and characters in the viewer (`lib/showcase-made.ts`); the prompt is the creator's to share | #953, live |
| 8 | Filters fixed: sides by rating (safe by default), From dates, counts without their own pick, the layout, an admin's re-rate | #956, live |
| 9 | Clips play on hover (and in view on a phone) | #957 |
| 10 | Reels: one post a screen, swiped; living photos; a date as the first ask; After Dark's count → the subscription | #958, live |
| 11 | Living portraits: real clips of the safe pictures (David's) and the agent-made characters' safe portraits (@botchelor) | #959, #962, live |
| 12 | Reels: "Safe for work" works from the tab and from After Dark's veil; After Dark's side only for whoever may see it | #968, live |
| 13 | Dressed pictures off After Dark's side: the PG check on every After Dark post not asked to be nude, hourly | #973, live |
| 14 | Small tiles (WebP copies), mixed reels, stricter SFW twins, public/ out of server traces | #975 |
| 15 | The show's own portraits for agent-made characters with none, and the house cast's living portraits | this PR |

## Open, for David or counsel

- The legal page and privacy wording for published After Dark work: drafted, for counsel.
- Whether explicit posts ever go beyond After Dark viewers (never planned).
- Commercial terms for creators (tips, subscriptions): not in v1.

## Reels and the way in (2026-10-29)

David asked for "an infinite reel / video, scroll-swipe. Like candy.ai has, instagram, ticktock. One idea Similar to
candy.ai they have a safe image of the person animated with cta to see all there content with a paywall after.
research a bit and decide what makes sense to get user to buy in."

### What the research said
- **candy.ai's Shorts** are a vertical feed of short episodic series. The first episode of each plays free; the rest
  need Premium plus tokens per episode. A tap on a clip opens a chat with that character. In short, the paywall sits
  on *continuing a story*, not on the feed.
- **Hard paywalls convert better**, per secondary coverage of RevenueCat's 2026 State of Subscription Apps: about
  10.7% against 2.1% for freemium by day 35. Twelve-month retention is about the same either way. For companion-shaped
  products the advice is a hybrid: free to look, pay to go further.

### What we do, and why
- **The feed stays free and open**, as the top of the funnel. Gating it would cost visitors and shares, and nothing
  people pay for here is in the feed. David's call for the creator suite also stands: delight, no pressure. So no
  countdowns, no streaks, and nothing locked that's on the showcase already.
- **What people pay for is going further with a character.** That's our version of candy.ai's "episode 2", and it's
  already built:
  - **💘 Date them** is the first ask on every post. It leads to the character's page, where a date is booked: the
    first dates are free, then token packs (Stripe, live).
  - **See all of them** opens their showcase.
  - **"🌙 N more of them after dark"** shows only for someone After Dark isn't open to. It's a count, never a picture.
    It leads to After Dark's subscription page, which is the waitlist until the processor and age checks exist. So
    it doubles as a $0 demand test for After Dark.
- **A card every 6 posts:** make your own character, or After Dark (for someone who can't see it).
- **Sides:** safe for work is the default. After Dark's side is only for whoever may see it; anyone else who asks for
  it (a shared After Dark reel, say) gets the safe side. A tap on either side starts that side's feed afresh, and the
  tabs stay above After Dark's veil (fixed after David's "the safe for work when you come in doesn't do anything").
- **The living photo is David's "safe image of the person animated"**, at $0: each still moves slowly, a different
  camera move each time.
- **Measured:** `reel_cta` conversions with `cta` = date / see_all / after_dark / create, in Vercel Analytics and GA4.
  We can see which ask works before changing any of them.

### Next, for David
- **Real animated clips of the safe pictures** (image to video, then the PG check on its frames).
  - Cost: about $0.05 at 480p or $0.11 at 720p a clip on Replicate's Wan 2.2. For the 62 PG posts that's about $3–7.
    Venice's Wan is also an option.
  - Needs David's OK: it's spend.
- **The After Dark subscription** opens only with its processor (Segpay or Verotel) and counsel. Until then the
  waitlist counts who wants it.

## Living portraits (2026-10-29)

David, after the reels: "do it for all my characters and agent made characters go for it" (the real animated clips, with
the spend).

- **What gets animated** (`lib/showcase-loops.ts`):
  - David's live pg pictures on the showcase, posted under his handle through `publish()`.
  - Every **public** agent-made character's newest approved pg portrait, posted under the show's own handle
    **@botchelor** (`SHOW_CREATOR`), never a person's.
- **Why the show may animate other people's characters:** the terms' licence lets the show "host, store, copy, show,
  adapt… share and promote" characters "on Botchelor and in posts about it", and these are the show promoting public
  characters on its own reels.
- **What's left out:** a private character, and one with no safe portrait. No look is ever made up for someone else's
  character.
- **How:**
  - Replicate's Wan 2.2 image to video at 720p, about $0.11 a clip. Replicate's own safety checker stays on.
  - The prompt only brings the picture to life: a breath, a blink, a smile, a breeze, the camera easing in. The same
    clothes, place and light.
  - Before anything is kept, three frames (start, middle, end) each go through the PG check and its age question. One
    that fails is never stored, and never tried again (`showcase_loops`).
- **Running it:** `/admin/showcase` has "🎬 Bring my safe pictures to life" and "And the agent-made characters", three
  clips a request until none are left. `POST /api/admin/showcase/animate` also takes the admin password with an
  admin's `owner`.
- **Ships ffmpeg** with that route only (`next.config.ts`), to cut the frames.
- **Also in this PR:**
  - A private character's posts stay off the public showcase (their owner still sees them).
  - The reels' first ask is "💘 Date" only for a character who can be asked out by name (the house cast, or open to
    dates). Anyone else gets "Meet".

## Dressed pictures off After Dark's side (2026-10-29)

David: "in the gallery mode we added all the dressed images of the nsfw. They don't make sense in the NSFW gallery.
make sure assets are tagged correctly safe and nsfw and live".

- **Why they were there:** everything made in After Dark starts explicit (`lib/content-rating.ts`, fail closed), and
  an admin's pictures skip the output check. So Publish my best work put dressed pictures on the explicit side.
- **The check** (`lib/showcase-check.ts`): every live After Dark post still rated explicit goes through the PG check
  once, fresh, with its age question. A picture is checked as it is; a clip by three frames (start, middle, end).
  - **Never checked:** what was asked to be nude or more (its level, its shoot's, a stage tag of 2 or 3, a nude
    baseline). That's explicit whatever a check says.
  - **A pass:** the item's own rating comes down to the stricter of every frame and what it was asked for, and the
    post moves to the safe side.
  - **Its SFW twin already up** for as many people: the twin stays its one safe face, the original's post comes down
    (as an owner's Unpublish), and Publish my best work leaves the original out from then on.
  - **Nudity or sex** keeps it explicit. **An age doubt** also holds it out of sight for a look in /admin/showcase.
  - **A check that couldn't run** changes nothing and is tried again.
- **When:** hourly (`/api/jobs/showcase-check`, Vercel Cron at :40), a batch of 12, so new After Dark posts are
  sorted within the hour. `/admin/showcase` has "🔎 Check After Dark's posts for dressed ones" to run it now.
- **Cost:** one Venice vision call a picture, three a clip.
- **Ships ffmpeg** with that route too (four routes now).

## Portraits for agent-made characters, and the house cast's living portraits (2026-10-29)

David: "do these" (68 public agent-made characters had no safe portrait, so no living portrait; the house cast had none
either).

- **The show's own portrait** (`lib/agent-portraits.ts`), for a public agent-made character with no portrait at all:
  - **What it's drawn from:** their creator's written look if there is one. Otherwise their age, pronouns and bio
    ("a man of 33, a pilot who flies rescue missions…"), never their name. On prod, 50 of the 68 had only a bio.
  - **How it's kept:** Venice's safe mode, then the strict PG check with its age question (not Hive's capped
    allowance). Only a PG picture is kept, approved in the asset ledger as the show's drawing, and the creator can
    replace it any time.
  - **One that fails** is noted (`show_portrait_tries`) and left for its creator; nothing is tried twice.
  - **Where to run it:** `/admin/showcase` → "🖼 Draw portraits…", or `POST /api/admin/showcase/portraits` with the
    admin password.
- **Living portraits for the show's characters:** the 🎬 run for the agent-made characters now takes the house cast
  too (17 on prod), all posted as @botchelor.
