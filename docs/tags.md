# Tags

One vocabulary for roleplays, characters and (later) shows, shared by the show, companions and After Dark
(David, 2026-11-17: "bring this level of tagging, themes, roleplay in … keep in mind the characters relational db and
social structure as well as NSFW and SFW").

| File | What it holds | Who may import it |
| --- | --- | --- |
| `lib/tags.ts` | The shared PG tags (setup, theme, type), census demand, stage → setups, public status | Everyone, client and server |
| `lib/adult/tags.ts` | After Dark's own: the `dark_romance` theme and the `heat` facet, its shelves and groups | After Dark only (`tests/adult-imports.test.ts`) |

## Where it came from

The Character Image Census (David's research artifact, 2026-11-17) covers 11,160 characters on 40 platforms, each
ranked by popularity on its own platform, plus 38,912 Chub cards over time. Demand is the average popularity percentile
of characters with a tag, divided by the pool average, so 1.00× is an average character. What it taught us:

- The **setup between two people** and the **character's type** move popularity far more than genre does. Rivals
  (1.15×), second chances (1.21× on adult characters), friends to more (1.21× adult), fake dating (1.18×) and roommates
  (1.13×) beat strangers (0.99×, 0.83× safe-for-work). A dating show is rare (0.6% of characters) and does well on adult
  ones (1.22×).
- The most common setup (the default girlfriend or boyfriend) is exactly average. Rarer setups with some push and pull
  do better.
- Among themes, mystery (0.83× safe-for-work) and comedy (0.81×) are the weakest. Crime (1.16×), spooky (1.12×), everyday
  life (1.11×) and drama (1.08×) do well.
- **Settings barely move popularity** (0.81× to 1.06×), so places stay the venues' job and aren't tags.
- Story depth is best in the middle: cards with no story (0.91×) and very long ones (0.92×) both do worse.

Each tag's `census` holds its demand for safe-for-work and for adult characters (null where the study had no category or
fewer than 15 characters). That's only a starting point: pickers order by it until Botchelor's own picks say otherwise
(`lib/tag-demand.ts`, next PR).

## Facets

- **Between them** (`setup`): rivals, second chance, friends to more, fake dating, stuck together, roommates, work
  (on the show always as equals), bodyguard, forbidden, opposites, slow burn, already together, on a dating show,
  strangers.
- **Kind of story** (`theme`): drama, everyday, heists & spies, spooky, fantasy, supernatural, sci-fi, adventure,
  action, royalty, romance, cozy, sports, period, mystery, funny. After Dark adds dark romance.
- **Type** (`type`): what kind of person a character is. Cold then warm, hard to get, takes charge, rebel, dark & moody,
  morally grey, jealous streak, dangerous charm, high-flyer, loyal, nerd, not quite human, protective, flirt,
  sweetheart, sunshine, grump, mysterious, playful, hopeless romantic. Labels are plain words, never fandom jargon
  ("Hard to get", not "tsundere").
- **Heat** (`heat`, After Dark only): tender, tease, praise, dressing up, size difference, gently in charge, dom & sub,
  switch, dirty talk. A heat that touches a hard no names it (`hardNo`: dominance, dirty_talk), so Set the scene marks a
  roleplay whose heat runs into the pair's limits. The tag never overrides the limit.
- **Status** (never chosen): single, seeing someone, taken, married. It's read from the relationship graph's **public**
  layer only (aired dates). A private date never changes it.

## Roleplays

Every house roleplay carries `tags`: on the show one or more setups and then themes (setup first), on After Dark setups,
themes and heat. The old `tag` (show) and `category` (After Dark place shelves) are still there for MCP and older code.

- **Show picker** (`app/RoleplayPicker.tsx`): two rows of chips, "Who they are to each other" and "Kind of story",
  each ordered by demand. Each tile lists its tags. On a phone each row scrolls sideways.
- **For these two**: on a couple's page the picker gets the pair's stage (as the viewer may see it) and offers the
  roleplays whose setups fit it (`SETUPS_FOR_STAGE`), opening on that shelf. Exes and couples who broke up get second
  chances, bad blood gets rivals and forbidden, couples get the ones for couples, friends get friends to more. It's a
  suggestion only: every roleplay stays open to every pair.
- **After Dark** (Set the scene): the roleplay step's shelves are now tags (✨ Yours, setups, then themes and heat), each
  with a count. Each card lists its tags, and a heat that clashes with the pair's hard nos says so. Step in's dropdown
  groups by each roleplay's first setup.

## Characters

Each character carries up to 4 **type** tags in `character_tags` (`lib/character-tags.ts`). The row is keyed to the
character with a cascading foreign key, so it has no person column. A character has tags from one source at a time:

- **owner**: picked by the owner on /create or the edit page (the "What kind of person?" chips), or over MCP
  (`create_character` / `update_character` `tags`). An empty pick hands them back to the show.
- **house**: the show's hand tags for its code-defined cast (`HOUSE_TAGS`).
- **auto**: read from the traits, plus a few plain nouns in the bio ("a vampire", "a bodyguard"), by `autoTags`. Everyday
  bio words are never read. A create or an edit refreshes these, and the lobby job fills any character without tags,
  200 a pass (`fillCharacterTags`; step-in personas are skipped).

Where they show:

- **/characters**: a quiet line on each card, and the search takes "Any type" and "Any love life" menus
  (`?type=&status=`), with or without words.
- **/companion**: the same line on each tile, and Type and Love life filters. Each menu lists only what someone in the
  list has.
- **MCP 2.36.0**: `get_character` (`tags`, `tags_from`, `love_life`), `search_characters` (`type` and `love_life`
  filters, and both on each result), `companion` list cards, and the roleplay catalog's `tags`.
- **Account export**: each character's tags, with where they came from.

**Love life** (single, seeing someone, taken, married) is the most committed public stage across a character's pairs
(`statusOf`). It's read in SQL by `statusSql` (built from the same mapping, so the two can't disagree) from
`public_shown_stage`, or `public_stage` when there is none. A private date, or anything only an owner can see, never
changes it. It's never stored.

