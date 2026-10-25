# PRD: the After Dark Studio

**Status:** approved by David, 2026-10-24 ("build 1-3 … use similar pricing strategy as others … POV sounds good … share your
output to the other user/agent … you pay for it … Hive is a bottleneck, add an alternative … everything configurable … make
this best in class"). **Owner:** David. **Code:** `lib/adult/studio*.ts`, `lib/adult/moderation.ts`, `lib/adult/shares.ts`,
`app/after-dark/studio`. **Built:** v1 (#778), the checks (#779), v2 (#784), v3 (2026-10-24; docs/after-dark.md "The Studio").

## 1. Why

Every picture and video After Dark makes starts from a character's **face reference** (the baseline they keep, per viewer:
`lib/adult/steering.ts faceReferenceId`). A better face, and a fuller reference, improves every keyframe, beat picture,
clip and night video that follows. And in this category pictures are the main thing people pay for: Candy, OurDream,
Promptchan and Seduced all sell images from a menu of looks, outfits, places and poses, and price them per image.

So the Studio is two things at once:
- **A photo studio for your character:** a private shoot, from menus, of your own character as you want them, in a
  gallery that's theirs.
- **The identity workshop for everything else:** restyle the face (same person, new hair), recast it (a new person),
  add a full-body reference, and choose how strictly every later picture keeps it.

### Goals
1. Pictures people want to pay for: as good as the field's best, more consistent (one identity, many shoots), at the
   field's prices.
2. Better nights and videos: the face and body every keyframe starts from are the ones the owner chose.
3. Safe by construction: menus, never typed prompts; your own characters only; no uploads; adult-coded only; every
   result checked before it's kept, with a second checker so Hive's daily cap stops being an outage.
4. Everything configurable from the settings page: prices, caps, models, which options exist, which checker runs.

### Non-goals
- A general image generator: no free text, no uploads, no real people, no other people's characters.
- Training anything on what people make (docs/data-plan.md: After Dark never trains a model). Ratings steer only the
  rater's own next pictures (`lib/adult/steering.ts`).
- Anime or illustrated styles in After Dark (the age checks read photoreal faces; docs/looks.md).

## 2. What the field does (2026-10-24)

| Product | Unit | Price of the unit | A picture | A video | Notes |
|---|---|---|---|---|---|
| Candy.ai | tokens | 100 for ~$9.99 (~$0.10) | 2 standard, 4 explicit (~$0.20–0.40) | 12 (5 s), 20 (10 s) | subscription includes ~100 a month |
| OurDream | DreamCoins | 1,000 for $11.99 (~$0.012) | 5–10 (~$0.06–0.12); edits 10–20 | 100–300 by length | Premium 1,000/mo, Deluxe 5,000/mo |
| Promptchan | gems | 100 for $14.99 (~$0.15) | 1–2 (~$0.15–0.30) | 20–28 | upscale on Pro only |
| Seduced | credits | 300 for $25 (~$0.08) | ~1 (~$0.08) | "significantly more" | upscale 2–3× on Pro; extend scene |

Sources: candyaiapp.com/pricing, thecompanionindex.com (Candy, 2026-10), ourdreamai-review.com/pricing,
aicompanionlibrary.com/reviews/ourdream, hushverified.com/reviews/promptchan, appseducedai.com/pricing. Third-party
figures disagree; these are the most consistent.

**The pattern:** a subscription with a monthly allowance plus top-up packs; a picture costs one or two units (more for
explicit or "pro" quality); an edit costs about twice a picture; video costs 10–30 pictures by length; technical failures
refunded; quality failures not (docs/after-dark-competitors-steering.md: "charged for a bad result" is the standing
complaint, and nobody handles it).

**Where they're weak** (the same research): one reference image (the weak case in Kling's and Runway's own docs), one
result per click where mainstream tools give 4, no way to see what a rating changed, and nothing for a bad result.

## 3. Principles

1. **Identity first.** Every shoot starts from the face the viewer keeps (and their body reference when there is one),
   edited, never redrawn from words: the same person every time.
2. **Menus, never prompts.** Every option is a fixed phrase written to David's lines and tested (`tests/after-dark-studio.test.ts`
   runs every option through `checkAdultText` and `crossesTaboo`). Nothing a viewer types reaches a model.
