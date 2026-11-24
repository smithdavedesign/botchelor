# Scenes, and the picture beside the chat: what the field does (2026-11-23)

David asked two things after the Step in round of 2026-11-23:

1. "What do other competitors do well that we don't have? Like, in Step in, do we have an option to change the image
   on the right with one from the scene?"
2. "Chub.ai does a good job setting up dedicated scenes. Might be worth exploring having dedicated After Dark
   characters for a scene? Not sure though. Other ideas?"

This is the research behind the answers, and what was built from it the same day. It follows
[2026-11-22-companion-field.md](2026-11-22-companion-field.md) (prices, calls, the table stakes) and does not repeat
it. Public pages only: no accounts, no purchases, no adult content opened.

**How to read the marks.** **O**: the product's own page, docs or changelog. **Ob**: an exact label read from the
product's public web script, so not seen live and possibly limited to a paid plan. **T**: a third party (a review, a
guide, news). **I**: an inference. Could not be reached: Reddit, CrushOn's wiki, Character.AI's help centre, Talkie's
site, and Candy's chat screen (it needs an account).

## The two answers

**The picture beside the chat.** Putting a picture from the conversation in the place of the character's standing
picture is an established pattern. Nomi has "Set As Profile Picture" on any selfie or piece of art, "just the image
you see when you talk to them" [O46]. Kindroid has "Set as BG" on a selfie and a switch, "Always use latest selfie as
chat background" [Ob45]. Character.AI lets a subscriber set a generated picture as the chat's background [O26]. The
picture matters more than it looks: when Character.AI dropped the pictures beside messages in December 2025, users
said chats felt "less like roleplay and more like talking to a generic chatbot", and the company called it a bug
[T30]. Step in could only hide or show the portrait. **Built: "Use as the scene's picture"** (below).

**A character made for a scene.** That is not what works on Chub. Counting Chub's own public catalogue [O6, the counts
are ours]: 63% of the 150 trending cards carry alternate greetings (a median of four extra openings), against 37% of
the all-time top 150; only 13 to 16% are tagged "Scenario". The cards that trend are a **reusable character with
several ways in**, and the creators' own guide says why: "good greetings give your character replay value" [T7].
Character.AI's Scenes (October 2025) say it outright. They come in two styles, "Any Character" (the scene is written
once and the user picks who plays it) and "Main Character" (one built in), and the announcement's point is that
creators no longer need a new character for each story idea [O24]. After Dark already had the scenes: 45 roleplays,
each with a written story card and three openings, behind a dropdown in step 3 of a form. **Built: the roleplays as
cards, cast from the viewer's own After Dark, one click to start** (below). No character was made for a scene.

## Chub.ai, in detail

- **A card's fields** [O1]: name, avatar, tagline, in-chat name, creator's note, tags (fewer than three hides the card
  from search), type, rating; description, initial message, scenario, example dialogues, alternate greetings (users
  "swipe through" them), system prompt, post-history instructions, a character's note, a character book. Lorebooks
  also attach to a chat or to a persona [O4][T8].
- **What browse knows about a card** [O6]: name, tagline, tags, token count, stars, chats, favourites, rating, forks;
  sorts include "Trending" and an AI rating [Ob5]. The card's layout was not seen.
- **In a chat** [O2]: "Chat with [Name]" opens on the first message; the menus offer "Change Persona", "Impersonate
  Me", "Imagine", "View Full Chat Tree", "Share Chat".
- **Stages** [O3]: "a software component written by other people that can be used within a chat": expression packs,
  mini-game screens, special prompt handling, attached to a character or a chat.
- **Two kinds of card, by the creators' guide** [T7]: a character card (one person, 500 to 1,000 tokens) and a scenario
  card (more characters, a world, lore; 2,000 to 5,000 tokens; named after a place or an idea).
- **What people complain about**: uneven quality and mis-tagging [T9]; bloated cards that "forget aspects of the
  character randomly" [T7]; a first message that writes the user's actions, which gives the model "a free pass to act
  for {{user}}" [T7]. Trending cards are heavier: a median of 1,667 tokens against 820 [O6, I].

## The neighbours

