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

- *Show tiles:* the child classifier, the VLM age check ("ADULTS"), and the NSFW score below 0.3.
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
