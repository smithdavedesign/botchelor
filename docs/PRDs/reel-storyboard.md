# Reel Storyboard — PRD

Status: draft, 2026-10-24. Owner: this Claude session (reels lane). Studio next-steps and the 134 preset tiles
are the other session's lane (`docs/PRDs/studio.md`); this reuses them, it doesn't build them.

## Why

Today "make a video of the night" is one blind call (`makeReel` in `lib/adult/reels.ts`): the director picks the
shots, the keyframes are drawn and checked, and the videos are queued, all at once. Everything that has gone wrong
with a reel — clothes left on through sex, a partner who turns into a stranger, tangled limbs, the wrong room — was
visible in the start picture before the video was ever made. A keyframe costs ~4¢ and ~30–60 s; a video costs many
times that and is made from a frame nobody looked at.

Candy's "shorts" look real because a person picks and edits the clips. The storyboard gives the owner that same
control over their own night: see each shot, fix the start picture, then pay to film only what's approved. It also
closes the gap on the Seduced/Candy feature set David listed (2026-10-24).

Two outcomes: **fewer failed videos** (approve pictures before spending on video) and **more control** (edit each
shot). A third, free: the same storyboard builds the house **Shorts** showcase.

## The flow

`Make video` no longer films straight away — it opens an editable **storyboard** of the night, pre-filled with the
director's picks, with a big **Film it** button on top. Someone happy with the picks is one tap from today's result;
someone who isn't edits first. Four stages:

1. **Plan** — `pickShots` (already pure, no spend) returns the draft shot list: each shot's line, a still of the two
   of them (`frame`), and the motion. No keyframes, no videos, no tokens. Persisted as a reel row `status: "draft"`.
2. **Edit** — the owner changes the draft (below). Cheap; no media except keyframe redraws they ask for.
3. **Approve pictures** — draw each shot's keyframe + check (off Hive in dev / via the configured checker in prod),
   show them as tiles. The owner approves, redraws, or drops each. Only picture spend here (~4¢ + a check each).
4. **Film** — spend the reel tokens, queue the videos from the approved keyframes. This is the only place video is
   paid for. Reuses the existing `startShots` video half.

This splits `startShots` (keyframe-draw+check fused with video-queue) into `drawFrames` (stage 3) and `filmReel`
(stage 4). `makeReel` stays as the one-tap path = plan → autodraw → film, for anyone who skips the storyboard.

### The shot card (editor)

Each shot shows its transcript line, the start picture (once drawn), and the motion. The owner can:

- **swap the line** for a nearby moment in the same chapter;
- **pick each person's look** — their usual baseline, a Studio shoot, or the nude baseline (held to the pair's stage);
- **choose the start-picture source** — the director's still, a beat picture (already checked, in the gallery), any
  Studio picture of the pair, or a fresh draw;