## Demand

The census is someone else's numbers. Once people pick on Botchelor, the pickers lean on ours instead
(`lib/tag-demand.ts`, After Dark's in `lib/adult/tag-demand.ts`).

- **What counts.** On the show: the roleplay of each date (`episodes.setup.roleplay`) and each companion scene
  (`companion_threads.roleplay`), and for types, each companion conversation by the tags of whoever it's with. In
  After Dark: the roleplay of each Set the scene (`adult_scenes.roleplay`) and each Step in
  (`adult_step_in_scenes.roleplay`). The last 90 days; one written for the date ("custom") counts toward nothing.
- **Whose.** Real people's and agents' only. Admins, reviewers, our own MCP clients and test characters
  (`loadOurIds`, `lib/our-traffic.ts`) are left out, or our live checks would set the order.
- **The number.** A tag's share of the picks divided by its share of what's on offer: 1.00× is picked as often as
  it's offered. Our counts are small, so it's capped at 3× and then shrunk toward the census:
  `(picks × ours + 30 × census) ÷ (picks + 30)`. One pick moves a tag a few hundredths; a hundred mostly speak for
  themselves.
- **Who reads it.** The show's pickers fetch `GET /api/tags/demand`: roleplays on dates and in companion scenes, the
  type chips on /create, the type menus on /characters and /companion. After Dark's Set the scene and Step in fetch
  `GET /api/admin/after-dark/tag-demand` (members only). Both are cached an hour, and both pickers start in the
  census's order, so nothing waits on them.
- **Where to look.** Admin → Tags (`/admin/tags`) has the show's tables, picks, supply, ours, the census and the
  blend; After Dark's are at `/admin/after-dark/tags`.

## Never

On either side, none of these is ever a tag, a label or a description, whatever the census said:

- school, teachers and students;
- family and step-family;
- anyone young;
- captor and captive;
- non-consent;
- incest framing;
- mind control;
- sex work;
- obsession (yandere);
- bullies;
- restraints;
- real or famous people.

Several of these drew strong demand (non-consent 1.25×, family setups 1.27×, captor 1.21×, incest framing 1.16×). They
stay out because the show's and After Dark's lines say so. `tests/tags.test.ts` checks every id, label and description
against this list, and every shared tag against the show's own check (`checkShowText`, `excludedTheme`).

## Not yet (David's call)

These are not refused by After Dark's lines as such, but wait on what the payment processors accept
(docs/after-dark.md, the processors section):

- breeding (1.30×; it's also a hard-no chip, `pregnancy`);
- group scenes (1.26×);
- degradation (1.22×; also a hard-no chip);
- pet play (1.17×);
- feet (1.09×);
- futa (1.09×).

Exhibitionism has its own hard no (`watched`) and isn't a heat tag yet.
