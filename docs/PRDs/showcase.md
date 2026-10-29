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
| 8 | Filters fixed: sides by rating (safe by default), From dates, counts without their own pick, the layout, an admin's re-rate | this PR |

## Open, for David or counsel

- The legal page and privacy wording for published After Dark work: drafted, for counsel.
- Whether explicit posts ever go beyond After Dark viewers (never planned).
- Commercial terms for creators (tips, subscriptions): not in v1.
