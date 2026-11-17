# Scene cards

David, 2026-11-17, after comparing Botchelor's roleplay with Chub and nine other roleplay products ([the audit](audits/2026-11-17-roleplay-vs-the-field.md)): "bring in more role play scenes, and add this level of context behind the scenes when someone chooses it for both companions, and after dark, and the show … distinguish between nsfw and sfw."

A roleplay used to be a title, a premise of a sentence or two, and two roles. Now every one of the show's own also has a **scene card**: context the person never has to read, which goes into the prompts when they pick that roleplay. It's Botchelor's version of a character card's scenario and greeting, written by us, never a prompt box.

## What a card is

`lib/scene-cards.ts` (`SceneCard`), pure and client-safe:

| Field | What it is | Limit |
| --- | --- | --- |
| `setup` | How it starts: the first minute, with `{a}` and `{b}` like a premise. | 240 |
| `wants` | What each of them wants from the evening and what's in the way: one sentence for `{a}`, one for `{b}`. | 200 each |
| `beats` | Three or four turns the story can take, in order. Possibilities, never a script, and never an ending. | 160 each |
| `tone` | The register in a few words ("slow burn, dry banter"). | 80 |
| `openings` | Three ways it can open, one sentence each. The first lines play the one that's picked. | 160 each |

`{a}` is whoever plays the first role, as in a premise.

## Where each field goes

| | Show date (`lib/roleplays.ts`, `lib/conversation.ts`) | Companion scene (`lib/companion.ts`, `lib/companion-prompt.ts`) | After Dark (`lib/adult/roleplays.ts`, `lib/adult/scenes.ts`) |
| --- | --- | --- | --- |
| `setup` | Each actor's `tonights_roleplay.how_it_starts`; the director's plan, the recap and the morning after ("How it starts: …" in `roleplayNote`) | "How it starts: …" in the scene's roleplay paragraph, from the character's side (the person is "your scene partner") | "How it starts" under the chapter's roleplay line |
| `wants` | **The actor's own only** (`what_you_want`). Each character is its own agent: it finds the other's want out by playing. | **The character's own only** ("What you want in it") | **Both**: one writer writes both sides |
| `beats` | `where_it_can_go` (an array), each actor | "Where it can go, in order" | "Where the story can go, in order" |
| `tone` | `tone`, each actor; "Its tone: …" for the director | "Its tone: …" | "Its tone: …" |
| `openings` | The chosen one as `opening`, on **each side's first line only** | In the **opener's cue** only ("It opens like this: …"), never the standing prompt | "How it opens: …" on the **first lines after the roleplay is picked** only |

What the prompts say about it, on every surface: the turns are possibilities and not a script, and nothing in a card says how the night ends. On the show the engine alone decides the ending (the actor's TONIGHT'S ROLEPLAY section still closes on "in the final act you land your intention"). In After Dark the existing rule stands, with one sentence added: the roleplay is the story and never a way into sex, and the card's turns are story turns, not a cue to move a stage on.