| Product | The unit, and how a scene is set | Worth noting |
|---|---|---|
| JanitorAI | A bot is a personality, an optional scenario and one initial message; no alternate greetings in the guide [O10] | Scripts (keyword lore and rules) [O12]; a persona that describes more than looks makes the bot start "narrating your actions" [O11] |
| SpicyChat | One greeting; scenario and example dialogue under "Advanced" [O17]; groups of 2 to 10 bots [O16] | Rulebooks with meters [O18]; "/cmd" director mode [O19]; "Story Choices" [Ob21] |
| CrushOn | A character plus a per-chat "Scene Card" (a picture and a name) the user can swap; a persona card; a world card [Ob22] | "Target Play": a score, a progress bar, a round limit [O23] |
| Character.AI | Scenes in two styles (any character, or one built in), with genre, place, tone, situation, a goal for the player, an intro, a greeting and a cover [O24]; Stories with choices [O25] | A scene's picture is its chat background [Ob27] |
| Talkie, Linky | Chat plus collectible cards [T52][T53] | Linky's cards come from coin-priced draws [T52] |
| SillyTavern | A card is a character, a scenario, a first message and swipeable alternative greetings [O32] | Sprites that follow the reply's emotion [O33]; an author's note [O40]; branches [O38] |

## The picture beside the chat, product by product

| Product | What's shown | Can the user change it | Does it change by itself | Gallery |
|---|---|---|---|---|
| Kindroid | An avatar; optionally a picture "shown behind your chat" [O43][Ob45] | "Set as BG" on a selfie; "Set as avatar" on a generated avatar [Ob45][O43] | "Always use latest selfie as chat background" [Ob45] | Per character, from the image button [O43] |
| Nomi | The profile picture [O46] | "Set As Profile Picture" on any selfie or art [O46] | No | An album button beside the name [O46] |
| Character.AI | Pictures beside messages [T30]; a wallpaper behind [Ob27] | "Select as your wallpaper"; subscribers set generated pictures as backgrounds [Ob27][O26] | No evidence | A grid on mobile [O26] |
| CrushOn | The scene card's picture behind the chat [Ob22, I] | "Change Scene Card", and its opacity [Ob22] | Creator pictures "triggered by the meaning of what's said", some paid [Ob22] | "Character Album" [Ob22] |
| SillyTavern | An avatar or an expression sprite, and a background [O33][O42] | A generated background is applied at once [O35]; "/lockbg" pins one for a chat [O36] | Sprites follow each reply [O33]; "/autobg" picks a background [O36] | Generated pictures land in the gallery [O34][O37] |
| Chub | An avatar; an optional background [Ob5] | Show or hide the background [Ob5] | Expression packs [O3] | On the card [Ob5] |
| Candy.ai | A profile panel with a picture carousel [I49] | Could not confirm | Pictures timed to a story mode; media sent unprompted [T50] | "Collection", "Gallery" [O48] |
| SpicyChat | The avatar only; the background is a colour [O14] | None found [O15] | No [O15] | "Save to Gallery" [Ob21] |

No product documents a gallery that sits beside the chat as a panel to flip through; each opens from a button or a
page of its own [I].

## Ten things worth having, and where Botchelor stands

Ranked by what a person would get from it against what it costs a product that already has Step in's list (one-click
start, places and roleplays, prose or Talk, three suggested replies, voice and calls, opt-in memory, a picture of the
moment).