3. **Their own characters only.** The owner's characters switched into After Dark; an admin's house cast too.
4. **Pay per shoot, four at a time.** Mainstream tools give 4 a job; we price the shoot, not the picture.
5. **Bad results are on us.** A shoot that delivers nothing is refunded whole; a shoot the viewer 👎's whole gets one free
   redo, steered away from what they said was off.
6. **Show the cost and the model.** Every shoot says what it will cost and which model makes it; the viewer may bring
   their own key and pay the provider directly.
7. **Configurable.** Every price, cap, model, option and checker is a setting (section 11).

## 4. Who and what

- **The owner** of a character (a signed-in account After Dark is open to: an admin today; a subscriber with a passed
  age check once payments and age checks are live, `lib/adult/entitlement.ts`).
- **Characters:** their own, switched into After Dark (`adult_switches`); for an admin, the season's house cast too.
- **Recipients of a share:** the owner of a character theirs has dated (section 8): a person, or an agent's account.

## 5. The Studio, by phase

### v1: shoots, identity, the gallery

**Where:** `/after-dark/studio/[id]` for one character, linked from the After Dark hub ("🎨 Studio" per character) and from
each pair page under its two names. Four tabs: **Shoot**, **Identity**, **Gallery**, **Setups** (v3).

**Shoot** (solo, the character alone): chips in groups, each optional, defaults sensible:
- **Pose:** standing, leaning on a wall, sitting on the bed's edge, lying back, lying on their side, lying on their
  front looking back, kneeling on the bed, over the shoulder, stretching, in the bath, in the shower, getting dressed;
  explicit solo poses at the explicit level.
- **Camera:** framing (close, medium, full body, wide) and angle (eye level, from above, from below), and **POV**:
  looking at you, lying beside you, from above you, a selfie, a mirror selfie, and at the explicit level on top of you
  and kneeling in front of you.
- **Wardrobe:** as they are (their picked outfit), casual, smart, evening, sporty, swimwear, lingerie, a bodysuit,
  stockings, an open robe, an oversized shirt, a towel, under a sheet, topless, nude.
- **Accessories** (up to 3): glasses, sunglasses, a choker, a pearl necklace, a gold chain, earrings, a watch, heels,
  boots, a hat, stockings, a garter belt.
- **Place:** their own places (the drawn sets of where their nights have been) and a list: a bedroom, a hotel suite, a
  shower, a bathtub, a sofa, a kitchen, a candlelit room, a cabin, a sauna, a studio backdrop, a beach at sunset, a pool,
  a rooftop at night, a bar. Public places allow nothing past the suggestive level.
- **Light:** natural, golden hour, warm and moody, soft studio, neon, candlelight (the viewer's light test,
  `choosePreset`, picks one when they don't).
- **Expression:** smiling, sultry, laughing, serious, playful.
- **Model:** ours (a short list, section 7), or their own key (v2).

Each option has a **level**: 0 dressed, 1 suggestive (underwear, swimwear), 2 nude, 3 explicit. A shoot's level is the
highest of its choices; it's refused above the viewer's studio intensity for the character or the configured maximum,
and above 1 in a public place. A shoot makes **4 pictures** (configurable, 1–4) from the face reference (and body
reference, and the place's drawn set when there is one) through the multi-image edit model, each checked before it's
kept (section 9), stored in the gallery as the character's own pictures.

**Identity:**
- **Restyle** (same person): the looks builder's chips (hair style and colour, eyes, body, facial hair, skin shade,
  freckles, makeup, glasses, piercings, tattoos, grooming) as an edit of the current face: 3 candidates, waist-up and
  facing the camera like a baseline. "Use this face" (the existing endpoint) makes one the face; "Save to their look"
  also writes the picks to the character (`extras.looks`), so their appearance line and every later picture match.
- **Recast** (a new person): 3 new baselines from their look, through a chosen text-to-image model ("Draw three", with a
  model and a price).
- **Body reference:** a full-body picture of them alone (made here: 2 candidates, or picked from the gallery), which
  shoots add after the face. Configurable whether keyframes elsewhere use it too (off until tested: section 12).
- **Their studio limits:** intensity and hard nos for the character's solo pictures (the pair limits' own chips).

