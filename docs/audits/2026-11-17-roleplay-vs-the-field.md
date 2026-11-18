# Roleplay mode vs the field

Research date: 2026-11-17. David shared screenshots of Chub's settings panels and asked for an audit of how the top roleplay and storytelling products set a scene up, and what Botchelor's roleplay mode should take from them.

Covered: Chub, SillyTavern, Janitor AI, Character.AI, NovelAI, AI Dungeon, Kindroid, Nomi, DreamGen and SpicyChat. Public docs, help centers and reviews only: features and mechanics, no content. Sources and what couldn't be verified are at the end.

## What shipped from this audit (updated 2026-11-17, the same day)

| # | Suggestion | Status |
| --- | --- | --- |
| 1 | Story mode for companion scenes | Live for Companion Plan members and admins (#1774). [companions.md](../companions.md) "Story mode". |
| 2 | An opening you choose | Live: the scene picker's "How it opens" step, for companion scenes and show dates (#1773); three radios in After Dark's Scene & roleplay (#1772). |
| 3 | A saved persona for "you" | Live: "Who you are in scenes" on /account (#1773). |
| 4 | Flip through regenerated replies, and Continue | Live in companion chats (#1774). |
| 9 | Sell depth, not surcharges | Done: Narrated, stories and a longer memory come with the Companion Plan; no per-date or per-step charge (#1771). |
| – | A richer card behind every roleplay, and more roleplays | Live: scene cards on all 49 show and 43 After Dark roleplays, 47 of them new, from the owner's census of public character listings (#1772, and ten a side for its gaps: [tags.md](../tags.md)). [scene-cards.md](../scene-cards.md). |
| – | The After Dark version of "you in the scene" | Built closed, admins only, as After Dark's Step in. [after-dark.md](../after-dark.md). |
| 5–8, 10 | A standing director's note, "write my turn" chips, style presets, showing what they remembered, a visible meter | Not built. |

## The short version

1. **Chub is three layers.** A character card sets the scene, a preset tells the writer how to write, and chat tools (memory, branches) keep it going. Botchelor has most of the third layer, a structured version of the first, and almost none of the second as something a person can choose.
2. **The opening message does most of the scene-setting.** Chub's card has a greeting, and the preset says "follow the formatting of previous responses". The model copies the greeting's length and format from then on. Botchelor lets you pick a place and a roleplay, but nobody writes or picks the opening.
3. **The biggest difference is who is in the scene.** Chub is you and one character, with the character driving. After Dark is two characters you direct. Botchelor's version of "you in the scene" is companion scenes and step-in dates, both PG; the After Dark companion (P5) isn't built.
4. **Seven things nearly every product has** (below). Botchelor has one in full, five in part and one not at all.
5. **What people pay for elsewhere is depth**: a longer memory and a better writer. Not per-message surcharges.
6. **Don't copy the raw prompt box.** Chub's default preset tells the model that non-consensual and illegal content is "allowed and encouraged", and anyone can edit it. Botchelor's fixed menus with checked free text are the safer design.

## How Chub sets a scene up (from the screenshots)

| Layer | What's in it | What it does |
| --- | --- | --- |
| **Character card** | Description (prose, with `{{char}}` and `{{user}}` placeholders), greeting, scenario, example dialogs, a per-character system prompt, post-history instructions, a character note | Who they are, how they talk, what's happening as it starts. Overridable per chat. |
| **Preset: prompt structure** | Pre-history instructions, post-history instructions, an impersonation prompt, assistant prefill, a prompt note at a chosen depth, toggles (names, emojis, lorebooks, auto-summary) | How to write: stay in character, show don't tell, take the initiative, 2–4 paragraphs. |
| **Preset: generation** | Temperature 0.75, three penalties at 1.10, top-P, top-K, max 300 new tokens, 6,000 tokens of context, lorebook scan depth and budget | Sampling and limits. |
| **Chat menu** | Chat memory, new chat, all chats, full chat tree | Summary, and every regenerated branch kept. |

Two things in those numbers explain what the sample chat looked like:
- **Max 300 tokens with "trim incomplete sentences" off** is why replies ended mid-sentence.
- **6,000 tokens of context** is small. It's why these products lean on summaries and lorebooks, and why "memory loss" is the field's top complaint.

## Table stakes, and where Botchelor stands

| What nearly all of them have | Botchelor today | Gap |
| --- | --- | --- |
| A greeting, a scenario and a user persona before the first message | Place + roleplay + who plays whom (After Dark, companion scenes, show dates). Custom roleplays, checked. | No written or chosen **opening**. No saved **persona** for "you" beyond your name and the role you pick. |
| Regenerate with the alternatives kept; edit; continue | Companion: regenerate and edit-last. After Dark: rewind, redo, start over (5 deep). | Earlier draws are stored (`replaced_by`) but can't be flipped through. No "continue". |
| One always-in-context note plus keyword lore | Companion facts you can read and edit; After Dark facts, memories and recap, editable; character facts on the sheet. | No pins a person writes themselves. No keyword lore (low priority: the show is the world). |
| A rolling summary, editable | Yes, both. | None. |
| A steering channel outside the story | After Dark: steer (nudge or direct), whispers, three suggestions, limits. | Nothing **standing**: a steer lasts a step, a whisper two. Companion scenes have none. |
| "Write my turn" | After Dark's three suggestions feed the steer. | Nothing in companion scenes or step-in, where you are the one typing. |
| Context size as the paid ladder | Tokens for dates and media; a flat Companion Plan. | Depth isn't something you can buy. |

Where Botchelor is ahead: whispers (a secret intention for one character), intensity and hard-no limits that hold over every steer, pictures and video of the scene, voice and calls, and a rule the field's users ask for and don't get: the character never speaks or acts for you. "The model narrating for me" is a documented complaint at Janitor and Kindroid.

## Suggestions, in the order I'd build them

| # | What | Why | Where it goes | Size |
| --- | --- | --- | --- | --- |
| 1 | **Story mode for companion scenes.** Replies written as prose in one go (not the script plus a narration pass), 2–4 paragraphs, the character moves the scene on instead of asking what you want. | This is the Chub experience David liked, on the surface where you are in the scene. It's PG today, and it becomes the After Dark companion when P5 is built. | `lib/companion-prompt.ts` scene branch; the Narrated style picker already exists | Medium |
| 2 | **An opening you choose.** After the place and roleplay: three openings to pick from (or write your own, checked), and the writer keeps to its length and format. | The opening sets the whole scene's style; today it's whatever the first draw gives. | Scene picker step 3; After Dark's Scene & roleplay popup | Medium |
| 3 | **A saved persona for "you".** A name, a line on how you look, a line on who you are. Used in every scene, editable, checked like any free text. | Table stakes everywhere. It also gives the narrator something to describe besides "you". | Account; companion and step-in prompts | Small |
| 4 | **Flip through regenerated replies** (‹ 2 of 3 ›) and **Continue**. | The draws are already stored. Cheap regenerate is one of the things the companion research says keeps people. | `CompanionChat.tsx`; After Dark later | Small |
| 5 | **A standing director's note.** One line that stays for the whole scene ("slow burn; she teases, never fawns"), checked, placed at the end of the prompt. | Every product has one (author's note, post-history, response directive). After Dark's steers expire. | After Dark ⋯ menu; companion scene header | Small |
| 6 | **"Write my turn" chips.** Three short options for what you could say or do next. | You're typing in companion scenes and step-in; After Dark already has this for steers. | Companion scene, step-in | Small |
| 7 | **Style presets, never a prompt box.** Writing style (shipped), length, pace (slow burn / steady / fast), point of view ("you" or third person). Each maps to wording we wrote. | Gives the control Chub's preset gives, without handing over the system prompt. | One "How it's written" card per side | Small |
| 8 | **Show what they remembered.** Under a reply: the two or three memories it drew on, each one tap to fix or forget. | Kindroid shows a recall sheet you can deprioritize, and one reviewer singles out its memory control. Botchelor already tracks which facts a line cites. | After Dark `fact_ids`; companion facts | Medium |
| 9 | **Sell depth, not surcharges.** Put Narrated, the richer writer and a longer memory in a plan tier instead of charging a second token per date. | It's what the field's customers pay for, and narration only costs about 30% more to run. | Companion Plan; After Dark subscription | Decision |
| 10 | **A visible meter for roleplays** (trust, tension). | SpicyChat's Rulebooks are new and unusual; the date engine already scores interest every line. | Companion roleplays | Later |

Not worth copying: sampler sliders (temperature, top-K) for users, bring-your-own-API without our checks, lorebooks with recursion and scan depth, and any card or instruction that depends on family, school or anyone who reads as under 18.

## Sources

Primary docs: [Chub prompting](https://docs.chub.ai/docs/advanced-setups/prompting), [Chub chatting](https://docs.chub.ai/docs/the-basics/just-chatting), [Chub character creation](https://docs.chub.ai/docs/the-basics/character-creation), [Chub lorebooks](https://docs.chub.ai/docs/advanced-setups/lorebooks), [SillyTavern World Info](https://docs.sillytavern.app/usage/core-concepts/worldinfo/), [SillyTavern Author's Note](https://docs.sillytavern.app/usage/core-concepts/authors-note/), [SillyTavern personas](https://docs.sillytavern.app/usage/core-concepts/personas/), [Janitor chat memory](https://help.janitorai.com/en/article/chat-memory-context-management-9oivt3/), [Janitor writing style](https://help.janitorai.com/en/article/writing-style-talking-to-the-bot-1ucmbxw/), [Character.AI memory](https://blog.character.ai/memory/), [Character.AI Scenes](https://blog.character.ai/introducing-scenes-your-new-way-to-tell-stories-on-c-ai/), [NovelAI Lorebook](https://docs.novelai.net/en/text/lorebook/), [NovelAI subscription](https://docs.novelai.net/en/subscription/), [AI Dungeon memberships](https://help.aidungeon.com/memberships-benefits), [AI Dungeon memory](https://help.aidungeon.com/faq/the-memory-system), [AI Dungeon Story Cards](https://help.aidungeon.com/faq/story-cards), [Kindroid memory](https://kindroid.ai/v2/docs/memory/), [Kindroid chat tools](https://kindroid.ai/v2/docs/chat-features-and-tools/), [Kindroid common issues](https://kindroid.ai/v2/docs/common-issues/), [Nomi wiki](https://wiki.nomi.ai/), [DreamGen role-play](https://dreamgen.com/docs/how-to-role-play), [DreamGen pricing](https://v2.dreamgen.com/pricing), [SpicyChat premium features](https://docs.spicychat.ai/product-guides/premium-features), [SpicyChat Memory Manager](https://docs.spicychat.ai/product-guides/premium-features/memory-manager), [SpicyChat Rulebooks](https://docs.spicychat.ai/product-guides/rulebooks).

Press and reviews: [404 Media on Character.AI](https://www.404media.co/lobotomized-character-ai-is-showing-what-ai-enshittification-looks-like/), [DreamGen's Chub review](https://dreamgen.com/blog/articles/chub-ai-review) (a competitor), [Roborhythms on AI Dungeon](https://www.roborhythms.com/ai-dungeon-review/) (earns affiliate commissions).

**Not verified from a primary source:**
- Chub's preset fields and generation parameters are from David's screenshots, not its docs; its subscription page didn't load.
- Kindroid's prices show only at checkout.
- Character.AI's group chat and calls sources are from 2023–24.
- Candy.ai's pricing is from one affiliate site.
- CrushOn wasn't covered.
- Evidence of what users praise is thin: review-site opinion, not surveys.

Related: [after-dark-competitors-steering.md](../history/after-dark-competitors-steering.md), [companions.md](../companions.md), [writing-styles.md](../writing-styles.md), [stages.md](../stages.md).