- **set the framing** — close-up, medium-from-the-side, or POV (Candy's single-subject POV reads most real);
- **change the motion** — preset chips first (so most edits never touch free text), free text second;
- **set the length** — per shot, the video "scene list" (Candy): 5 s or 10 s;
- **drop, reorder, or add** a shot.

Free text runs the existing safety checks (`checkAdultText`, the age regex, `crossesTaboo`); the start picture runs
the configured check. Presets are the default so most nights need no free text.

### Entry modes (Seduced's three)

- **Spin a series** — no prompt: pick a theme, we plan a short series from the night (or a template night). One tap.
- **Smart** — plain language: "make it slow and tender, end on the balcony" steers the director's picks + motions.
- **Advanced** — the full shot-by-shot storyboard above.

Mode is a header toggle; all three land on the same storyboard (Smart/Spin pre-fill it, Advanced opens it empty-ish).

### Competitor features, mapped

| Their feature | Here |
| --- | --- |
| Editable summary before generating (Candy) | the storyboard itself |
| Video scene list: presets in order, each a length (Candy) | the shot list, per-shot length |
| Cost shown before you generate (Seduced) | running token total on the storyboard; charged at Film it |
| Replicate button: re-run with exact settings (Seduced) | per-shot **Replicate** (re-draw the keyframe / re-film the shot with its saved inputs) |
| Strength slider 0–150% on a picked option (Seduced) | shot editor + Studio (reuse the Studio control) |
| One-tap edits: clothes / place / explicit (Seduced) | shot editor "change clothes / change place" → re-draw keyframe |
| Big tiles + check badge, sections on one screen, sticky Next on phones (both) | the approve-pictures grid |
| Weak presets marked "Experimental", not hidden (both) | motion/framing presets carry an `experimental` flag |

## Admin Shorts showcase (item 4)

The same storyboard builds the house Shorts (`app/after-dark/shorts/`, the `adult_shorts` tables). An admin plans a
short from a house pair's night, edits it, approves the pictures, films it, and it joins the Shorts page — the
hand-picked, best-of showcase Candy has, made with the owner's eye rather than per-date automation.

## Moderation / unblocking

- **Dev switch — DONE (this PR).** `MODERATION_DEV_OFF=1` off production routes every check off Hive (picture → the
  Venice VLM if a key is set, else a pass; video → a pass, since the alternatives can't read video). Hard-gated:
  `VERCEL_ENV === "production"` ignores it. `lib/adult/moderation.ts` `devModerationOff`. This unblocks building and
  testing the storyboard without eating Hive's 100/day.
- **Real video alternative for prod — SPEC, not built.** The alternatives don't read video, so videos force Hive.
  A true alternative samples N frames from the finished MP4 and runs each through the VLM age/PG question. That needs
  a frame extractor back (we removed `ffmpeg-static` in #688) — an infra cost — and flipping prod's video check off
  Hive is David's safety call. Until then prod videos stay on Hive. Note the existing invariant that limits the risk:
  **every video already starts from a keyframe that passed the check**, so the output check is belt-and-suspenders
  over an already-gated still. Decision for David: re-add a frame extractor for a prod video alternative, or keep
  videos on Hive and rely on the checked keyframe + a sampled last frame.
- The 134 Studio preset tiles' Hive cost (the other session's question) is largely removed by the alternatives:
  PG tiles via `pg_via: "alt"`, explicit admin draws via `admin_checker: "alt"` — both the uncapped VLM, no Hive.

## Learning from edits

Within the rules already set (#765 "never train a model"; the data plan's readiness gates, `docs/data-plan.md`):

- **Per person:** an edit is a stronger signal than a 👎. Swapping a start picture, changing an outfit, or dropping a
  shot feeds the existing per-viewer steering (`lib/adult/steering.ts`), so that owner's next reels avoid the miss.
- **Across everyone, counts only:** how often each kind of director pick is changed, which redraw reasons recur,
  which framings get approved. We read the counts and fix the **director's prompt** ourselves (e.g. if "lying down"
  shots are redrawn >half the time, change the instruction). Not a training set, not raw content — aggregate counts.

## Data model

- `adult_reels.status` gains `"draft"` (planned, not filmed). Existing: `making | ready | failed`.
- The draft's edits live in the existing `shots` jsonb (`ReelShot` gains optional editor fields: `look_a`/`look_b`
  source, `framing`, `length`, `source` of the start picture). Keyframe-draw state on a shot gets `"frame_ready"` /
  `"frame_failed"` statuses alongside today's `queued | ready | discarded | failed`.
- No new tables for v1; drafts are reels that haven't been filmed.

## Pricing (my proposed defaults — David's call)

- Planning + editing: free.
- Keyframe redraw in the storyboard: 2 free per shot, then 1 token (fits whatever Hive allowance is set; in dev it's
  free via the switch).
- Film it: today's `reel_tokens`, charged per approved shot at Film it (so dropping shots lowers the price — matches
  "cost shown before you generate").
- Admins: free, as today.

## PR sequence

1. **Dev moderation switch + this PRD** — THIS PR. Unblocks the rest.
2. **Engine split** — `planReel` / `drawFrames` / `filmReel` out of `makeReel` + `startShots`; `adult_reels` draft
   status; `ReelShot` editor fields; tests. No UI yet (API + harness).
3. **Storyboard UI (Advanced)** — the shot cards, approve-pictures grid, cost line, Film it. Desktop + phone.
4. **Entry modes + competitor polish** — Spin a series, Smart, Replicate, strength slider, one-tap edits,
   Experimental tags, sticky Next, check badges.
5. **Admin Shorts from the storyboard** — plan/edit/film a house short into the Shorts page.
6. **Edit-learning** — per-person steering hooks + aggregate counts + the director-prompt read.

## Open decisions for David

1. Prod video alternative: re-add a frame extractor (infra cost) for a VLM video check, or keep videos on Hive with
   the checked-keyframe invariant? (Prod stays on Hive until you choose.)
2. Redraw allowance + pricing above.
3. Force the storyboard for everyone, or keep one-tap `makeReel` as a "just film it" path? (I propose keeping both.)