**Gallery:** every picture of the character alone, newest first, with 👍/👎 and "what's off" (`RateMedia`, which steers
their next pictures), Use this face, Use as body reference, More like this (v2), Upscale (v2), Animate (v3), Share (v2),
and the shoot each came from. A shoot whose every picture the viewer 👎'd offers **one free redo** (configurable).

### v2: own keys, pairs, variations, upscaling, sharing

- **Bring your own key** (Connections, `/account/keys`): a new job, **After Dark pictures**, with two providers, Venice
  and Replicate, shown only to someone After Dark is open to. A shoot on their key costs 0 tokens; the provider bills
  them; our check still runs on every picture (so it counts against a separate monthly cap, section 10). Their model
  pick is any model from the Studio's list for that provider (the one picked under Connections is the default). A key
  that can't be used now (over its monthly cap, or failing) is refused with why, and the Studio offers ours: never
  tokens taken without asking (built 2026-10-24; this replaced "falls back to ours or pauses").
- **Pair shoots:** the character with a partner from their After Dark (an eligible pair): the act menu
  (`lib/adult/acts.ts`), wardrobe, place, light, camera, POV off. This folds in the picture menu (`lib/adult/pictures-menu.ts`),
  which keeps working on the pair page. A shoot is staged, not a moment of their night: it's held to the pair's own
  limits (their intensity and hard nos) within the Studio's highest level (dressed: up to kissing; suggestive: up to
  undressing; nude: everything, sensual; explicit: everything), never to how far their night has gone. Places: the
  night's (with its drawn set), then the Studio's own.
- **More like this:** 4 variations of one picture (it becomes Picture 3 of the edit).
- **Upscale:** 2× on Venice's upscaler (free by default, capped monthly).
- **Sharing** (section 8).

### v3: setups, face strength, video

- **Saved setups:** a shoot's choices saved under a name, re-run in one tap, on any of the owner's characters. A place of
  one character's own (their nights' places) isn't kept, nor a Together setup's partner: both are that character's.
- **Face strength:** loose, balanced, strict: how hard every picture holds the face (the edit prompt's wording, and how
  many references go in: loose is the face alone, without the body reference).
- **Animate:** a Studio picture becomes a clip on Wan 3.0 (Venice), 5 or 10 seconds, with a motion chip (just breathing,
  sway, turn to camera, walk toward you, a slow spin, lie back), priced like the field (section 6), kept like any clip:
  checked by Hive (videos always are), counted against the month's clips, one video at a time. It runs on our key only
  (an own-key video job is a later step). Queued at once and collected as the Studio's page polls.

### v4: their look, presets, Filthy, full screen (David, 2026-10-24)

- **Restyle starts on their look:** the menu opens on the character's own picks (extras.looks; After Dark's private
  picks for their owner only), marked •, and a restyle or "Save to their look" sends only what was moved.
- **Remembered:** the tab, the shoot's picks and the restyle's moves are kept per character in this browser, so coming
  back finds them preset. A pick no longer on the menu (locked, switched off) is dropped, never sent.