A roleplay someone wrote (a date's "Write your own", the Create library) has no card and is prompted exactly as before.

## Which opening plays

`openingOf(card, pick, seed)`:
- a number picks one of the card's three;
- a string is one a person wrote, already checked by whoever stored it;
- nothing picked takes one of the three by a stable hash of `seed`, so the same date always opens the same way, and not always on the first.

| Surface | Where the choice is stored | With nothing stored |
| --- | --- | --- |
| Show date | `RoleplayTerms.opening`: the opening's text, with `{a}` and `{b}`, snapshotted with the terms (`date_roleplays.terms`, then `episodes.setup.roleplay`) | `openedTerms` takes one by the **episode's id** when the date is assembled (`lib/simulation.ts`), and the setup keeps it, so a rebuild opens the same way |
| Companion scene | `companion_threads.roleplay.opening`: the same text | One by the **thread's id**, worked out each time (nothing is written) |
| After Dark | `adult_scenes.roleplay.opening`: `1` or `2` (the index) | The first. `0` and nothing are the same, and are stored as nothing |

After Dark also stores `at`: how many lines the chapter had when the roleplay was picked. A roleplay is usually picked partway through a chapter (a move doesn't start a new one), so "the first lines" are the lines written right after the pick: the opening is in the prompt while the chapter has no more lines than `at`. A rewind back to that point brings it back. The picker sends the running roleplay again with every move, so the same roleplay with the same opening keeps its `at` and doesn't open a second time at the new place; a different opening for it is a new pick, and plays. `at` is the writer's business and is left out of the scene the page gets (`publicScene`). A scene stored before this has neither field: it works as before, and its opening would only play on a chapter's very first lines.

`sameTerms` treats terms that name no opening as the same agreement as terms that name one. Two that name different openings are different.

Picking an opening: After Dark's Scene & roleplay popup shows "How it opens" under the picked roleplay's roles (`SetSceneModal.tsx`), first one selected, and sends `roleplay.opening` with the pick. The show's and the companion's pickers don't offer it yet (next: `app/RoleplayPicker.tsx`); until then those two play the hashed one. `GENERIC_OPENINGS` are three PG openings with no place in them, for a scene with no roleplay; nothing uses them yet.

## The lines

Every card, opening and roleplay is two adults who both want to be there. Never: anyone under 18 or who reads young, school, students or teachers, family or step-family, a babysitter, real or famous people, non-consent, anyone drunk, trapped, paid for it or otherwise kept from saying no.

- **The show and companions are PG.** A show card passes exactly what a roleplay someone writes must pass (`showCardIssue`: `checkShowText`, the suggestive list, the excluded themes and `DATE_ROLEPLAY_NEVER`).
- **After Dark's cards are story cards**: stakes, wants, banter, what's in the way. They never describe a sex act and use no explicit word. `adultCardIssue` holds them to After Dark's own lines (`checkAdultText`), its roleplays' never-list, **and** the show's word check, the suggestive list and a list of explicit words. How far a night goes is still the scene's own writer's and its stage rules' to decide.
- **No card names an ending** (`CARD_ENDING`: "they end up", "by the end", "falls in love", "goes home together").
- A check is never weakened to let a card through: a theme that can't be written inside the lines is dropped.

`tests/scene-cards.test.ts` runs every card through its side's function, as written, with names in, and from either side as "you".

## The roleplays

| | Before | Now |
| --- | --- | --- |
| The show (`DATE_ROLEPLAYS`) | 25 | **39**, in ten kinds (new: Slow burn, Cozy) |
| After Dark (`ROLEPLAYS`) | 20 | **33** |

The new themes come from David's census of 38,912 public character listings: its top genres (romance, fantasy, adventure, drama, royalty, slice of life, supernatural, sci-fi, crime) and tropes (enemies to lovers, rivals, forced proximity, slow burn, wholesome, protective, jealous, cold then warm, the very rich, crime outfits, vampires, married partners, hero and villain, gentle-dominant, non-human).

**Left out on purpose:** school, family and famous-people themes rank high in the same census. They are exactly what the lines above exclude, so none was written, and none will be.

- **The show's 14 (PG):** `snowed-in`, `grump-sunshine`, `arranged-match`, `truce-dinner`, `the-witness`, `off-camera`, `another-world`, `witch-hunter`, `last-two-awake`, `rival-athletes`, `old-friends-bench`, `night-bakery`, `ghost-tenant`, `heist-eve`.
- **After Dark's 13:** `your-rules`, `dons-truce`, `said-no`, `arranged-match`, `off-duty`, `anniversary-strangers`, `after-the-party`, `the-cold-one`, `slow-sunday`, `after-the-cameras`, `summoned`, `two-captains`, `home-again`. Where one could have a say over the other's work, the attraction is mutual and said out loud; nobody is paid; anyone can leave.

## Adding one

1. Add the roleplay with its `card` to `DATE_ROLEPLAYS` or `ROLEPLAYS`. The type makes the card required.
2. Write it like the premises: plain, concrete, present tense, a prop, a stake, a thing in the way. Beats are turns, not outcomes.
3. Write `{a}` and `{b}` so the card reads right from either side as "you" (`cardForYou`, which uses `premiseForYou`):
   - the name straight before its verb ("{a} pours", never "{a} slowly pours");
   - no "he", "she" or "they" for one of them, and no "their" for the pair: say the name again or reword;
   - a second verb only after "and" with no comma before it ("{a} sits down and asks");
   - never a verb of one of them after the other's name in the same clause ("{a} is at the sink when {b} comes in and reaches…" reads as {a} reaching).
4. Run `tests/scene-cards.test.ts`, and the test that counts that side's roleplays.

## Files

- `lib/scene-cards.ts`: the type, the limits, `GENERIC_OPENINGS`, `mapCard`, `fillCard`, `fillCardText`, `cardForYou`, `openingOf`, `openingIndex`, `openedTerms`, `cardTexts`, `cardShapeIssue`, `showCardTextIssue`, `showCardIssue`, `adultCardTextIssue`, `adultCardIssue`, `CARD_ENDING`, `CARD_EXPLICIT`, `ADULT_CARD_NEVER`.
- `lib/roleplays.ts`, `lib/adult/roleplays.ts`: the roleplays and their cards; `roleplayForActor`, `roleplayNote`; `roleplayLine`, `roleplayRule`.
- `lib/simulation.ts` (the date's opening), `lib/conversation.ts` (the actor's section and the first-line rule), `lib/companion.ts` (`promptRoleplay`, the opener's cue), `lib/companion-prompt.ts`, `lib/adult/scenes.ts` (`setRoleplay`, the scene's profile), `app/api/admin/after-dark/route.ts`, `app/after-dark/[a]/[b]/SetSceneModal.tsx`.
- Tests: `tests/scene-cards.test.ts`, `tests/date-roleplays.test.ts`, `tests/companion-roleplays.test.ts`, `tests/after-dark-roleplays.test.ts`.

Related: [PRDs/roleplays.md](PRDs/roleplays.md), [companions.md](companions.md), [after-dark.md](after-dark.md), [writing-styles.md](writing-styles.md).