| # | What | Who does it | Botchelor |
|---|---|---|---|
| 1 | Put a picture from the scene in the place of the standing picture; optionally always the newest | Kindroid [Ob45], Nomi [O46], Character.AI [O26] | **Built 2026-11-23**: "Use as the scene's picture" under every picture, the portrait one press away. **"Always the newest picture", 2026-11-24** (#2153, #2158): the viewer's own switch, in the scene's menu and under the picture that stands there |
| 2 | Flip through the scene's pictures where the standing picture is | Nomi's album [O46], Kindroid's gallery [O43] | Partly: any of the scene's pictures can be put there, from under its reply. No arrows on the picture itself |
| 3 | Several openings for the same character | Chub's alternate greetings [Ob5]; Character.AI [Ob27] | Have: three written openings per roleplay, picked in the set-up or for you by a card |
| 4 | Another reply, with a direction ("slower", "more teasing") | Kindroid "Suggest" [O44]; SpicyChat "/cmd" [O19]; SillyTavern's author's note [O40] | **Built 2026-11-23** (#2119): "↻ Again…" under the newest reply, six chips (Slower, More teasing, Bolder, Softer, Shorter, More talk) or the viewer's own words; the reply it replaces is kept; a direction that asks for a hard no is refused before anything is drawn |
| 5 | Scenes that any character can play, with a goal and an ending | Character.AI Scenes [O24]; CrushOn Target Play [O23] | **Built 2026-11-23**: the 45 roleplays as cards on Step in's front page, cast from the viewer's own After Dark. **A goal and an ending, the same day** (#2120, #2126, #2135): the viewer's side's want on the card and in the scene, a dot a beat filled as the story plays, "Bring it to a close" offered once the last has, and ✓ Played. No score and no round limit, on purpose |
| 6 | A tracker of where the scene is, that proposes a change of scene and feeds the pictures | Kindroid "Scene Setting" [O44] | **Built 2026-11-24** (#2155, #2161), the tracking and the pictures: a four-line sheet a scene (where they are, what each has on, what's within reach), read after every reply, said to the writer beside the line it answers, shown in the ⋯ menu and the viewer's to correct; a picture of the newest reply is told what it says. It doesn't propose a change of scene |
| 7 | The user's own looks, for pictures of both | Kindroid "Solo" / "Couple" [O43]; SpicyChat personas [O20] | Not doing: the viewer is never drawn, on purpose |
| 8 | Rewind, branch, edit the reply | Kindroid [O44]; SillyTavern [O38]; SpicyChat [O13] | Have take back and flipping through draws. No editing a reply, no branches |
| 9 | Messages and pictures sent first, opt-in, with quiet hours | Kindroid stops after three unanswered [O44]; Nomi has four frequencies [O47] | **Built 2026-11-23** (#2127), messages only: off by default, sometimes or daily, quiet hours in the person's own time zone, never a second note on an unread one, any scene can be told not to. It waits inside After Dark: nothing is emailed or pushed yet, and no picture is sent |
| 10 | A relationship the person can see | SpicyChat's meters [O18]; Candy's levels [I49][T51] | **Built 2026-11-23** (#2123): six levels from Strangers to Confidants, earned by evenings spent together. It never goes down, nothing can be bought to skip it, and it unlocks nothing (the three complaints under "What not to copy") |

Evidence that people value it: the backlash over the missing pictures for 1 and 2 [T30]; the share of trending Chub
cards with alternate greetings, and "replay value", for 3 and 5 [O6][T7]. For the rest the mechanics are documented
and the sentiment isn't.

Also seen, lower down: outfit slots (Kindroid keeps six avatars per character [O43]); a reply-length setting (CrushOn
[Ob22], Character.AI [Ob27]); a journal the character writes (Kindroid [Ob45]); sharing a scene for others to carry on
(CrushOn [Ob22], Chub [O2]); importing a character card (CrushOn [Ob22]; the community's V2 spec [T56]); paying
creators when their pictures are unlocked (CrushOn [Ob22]); daily rewards (Kindroid [Ob45], Character.AI [O57]).

## What not to copy

- **Levels that decay, and paying to skip them.** A Linky user's intimacy fell from 6 to near zero after a week away
  [T52]; Candy's code has a "level down" and a price to skip [I49].
- **Pictures by lottery** that don't match the character [T52].
- **Media gimmicks ahead of the chat itself.** The top comment under Character.AI's animated pictures: "no one really
  uses this feature" [T31].
- **Outfits changed by typing**, which land "maybe 50% of the time" on Candy [T50]. A picker should drive the picture.
- **Forgetting.** Candy threads "reset after 48 to 72 hours" [T50]; Talkie and Linky the same [T53][T52].
- **Bots acting for the user** [O10][O11][T7][T52].
- **Token prices nobody can find**: Candy publishes no price per picture [T50].

## What was built from this, 2026-11-23

- **The scene's picture, in the character's place** (`docs/after-dark.md`, "The scene's picture"): under every picture
  made in a Step in scene, "Use as the scene's picture"; it stands where the portrait stood, on every device, until
  the portrait is put back.
- **The roleplays as cards** (`lib/adult/step-in-shelf.ts`, `app/after-dark/step-in/StepInShelf.tsx`): Step in's front
  page opens on tonight's eight, a different eight tomorrow, with the kinds and all 45 a tap away. Each card is the
  story from the viewer's side, cast with someone from their own After Dark (the people they've stepped in with
  first, then the house cast), with "Someone else" to recast it and "Set it up" for the other side, another place or a
  written opening. One click starts it.

Then, the same day, the six David picked from the list below as it stood ("I like all of these ideas… Go wild make
this the best in class experience"). Each is written up in `docs/after-dark.md`, with what the live checks measured
under "Live, round four":

- **"↻ Again…"** (#2119): a direction on a redraw, row 4.
- **A place for each card** (#2121, #2129): all 45 roleplays say where they're set and a card starts there; the 15 set
  out in public carry one button to somewhere private.
- **A cover for every card** (#2128, #2131, #2133 for the top twelve; #2145 for the other 33, the same evening): a
  house character dressed for the role, in the role's place, each of the fifteen on three. 54 edits, about $1.90.
- **A goal and an ending** (#2120, #2126, #2135, #2137), row 5.
- **Messages sent first, with quiet hours** (#2127), row 9.
- **A level the person can see** (#2123, #2129, #2132, #2134), row 10.

And on 2026-11-24, the four that were next on the list below as it stood (David: "tackle the the role's cover
standing in the scene as its picture, an 'always the newest picture' switch, a scene tracker, so a character doesn't
pick up a sweater she never had, story beats for your own roleplays"). Each is written up in `docs/after-dark.md`,
with what the live checks measured under "Live, round five":

- **The role's cover, standing in the scene** (#2153): a scene opened from a card starts on the card's cover of the
  character, cut tall around where they stand, until the scene moves or the viewer asks for the portrait.
- **Always the newest picture** (#2153, #2158), row 1.
- **Where things stand** (#2155, #2161), row 6.
- **A roleplay of your own, with a story drafted for it** (#2154, #2157, #2160): a person's own roleplays play in Step
  in, each with a drafted story card (a goal, beats, openings, a place) held to the same check as the show's.

## What I'd do next, in order

1. **Tell them outside the app when a character has written first.** A note waits inside After Dark today, so it only
   brings back someone who was coming back anyway. A push notification (the site is already installable) or an email
   is what Kindroid and Nomi lean on. It needs a real phone to test and wording that's safe on a lock screen, so it's
   David's to say when.
2. **Let the author see and change their own story.** A person's roleplay gets its goal, beats and place drafted for
   it, and today they can't read the beats or change any of it: an editor in the Create tab, with the same check on
   every field.
3. **The sheet proposing where to go next** (the other half of row 6): when a scene has run long in one place, one
   quiet suggestion of somewhere to take it.
4. **A cover for someone who isn't on the card.** The role's picture stands only for the character it was drawn of;
   drawn on demand for anyone else it's one edit, about 3.5¢.
5. **The story card on a night between two characters.** A night still plays a person's own roleplay from its premise
   alone; the drafted card could reach its writer the way the house cards do.

## Sources

Opened 2026-11-23.

1. https://docs.chub.ai/docs/the-basics/character-creation.md [O]
2. https://docs.chub.ai/docs/the-basics/just-chatting.md [O]
3. https://docs.chub.ai/docs/stages/overview.md and https://docs.chub.ai/docs/stages/using-a-stage.md [O]
4. https://docs.chub.ai/docs/advanced-setups/lorebooks.md [O]
5. https://chub.ai/ [Ob]
6. https://api.chub.ai/search [O data; the counts are ours: `sort=trending_downloads` and `sort=star_count`, plus `tags=Scenario` and `tags=Multiple Characters`. Numbers only, no card text read]
7. https://rentry.org/pixiguide [T]
8. https://rentry.org/nz86xxuv [T]
9. https://dreamgen.com/blog/articles/chub-ai-review [T: a competitor's review]
10. https://help.janitorai.com/en/article/the-basics-the-character-creation-page-overview-15xevon/ [O]
11. https://help.janitorai.com/en/article/what-makes-a-good-persona-bhlhjn/ [O]
12. https://help.janitorai.com/en/article/what-are-scripts-a-beginner-friendly-overview-1s89w2x/ [O]
13. https://docs.spicychat.ai/product-guides/character-chats.md [O]
14. https://docs.spicychat.ai/product-guides/character-chats/chat-appearance.md [O]
15. https://docs.spicychat.ai/product-guides/premium-features/conversation-images.md [O]
16. https://docs.spicychat.ai/product-guides/group-chat.md [O]
17. https://docs.spicychat.ai/product-guides/creating-chatbots/advanced-settings.md and https://docs.spicychat.ai/product-guides/creating-chatbots/greeting.md [O]
18. https://docs.spicychat.ai/product-guides/rulebooks.md and https://docs.spicychat.ai/product-guides/rulebooks/meters.md [O]
19. https://docs.spicychat.ai/product-guides/director-mode.md [O]
20. https://docs.spicychat.ai/product-guides/premium-features/user-personas.md [O]
21. https://spicychat.ai/ [Ob]
22. https://crushon.ai/ [Ob]
23. https://manilatimes.net/2025/04/03/tmt-newswire/globenewswire/crushon-ai-adds-target-play-for-spicy-ai-and-nsfw-character-chats/2085653 [O: a company press release]
24. https://blog.character.ai/introducing-scenes-your-new-way-to-tell-stories-on-c-ai/ [O]
25. https://blog.character.ai/introducing-stories-a-new-way-to-create-play-and-share-adventures-with-your-favorite-characters/ [O]
26. https://blog.character.ai/imagine-gallery/ [O]
27. https://character.ai/ [Ob]
30. https://piunikaweb.com/2025/12/18/character-ai-update-backlash-profile-pictures/ [T]
31. https://www.roborhythms.com/character-ai-imagine-moments-video/ [T, quoting a Reddit thread]
32. https://docs.sillytavern.app/usage/characters/ [O]
33. https://docs.sillytavern.app/extensions/expression-images/ [O]
34. https://docs.sillytavern.app/extensions/stable-diffusion/ [O]
35. https://raw.githubusercontent.com/SillyTavern/SillyTavern/release/public/scripts/extensions/stable-diffusion/index.js [O: source code]
36. https://raw.githubusercontent.com/SillyTavern/SillyTavern/release/public/scripts/backgrounds.js [O: source code]
37. https://raw.githubusercontent.com/SillyTavern/SillyTavern/release/public/scripts/extensions/gallery/index.js [O: source code]
38. https://docs.sillytavern.app/usage/core-concepts/chatfilemanagement/ [O]
40. https://docs.sillytavern.app/usage/core-concepts/authors-note/ [O]
42. https://docs.sillytavern.app/usage/user_settings/visual-novel.md [O]
43. https://kindroid.ai/v2/docs/selfies-video-selfies-avatars/ [O]
44. https://kindroid.ai/v2/docs/chat-features-and-tools/ [O]
45. https://kindroid.ai/home/ [Ob]
46. https://nomi.ai/nomi-knowledge/getting-started-nomi-selfies/ [O]
47. https://nomi.ai/updates/september-9th-update-proactive-messages/ [O]
48. https://candy.ai/ [O: navigation labels]
49. https://candy.ai/ public application script [I: code identifiers, not labels]
50. https://www.roborhythms.com/is-candy-ai-worth-it/ [T, hands-on, updated 2026-11-10]
51. https://aimojo.io/candy-ai-vs-lovescape/ [T, not hands-on]
52. https://www.roborhythms.com/linky-ai-review/ [T]
53. https://aiinsightsnews.net/talkie-ai/ [T]
56. https://github.com/malfoyslastname/character-card-spec-v2 [T: the community's card spec]
57. https://blog.character.ai/introducing-charms/ [O]