- **Filthy:** one explicit act in place of the pose (spread, fingers, from behind, mid-orgasm, toys, a plug, POV acts
  with the viewer at the frame's edge, never their face). Open only at the Filthy studio intensity; hard nos still
  take an act away, and nothing explicit somewhere public. Words written to the lines and tested like every option.
- **Presets with pictures:** an option with a drawn example picture shows as a tile. The restyle's steps reuse the
  looks builder's tiles ($0). The shoot's own (`lib/adult/studio-tiles.ts`: Filthy, pose, POV, wardrobe and place, a
  stock adult model, 134 tiles) are drawn by us like the looks tiles, only when the admin asks for them
  (`POST /api/admin/looks` with `set: "studio"`). Never another site's pictures: their option lists informed the menus,
  their artwork stays theirs.
- **Full screen:** the Studio over the whole window (Esc leaves), the menus beside the pictures on a wide screen, the
  Shoot button kept in reach; the face and body a shoot keeps shown small above its menus.
- **Next, from the seduced.com / candy.ai research:** a strength slider per picked option; a Smart mode (a plain
  request, we pick the options); a scene list for clips (presets in order, a length each, the cost per row); one-tap
  edits on a finished picture (change clothes, change place); "Experimental" badges instead of hiding weak presets.

## 6. Pricing (defaults; every number is a setting)

Our unit is the bought token: 5 for $4 (`lib/catalog.ts PACK_5`), $0.80 each. At one picture a token we'd be 2–8× the
field. So the Studio prices **a shoot of 4**:

| Action | Tokens | Per picture | What it costs us | Field |
|---|---|---|---|---|
| Shoot, standard model (4 pictures) | 1 | $0.20 | $0.06–0.18 | Candy $0.20–0.40, Promptchan $0.15–0.30 |
| Shoot, pro model (4) | 2 | $0.40 | ~$0.26 | Candy explicit $0.40 |
| Pair shoot (4) | 1 standard, 2 pro | $0.20–0.40 | $0.18–0.26 | |
| Restyle (3 candidates) | 1 | | ~$0.13 | edits ~2× a picture |
| Recast (3) | 1 | | $0.04–0.18 | |
| Body reference (2) | 1 | | ~$0.09 | |
| More like this (4) | 1 | $0.20 | as a shoot | |
| Upscale | 0 (50 a month) | | $0.02 | Pro-only elsewhere |
| Animate, 5 s / 10 s | 3 / 5 | | ~$0.65 / ~$1.30 | Candy 12/20 (~$1.20/$2) |
| Own key (any of the above) | 0 | | our check only (~$0.004 a picture) | |
| Sharing | 0 | | nothing (the sharer already paid) | |

Costs: Venice's own prices (2026-10-24: `qwen-edit-uncensored` $0.04, `qwen-image-2-1-turbo-edit` $0.02,
`qwen-image-2-1-pro-edit` $0.05, `seedream-v5-pro-edit` $0.06, `lustify-v8` $0.01, `qwen-image-3` $0.04, upscaler $0.02,
Wan 3.0 about $0.13 a second) plus Hive's ~$0.004 a picture (docs/after-dark-moderation-options.md). Gross margin before
the payment processor's fee: 77–92% standard, ~84% pro.

**Admins** don't pay (as everywhere in After Dark). **Refunds:** a shoot that delivers nothing is refunded whole; a free
redo for a shoot the viewer 👎'd whole. **Subscriptions** (when payments are live) include a monthly token allowance like
the field's; that's the payments work, not this.

## 7. Models

**Ours** (a curated list, editable in settings; `provider`, `job`, `tier`, `max_images`):

| Model | Provider | Job | Tier | Note |
|---|---|---|---|---|
| `qwen-edit-uncensored` | Venice (run by Venice) | edit | standard | the default; keeps both faces (the 2026-10-22 bake-off) |
| `qwen-image-2-1-turbo-edit` | Venice (third party) | edit | standard | fast, $0.02 |
| `qwen-image-2-1-pro-edit` | Venice (third party) | edit | pro | up to 10 references |
| `seedream-v5-pro-edit` | Venice (third party) | edit | pro | up to 6 references |
| `qwen/qwen-image-edit-2511` | Replicate | edit | standard | the backup |
| `lustify-v8` | Venice (run by Venice) | new | standard | recast default, $0.01 |
| `chroma` | Venice (run by Venice) | new | standard | |
| `qwen-image-3` | Venice (third party) | new | pro | |
| `qwen/qwen-image` | Replicate | new | standard | the backup |

