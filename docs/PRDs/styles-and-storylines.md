# Styles, show kit and storylines

David, 2026-11-17: "Read the Botchelor Asset Brief Themes & Prompt Library and pair with your findings. update and
create a PRD to bring all styles, storylines, roleplay, themes, asset styles, etc to Botchelor." His calls the same day:

- 2.5D only if it costs nothing: local, or a free cloud tier.
- Anime in After Dark is fine, but it comes last.
- The brief stays private. This PRD is public, so it names platform kinds ("chat apps", "companion apps"), never
  platforms, and only aggregate census numbers.
- Phases 1–7 approved ("agree tackle all of this 1-7"). Phase 8 waits for its gates.

The census behind this covers 39 public character platforms: about 14,400 characters on the dashboard and 27,000 tagged
cards from one community site. It lives in a private research library. No census picture is ever used as an input or
reference.

## Where we start

- **Tags and roleplays** (#1784–#1788, [tags.md](../tags.md)) are in place:
  - setups, kinds of story and character types, with census demand per tag;
  - 49 show and 43 After Dark roleplays, all tagged;
  - character tags and love life on /characters, /companion and the MCP;
  - our own pick counts blending in as they grow.

  This PRD builds on them and doesn't redo them.
- **Pictures:**
  - Show pictures are drawn on fal: flux/dev with fal's own safety checker (`lib/looks-draw.ts`). Sets use
    flux/schnell (`lib/sets.ts`). Season newcomers use Venice (`lib/season-gen.ts`).
  - The show's own check is `checkMedia(…, "pg_image")`, which goes to the Venice vision model by default rather than
    Hive's 100-a-day quota. It asks about age; fal's checker covers explicit content.
  - The only style switch is realistic or anime (`isAnime`, `lib/looks.ts`), used in about 11 files.
- **Expressions:** the calls' face kit (`lib/face-kit.ts`) already makes stills of the same face with a new expression.
- **Story:**
  - story state, house scenes, confrontations and challenges, and the overnight producer (`lib/producer.ts`, beats
    `surface_claim`, `same_room`, `rival_date`);
  - formats, including `ex_returns`; group dates; the relationships graph.
  - A season holds four: two stay, and two newcomers are drafted from the 20th.
- **Originality:** `lib/originality.ts` compares a sheet with Botchelor's own characters only. Nothing checks for franchise
  characters.

## What the census says

| Finding | Number |
| --- | --- |
| Rank by art style, across platforms | anime 1.08×, 2.5D 1.05×, photoreal 0.92×, cartoon 0.77× |
| On companion apps (78% photoreal) | anime 1.09×, photoreal 0.94× |
| Dating-show characters | under 1% of characters (65), rank 1.14× |
| Setups that rank above average | fake or arranged 1.16×, rivals 1.15×, exes 1.14×, best friends 1.14× |
| Helpers | the most common setup (16%), average rank (1.01×) |
| Group setups | 1.07× |
| Characters written for any point of view | 1.18×, but only 2% of characters |
| Profile length | 400–999 words in total 1.17×; full depth (a 400+ word description) 0.60×; 2,000+ words 0.91× |
| Franchise characters | about a third of the big chat apps' catalogs, 42% of one |
| Youth-coded characters removed by the census's safety gate | 29–60% on adult companion apps |

Chat apps lead with men written for women users, and companion apps sell women. The newest uploads lean male. A clean,
clearly adult show format is an open lane.

## Rules that don't move

- **The engine decides every ending.** Storylines only steer prompts, wants, roleplays, settings and lines.
- **Show pictures are flirty, never explicit.** Everyone reads 25 or older. No real faces go in as inputs. A
  character's own hero card is the only reference picture.
- **Originals only:** no franchise characters, real people or brands.
- **No new spend.** The free tier comes first, and today's paid paths stay as fallbacks inside today's caps.
- **After Dark keeps drawn styles out** until phase 8's gates are met.

## 1. Free pictures and the 2.5D pilot

**Workers AI.** `lib/workers-ai.ts` draws through Cloudflare Workers AI's REST API. Its free allowance is 10,000 neurons a
day, reset at 00:00 UTC.

| Model | Used for | Cost |
| --- | --- | --- |
| `@cf/black-forest-labs/flux-2-klein-4b` (Apache 2.0) | portraits and shots from up to 4 reference images (each under 512×512) | 26.05 neurons per 512×512 output tile, 5.37 per reference tile: a 640×800 portrait ≈ 104 |
| `@cf/black-forest-labs/flux-1-schnell` | empty sets (the model the sets already use on fal) | 4.8 a tile plus 9.6 a step: a 16:9 set ≈ 67 |

- A daily budget (`WORKERS_AI_DAILY_NEURONS`, default 9,500) is counted in the database by UTC day. A call over budget
  returns "budget" and the caller falls back.
- On Cloudflare's free Workers plan, usage past the allowance fails rather than bills.
- Keys:
  - `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_AI_TOKEN` (Workers AI only) go on the show app.
  - The token is kept in the keychain with its cap recorded.
- **Checks:** Workers AI has no safety checker of its own. The show's check therefore also asks whether anything is
  explicit when a picture comes from a source without a filter. A refusal is never redrawn from the same prompt: the
  look changes first.

**House style tokens:**

```
semi-realistic digital illustration, painterly 2.5D, soft cinematic rim light, warm key light, shallow depth of field,
rich but controlled color, clean linework on faces, expressive eyes, reality-show promo aesthetic
```

**The pilot:**
- Five characters, nine shots each: hero 4:5, full body 2:3, confessional 4:5, and six expressions 1:1.
- Every shot after the hero is drawn from the character's own hero card.
- The batch is checked on the Mac, then uploaded through an admin route that runs the site's checks.
- **Done when** David has picked the look from a side-by-side sheet.

## 2. One art style per character

- `lib/art-style.ts` defines `realistic | anime | semi_real` ("Photo", "Anime", "2.5D") and `artStyleOf(character)`,
  read from `extras.looks.style`. Each style carries its own prompt words, negatives and age cues. The drawn styles keep
  every age word in the negatives and add "adult proportions, mature features".
- Every `isAnime` check reads `artStyleOf` instead: portraits, recast, PG Studio, identity views, the face kit,
  companions and After Dark.
- After Dark refuses both drawn styles until phase 8.
- **/create:** a third tile, 2.5D, in the looks builder's style step. Its tiles are drawn free.
- **Filters and MCP:**
  - /companion's style filter gains 2.5D, and /characters gets the same filter.
  - The MCP's create, update and get carry `art_style`.
- **Sources:** show pictures try Workers AI first and fall back to fal once the day's free budget is spent. The fal caps
  don't change.

## 3. House look and show kit

- **The house look:** the house and season cast are redrawn in the chosen look: hero, full body, confessional and six
  expressions each. That's about 180 pictures over 2–3 days of free budget, uploaded through the checked admin path.
- **Sets** (16:9, empty, no text but the sign):
  - the stage, the blind-date booth, the confessional and elimination;
  - four themed venues with their sets: a gothic manor (spooky, supernatural), a countryside picnic (cozy), a
    space-station lounge (sci-fi) and a cavern lounge (fantasy).
- **Six expressions per contestant:** smitten, laughing, flustered, smug, unimpressed and heartbroken.
  - They're made like the face kit's stills: the hero card is edited, with only the expression changing.
  - Chat bubbles (`app/ChatThread.tsx`) and the theater (`app/Scene.tsx`) show the speaker's face for the moment.
  - The moment comes from what the date already records: interest, wants met, dealbreakers hit and the ending. No
    new model calls.
- **Episode moments:** the premiere reveal (full body on the stage) and the finale's rose moment, for the season page and
  the premiere.

## 4. Storylines

- **Arcs** (`lib/arcs.ts`, table `story_arcs`) run over three dates for a linked pair: spark, then setback, then reveal.
  - **Setups:** `rivals`, `second_chance`, `fake_dating` and `friends_to_more`.
  - **Each step chooses** the pair's next date's roleplay (one tagged with that setup), its format (`ex_returns` for
    exes), each side's want and the Previously/Tonight lines.
  - **The ending stays the engine's, and the arc adapts.** A setback date that goes well gets its setback from outside:
    a rumour in a house scene. A reveal date that goes badly closes the arc as "it didn't happen".
- **Producer:** a new beat kind, `arc_step`, at most one a day. `PRODUCER=0` or `ARCS=0` turns it off.
- **Linked pairs:** season-gen drafts the two newcomers as a pair.
  - Their link (rivals, exes, a fake couple or best friends) is written to the relationships graph, along with one link
    to someone returning.
  - The draft is steered by demand gaps (`lib/tag-demand.ts`) and lineup balance: one man and one woman, unless the
    cast already leans one way.
- **Wingman duos:** on a group date, best friends arrive together, and one hypes the other.
- **After Dark:** two more bodyguard roleplays (it has one). Dirty talk stays in the backlog, because a card can't show
  it without explicit words.

## 5. Originals only

- `lib/franchises.ts` holds about 110 franchises from the census: their titles, their Chinese, Japanese and Korean titles,
  and their most-used character names. Latin text matches on word boundaries; CJK text matches anywhere.
- **Users:** a warning in the create flow's originality panel and in the MCP's create reply.
- **Our own characters are refused:** house, season-gen, recast, the cast agent, the After Dark agent cast, and After
  Dark for everyone.
- The show's negative prompts gain "logo, brand name, insignia, franchise costume".

## 6. Checks and profile depth

- **Lookalike check:** a script in the private research library compares the house and season pictures with the census
  covers (CLIP and a perceptual hash) and lists near-matches for review. It runs only on the Mac, and no census picture
  leaves it.
- **Profile depth:**
  - The Go deeper step suggests a scenario, an opening line and three lore beats revealed over dates.
  - A soft meter shows 400–999 words across the sheet.
  - Season-gen aims for the same.

## 7. Measurement

- `lib/tag-demand.ts` gains `art_style` and `lineup` facets. They count:
  - styles picked on /create;
  - style filter use on /companion and /characters;
  - companion chats started per style.
- The census prior holds until 30 real picks, as with tags. /admin/tags shows both facets.

## Later: drawn styles in After Dark (phase 8)

Gates before any drawn After Dark picture:
1. the processor's rules allow it;
2. regions whose laws restrict drawn adult content (UK, Canada, Australia) are excluded;
3. a mature-style lock;
4. a two-source age check that passes a test set of drawings.

2.5D comes before anime.

## Phases

| Phase | Done when |
| --- | --- |
| 1. Free pictures + pilot | Workers AI module, budget and explicit check are live; David has picked the look |
| 2. Art style per character | `artStyleOf` everywhere; the 2.5D tile, filters and MCP field live |
| 3. House look + show kit | cast redrawn; sets, themed venues, expressions in chat and theater live |
| 4. Storylines | an arc plays over three aired dates; newcomers drafted as a linked pair |
| 5. Originals only | franchise names warn users and refuse ours, in English and CJK |
| 6. Checks + depth | the lookalike report runs; Go deeper guidance live |
| 7. Measurement | art style and lineup show on /admin/tags |

Each phase ships as one or two PRs:
- **Gates before merge:** tsc, related tests and the visual run where pages change. Merged on green.
- **After deploy:** checked live on botchelor.com at desktop and phone size, with screenshots in the README.

## Risks

- **Quality:** klein 4B's 2.5D look, or its faces drifting across shots, may disappoint. The pilot decides. Fallbacks are
  this Mac's ComfyUI or staying photoreal.
- **One free budget for everything:** house batches and users' portraits share it. Batches take what's left after
  20:00 UTC, and users' portraits fall back to fal as today.
- **Drawn styles can read younger:** every drawn picture gets the age check, drawn styles add adult cues, and a refusal
  is never re-rolled unchanged.
- **Arcs can feel scripted:** they steer wants and settings only. The engine's ending stands, and the arc bends to it.
