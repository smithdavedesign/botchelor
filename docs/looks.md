# The looks builder

David, 2026-10-19: *"now that we have a cloud model to support image creation, let's allow more custom characters… add a NSFW and a normal one both following exactly the same flow as"* candy.ai's character onboarding, *"use the cloud models to create carbon copies… for the nsfw use our paid model… only for the characters looks… a few baselines… if they haven't subscribed/paid it's blurred out."*

## The flow

The `/create` Look step (and the editor) opens with a builder that has one picture tile per option and moves on when you pick. The steps follow candy.ai's onboarding:

| # | Step | Options |
|---|------|---------|
| 1 | Who are they? | Woman · Man |
| 2 | Style | Realistic · Anime |
| 3 | Ethnicity | Caucasian · Asian · Black / Afro · Latina/Latino · Arab |
| 4 | Age | a row of numbers, 18–60 (sets the sheet's age) |
| 5 | Eye colour | Brown · Blue · Green · Hazel · Grey |
| 6 | Hair style | women: Straight · Bangs · Curly · Bun · Short · Ponytail; men: Short · Buzz cut · Slicked back · Curly · Long · Man bun |
| 7 | Hair colour | Brunette · Blonde · Black · Red · Silver · Pink · Blue |
| 8 | Body | women: Slim · Athletic · Average · Curvy · Plus-size; men: Slim · Athletic · Average · Muscular · Stocky |
| 9 | Bust (women) / Facial hair (men) | Small · Medium · Large · Extra large / Clean-shaven · Stubble · Short beard · Full beard · Moustache |
| 10 | Outfit | Casual · Smart · Sporty · Evening · Streetwear · Swimwear |

The **🌙 After Dark** tab runs the same steps. Its body, bust and outfit tiles are explicit. It adds a **butt** step for women, and its outfits are Lingerie · Bikini · Robe · Nude (men: Briefs · Towel · Robe · Nude).

Some of candy.ai's steps were left out on purpose: its Relationship list (step-family, school and teacher roles cross our two lines, and characters here date each other, not the user), and Personality, Voice and Kinks. The wizard's Voice and Soul steps already cover personality and voice. This builder covers looks only.

## Who sees what

- The picks are stored in `extras.looks` (`lib/looks.ts`, validated against the fixed option ids). They write the character's **appearance line**. Every picture prompt already reads that line: the show's portrait, and After Dark's `physicalLook` (`lib/adult/media.ts`). The builder replaces the line as the picks change, unless the creator typed their own.
- `looks.after_dark` (butt and the After Dark outfit) is **private**: `publicExtras` strips it from every view except the owner's. It is **kept only for an account that can open After Dark** (`canAfterDark`). For everyone else, it's dropped on save (`gateAfterDarkLooks`).
- **Locked tab:** someone who can't open After Dark sees the tab blurred, under a "Subscribe to unlock" card (→ `/after-dark/subscribe`). What sits under the blur is the *show's* tiles. `/api/looks/nsfw-*` answers 404 to anyone who isn't entitled, so an explicit picture never reaches them, even through dev tools.
- `adultLookWords(looks)` returns the bust and butt words for After Dark's picture prompts. `nearestBaseline(looks)` names the stock baseline closest to a look (see below). Neither is wired into `lib/adult/*` yet, because botchelor-4a owns that code.

## The tiles

`tileSpecs()` lists every tile (131 in all):

- **81 show tiles**, drawn on fal, `fal-ai/flux/dev`, 512×640, fal's safety checker on.
- **25 After Dark option tiles**, drawn on Venice with After Dark's model (`lustify-v8`, safe mode off).
- **25 After Dark stock baselines**: nude, waist-up, face to camera. One for each gender × ethnicity × body type (women: slim, athletic, curvy; men: athletic, average). After Dark can start from these.

Each row of tiles keeps one fixed model and seed per gender, and changes only the step's own option, so the tiles compare like for like. Each prompt is written out in full:

- framing per step: the eyes step is a close-up of the eyes, body steps are full length, the butt step is a rear three-quarter view with the face still visible;
- a fixed studio and lens;
- the age, which is never under 21 in a picture;
- "a single person";
- show tiles add "no nudity", and After Dark tiles add "Everyone shown is an adult".

The aim is a good tile on the first try, with nothing redrawn.

**Screening:** Hive screens every tile before it's kept (`lib/adult/check.ts`):

- *Show tiles:* the child classifier and the VLM age check ("ADULTS"). fal's own safety checker refuses anything explicit, so Hive isn't asked twice: self-serve Hive has a small daily quota (it 429'd for the rest of the day after the first draw), shared with the site's sets and After Dark.
- *After Dark tiles:* the child classifier and the VLM age check.

A refused tile is stored as `refused` with its reason, never its picture, and is never redrawn. If a tile isn't drawn, the builder shows its label instead (as it does locally and in tests).

**Cost:** about 81 × 1.3¢ (fal) + 50 × 1¢ (Venice), plus one or two Hive calls each. That's about $1.50 once, from the admin's keys in After Dark's settings.

**Drawing them:** `POST /api/admin/looks` with `x-frontier-key` or an admin session, body `{ "limit": 40, "variant": "pg" | "nsfw", "only": [ids] }`. It draws up to 40 per call (12 is a good batch), one at a time with a short pause, and stops when a provider rate-limits. A picture Hive couldn't screen (busy) is kept unshown and only re-screened next run, never drawn twice. `GET` shows progress and any refusals.

## The portrait

Once looks are picked, creating the character draws its **portrait** from them in the background: head and shoulders, dressed, PG, on fal, and screened like a show tile. It goes into the asset ledger (`prompt_version` `looks-v1`) and becomes the avatar everywhere.

- It's built only from the fixed option words, never from typed text.
- In the editor, the owner can draw it again with "Draw a portrait from their looks".
- **Caps:** 3 per character, and `LOOKS_PORTRAITS_PER_DAY` across the site (default 150, about $2 a day at most).
- `POST /api/characters/:id/looks-portrait` (owner only).
- The BYOK OpenAI portrait still works alongside it.

## Next: tiles that follow your picks (planned, not built)

David, 2026-10-19: *"I expect that each decision changes the next image… if I click Asian the next models should all be Asian."* He approved the plan below ("I trust your judgement").

### What changes

Today every row shows one fixed model per gender. Under the plan, a tile's model also follows the **style** and **ethnicity** already picked: pick Anime, then Asian, and every eye, hair, body, bust and outfit tile after that shows an Asian anime character.

| Tab | Carries forward | Tiles |
|---|---|---|
| Normal | gender × style (realistic, anime) × ethnicity | ~690 (about 345 realistic and 345 anime) |
| After Dark | gender × ethnicity, realistic only | ~125 |
| **Total** | | **~815 tiles, about $10 once, about 1,630 Hive checks** |

### What deliberately doesn't carry

- **Every pick.** Making each click change every later tile needs about 690,000 tiles (about $9,000 and 1.4 million Hive checks), because each step multiplies the ones after it. Ethnicity and style change a picture most. Eye colour, hair, body and outfit are what each tile shows anyway. Your exact mix is drawn once, at the end, as the portrait.
- **Drawing rows live as you click** (about 45 pictures and 90 Hive checks per character). It would hit Hive's limit within a few characters.
- **Hair colour into the body, bust and outfit rows.** This is option B: about 2,400 tiles, about $30 and 5,000 Hive checks. Do it later, if A lands well and Hive's limit allows.

### After Dark is realistic only

Explicit pictures are drawn steering away from cartoon and anime styles (`NEGATIVE_PROMPT`, `lib/adult/media.ts`), because Hive's age check can't reliably read a drawn face's age, and anime faces often read young. So:

- an anime character's After Dark tab says **"After Dark is realistic only"**, with no tiles;
- After Dark tiles carry gender × ethnicity only;
- loosening this is David's call, and the advice is not to.

Expect some **anime show tiles** to be refused by the age check ("UNSURE"), even with "a clearly grown adult with mature adult proportions" in the prompt. A refused tile shows its label. If a row has many refusals, re-prompt it under a new tile id. Don't retry the same prompt.

### Before starting (all must be true)

1. **Hive answers 200.** Run `curl` on `api/v3/hive/visual-moderation` with the keychain key `vault/botchelor/HIVE_SECRET_KEY`. Or run scratchpad `draw-looks.sh`, which checks Hive first and exits 2 without spending.
2. **#394 is merged and deployed** (reels back off when Hive is busy), and no reel is stuck in `making`. Check with `after_dark_reel` `{a, b, list: true}` for each pair that has videos. A stuck reel polled by open pages kept Hive rate-limited on 2026-10-19.
3. **No other Hive-heavy work is running**, such as a batch of videos of the night: a video shot is ~10 MB and may count per frame. Sets and portraits are fine.
4. **The current 131 tiles are fully drawn** (`GET /api/admin/looks`), so a failed run never leaves the builder worse than today.

If Hive keeps locking up even with all four true, the plan's limit is the problem: ask Hive support to raise it before drawing ~1,600 checks' worth.

### How to build it

1. **`lib/looks.ts`**
   - `tileSpecs()` loops over `style × ethnicity` (normal) and `ethnicity` (After Dark) for every step after ethnicity.
   - Each spec takes its base model from those picks instead of `DEFAULTS`.
   - New id shape: `pg-<gender>-<style>-<ethnicity>-<step>-<option>` and `nsfw-<gender>-<ethnicity>-<step>-<option>`.
   - The style and ethnicity rows keep today's ids, so the 131 drawn tiles stay valid.
   - Keep the seed per gender, plus a fixed offset per ethnicity, so one model per row.
2. **`tileId(...)`** takes the looks so far. The builder resolves a tile in this order, and only asks for a tile id that's in the drawn list:
   1. the carried tile;
   2. today's generic tile (until the carried one is drawn, or if it was refused);
   3. the label.
3. **`LooksBuilder.tsx`**
   - Pass `looks` into `tileId`.
   - On the After Dark tab, if `style === "anime"`, show the "After Dark is realistic only" note instead of the grid.
   - The locked (blurred) After Dark tab keeps showing the show's tiles, never an explicit picture.
4. **`isTileId`** accepts the new shape. `/api/looks/[id]` still serves `nsfw-*` only to `canAfterDark`.
5. **Tests** (`tests/looks.test.ts`):
   - the counts (about 690 normal and 125 After Dark);
   - ids are unique;
   - every carried prompt names the carried ethnicity and style;
   - anime never appears in an `nsfw-*` spec;
   - fallback order: carried, then generic, then label.
6. **Ship it as one PR**, then draw.

### How to draw them

- **Pace for Hive:**
  - `POST /api/admin/looks` with `{ "variant": "pg", "limit": 6 }` every few minutes, not one big run.
  - Raise `pauseMs` (`lib/looks-draw.ts`) to about 20–30 s for this batch, or add a `pause_ms` body option, so one call never bursts.
  - At about one tile every 30–60 s, 815 tiles take roughly a day. Run it from a session cron, like the tile retry on 2026-10-19 (`draw-looks.sh` hourly).
- **Order:** realistic normal tiles first (most characters), then After Dark, then anime. Something useful ships early, and anime refusals don't block the rest.
- **Watch:** check `GET /api/admin/looks` progress and refusals after each run.
  - If a run stops on a 429, wait for the next scheduled run; don't retry by hand.
  - If anime refusals are above about a third of a row, stop and re-prompt that row.
- **Cost check:** about 815 × 1.3¢ (fal) + 125 × 1¢ (Venice), about $10, from the admin's keys. A tile Hive couldn't screen is kept and re-screened, never drawn twice.

### Related follow-ups (offered, not approved yet)

- **Portraits wait for the check instead of failing.** Today a portrait drawn while Hive is busy is thrown away and returns 502, and the fal cost is lost. Instead, keep it unapproved and re-screen it like tiles, with the page saying "Portrait drawn, waiting for the safety check".
- **An After Dark portrait at creation.** For accounts that can open After Dark, draw the character's After Dark baseline from their looks (bust, butt and outfit included) when the character is created, so it's ready the first time a scene turns explicit. `adultLookWords` and `nearestBaseline` in `lib/looks.ts` are built for this. That code is botchelor-4a's lane.