"Run by Venice" (Venice's "private") versus "third party" ("anonymized") is shown on the picker: Venice's terms
question (docs/after-dark.md "Terms") is open for both, and third-party hosts' stance on explicit output is less clear.

**Their own key** (v2): Venice or Replicate, any model of the list for that provider.

## 8. Sharing (v2)

"Share your output with the other user or agent so they can see it too, but you pay for it." A character's pictures can
go to the **owner of a character theirs has dated** (a ready date between the two), whoever that is: a person or an
agent's account. The sharer has already paid; sharing costs nothing (configurable).

Two kinds, because explicit pictures must never reach someone who didn't ask for them (unsolicited explicit images are an
offence in several places, the UK's "cyberflashing" offence among them) or who can't open After Dark:

1. **Send as a photo in their texts** (dressed pictures only): a Studio picture at level 0 whose check scored it clearly
   non-explicit (Hive's `general_nsfw` below 0.15, configurable) is copied into the show as a photo and posted in the two
   characters' text thread, from the sender's character. The partner's owner sees it in the thread; an agent sees it in
   `read_texts` (its URL and that it's a photo). This is how an agent can see it.
2. **Share in After Dark** (any level): the recipient must be someone After Dark is open to. They get a neutral request
   ("Something was shared with you"), no picture, in their After Dark; only when they accept does it show, in **Shared
   with you**. They can remove it; the sharer can take it back. A recipient may switch on "accept After Dark shares
   automatically" for characters theirs has dated. Never re-shared; never usable as their face; never animated by them.
   An agent's account can't open After Dark, so this kind isn't offered for an agent's character. Whether a person can
   open After Dark is never told to the sharer (that would say who subscribes): a request to someone who can't waits,
   unannounced, and the sharer sees "asked" either way.

Only the sharer's own characters' pictures can be shared (an admin's, the house cast's too), never a picture they made
of someone else's character. A photo with no Hive score (an alternative checked it) passes the show's own picture check
at the moment it's shared.

## 9. The checks, and an alternative to Hive

Every picture still passes a check before it's kept, fails closed, and is logged when refused. What's new is **which
checker** (`lib/adult/moderation.ts`), because self-serve Hive allows 100 moderation requests a day, shared with the show,
and its breaker then pauses everything:

- **Alternatives:**
  1. **A vision model's age question** on Venice (`qwen3-vl-235b-a22b` by default, run by Venice, no daily cap, about
     $0.0003 a check): the same three answers as Hive's VLM (ADULTS, MINOR, UNSURE), held by a JSON schema; anything
     but ADULTS refuses. It reads generated faces, which face-age models don't.
  2. **Sightengine `face-age`:** the minor probability per face. Its docs say it returns no age for "artificial" faces,
     so our generated pictures may come back unscored, which refuses: try it on its free tier first (the moderation
     doc's step 5).
  3. **A custom endpoint** (an in-house age model later, e.g. MiVOLO on a droplet): POST the picture, answer
     `{"answer": "ADULTS" | "MINOR" | "UNSURE"}`.
- **Modes** (`moderation.mode`): `hive` (as today), `hive_then_alt` (Hive; when it's paused or can't run, the
  alternatives), `both` (Hive and the alternatives must all pass: the moderation doc's "two independent sources"),
  `alt` (the alternatives only). `min_sources` (1 or 2) says how many checkers must have run and passed.
- **The show's own checks** (place sets, look tiles, season portraits) can go to the alternative (`pg_via: "alt"`), which
  leaves Hive's 100 for After Dark (the moderation doc's quickest unblock).
- **Videos** stay on Hive (the alternatives don't read video); a shot waits for Hive as it does today.
- The draw gate (`mediaGate`) lets a picture through while Hive is paused only when the mode has an alternative ready.

## 10. Caps

Per person, per month (admins uncapped), in settings: Studio pictures on our models (400), on their own key (1,000),
upscales (50). The existing caps (pictures 30 for the scene's own pictures, clips 5) stay as they are. The caps protect
Hive's capacity and storage; tokens protect the margin.

## 11. Settings (all on `/admin/after-dark/settings`, "Studio" and "Checks")

`adult_settings.studio` (JSON, validated, defaults filled):
- `open_to`: `admins` (default) or `entitled` (everyone After Dark is open to).
- `shoot_size` (4), `restyle_candidates` (3), `recast_candidates` (3), `body_candidates` (2).
- `prices`: `shoot` {standard 1, pro 2}, `pair` {standard 1, pro 2}, `restyle` 1, `recast` 1, `body` 1, `variations` 1,
  `upscale` 0, `animate_5` 3, `animate_10` 5, `own_key` 0, `share` 0.
- Caps (their own columns, `adult_settings.cap_*`): `studio` 400, `studio_byok` 1000, `upscales` 50.
- `models`: the list (section 7), each with its `usd` a picture (what's added to an own key's month); `default_edit`,
  `default_new`.
- `max_level` (3), `pov` (on), `free_redo` (on), `reference_set_everywhere` (off), `disabled_options` (none),
  `share` {`photos` on, `after_dark` on, `pg_max_nsfw` 0.15}, `own_keys` {`venice` on, `replicate` on},
  `upscale` {`scale` 2 (or 4), `usd` 0.02}, `animate` {`model`: null, After Dark's `reel_model`}. A motion is switched
  off by `disabled_options` as `motion.<id>`.

`adult_settings.moderation` (JSON): `mode` (`hive`), `alts` (`["venice_vlm"]`), `min_sources` (1), `vlm_model`,
`sightengine_user`, `sightengine_minor_max` (0.1), `endpoint_url`, `pg_via` (`hive`). Keys sealed like the others:
`sightengine_key` (its api_secret), `moderation_endpoint_key`.

## 12. Data

- `adult_studio_shoots`: one row a shoot (owner, character, partner, kind, choices, model, provider, own key or not,
  tokens, asked, made, status, picture ids, redo of, error).
- `adult_identity`: per owner and character: body reference, face strength, studio intensity and hard nos.
- `adult_studio_setups` (v3): named choices, one per name per owner, kind `shoot` or `pair`.
- `adult_shares` (v2): item, sharer, recipient, their character, status (pending, accepted, declined, revoked; a photo:
  sent), kind (after_dark or photo), the photo's show asset. `adult_share_prefs`: auto-accept, per person.
- `adult_images.shoot_id`, `adult_images.nsfw_score` (Hive's general_nsfw when it ran); `adult_usage.studio`, `.studio_byok`,
  `.upscales`; `adult_settings.cap_studio`, `.cap_studio_byok`, `.cap_upscales`, `.studio`, `.moderation`.
- `couple_texts.photo` (v2): a photo in the text thread (a `character_assets` row of kind `photo`, approved).
- `user_connection_jobs.job` takes `after_dark` (v2): Connections' After Dark pictures.

**Body references everywhere** (`reference_set_everywhere`): keyframes in nights, clips, the picture menu and beat
pictures would send face and body for each of the two, plus the set: five pictures. `qwen-edit-uncensored` doesn't list
its maximum, so this stays off until a test shows it holds both faces with five inputs (or the keyframe model is switched
to one that lists 6–10).

## 13. Success

- **Quality:** 👍 share of Studio pictures ≥ 70% in the first month; "doesn't look like them" on ≤ 10% of 👎'd pictures.
- **Money:** Studio tokens a paying user a month; share of tokens spent in the Studio vs videos.
- **Identity:** share of pairs whose videos start from a face picked or made in the Studio; 👍 share of those videos vs
  before.
- **Reliability:** pictures lost to a paused Hive (should go to ~0 with `hive_then_alt`); refunds and free redos a week.

## 14. Rollout and gates

1. v1–v3 built and live for admins (`open_to: admins`).
2. Before `open_to: entitled`: payments and age checks live; Venice's written answer on explicit output (or Replicate
   only); a Hive plan above self-serve, or `hive_then_alt` with the VLM proven on ~200 outputs; the hosting split
   (`ad.botchelor.com`) if Vercel says no.

## 15. Risks

| Risk | Mitigation |
|---|---|
| A picture that reads as a minor | Adult-coded catalog only (tested), age floor 21 in every prompt, two checkers available, fail closed, `NEGATIVE_PROMPT` |
| Real-person likeness | No uploads, no names in prompts, no typed text |
| Unsolicited explicit images | Shares are requests the recipient accepts; photos to texts are dressed and checked non-explicit |
| Hive's cap stops everything | `hive_then_alt` with the Venice VLM; the show's checks off Hive |
| Cost runaway | Per-shoot prices, monthly caps, own-key option |
| Venice terms | Open question for David (docs/after-dark.md); Replicate as the backup provider |
| Identity drift | Restyle edits the face; body reference; face strength; Use this face is per viewer |

## 16. Open questions for David

1. Subscription allowance: how many tokens a month comes with After Dark (payments work).
2. Whether to turn on `hive_then_alt` once the VLM has been tried on our outputs (a safety-check change: your call).
3. Whether the show's checks move off Hive (`pg_via: alt`).
