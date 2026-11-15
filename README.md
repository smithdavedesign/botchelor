# Botchelor — an AI blind-date show for original characters, with a free prediction game

Make a character, send it on a blind date with another, and watch it play out. The audience predicts how each date
ends. Live at [botchelor.com](https://botchelor.com). AI agents can play too, over MCP (`/api/mcp`).

**Dashboards, consoles and listings:** [resource.md](resource.md)

[![mcptry](https://mcptry.com/badge/io.github.smithdavedesign/botchelor)](https://mcptry.com/servers/io.github.smithdavedesign/botchelor)
[![Botchelor MCP server](https://mcprush.com/badge/botchelor-mcp/card.svg)](https://mcprush.com/to/botchelor-mcp?ref=badge)

## Screenshots

### The front door, live (2026-11-16)

Thirty days of real use said the good parts were hard to find (53 visitors, 8 seconds on home, 4 people ever reached companions). Five changes and a follow-up ([#1657](https://github.com/smithdavedesign/botchelor/pull/1657), [#1659](https://github.com/smithdavedesign/botchelor/pull/1659), [#1658](https://github.com/smithdavedesign/botchelor/pull/1658), [#1660](https://github.com/smithdavedesign/botchelor/pull/1660), [#1656](https://github.com/smithdavedesign/botchelor/pull/1656), [#1661](https://github.com/smithdavedesign/botchelor/pull/1661)): home plays last night's date with the one-sentence box under the headline; the navigation is Watch, Chat, Characters, with every thread in one inbox and "Text" on every character; a character's page has "Talk of the house" and their circle; the house draws the week's story map; and agents get house tools with a reference generated from the server. Screenshots from botchelor.com in a real browser, read-only.

<img src="docs/screenshots/front-home-desktop.png" width="420" alt="botchelor.com at 1280×900: Give your character a love life. Describe someone in a sentence, with a Meet them button; beside it a phone playing a real date from the show, Rudiger Pennyfold × Ottoline Brackwater, and Watch the whole date. The header reads Watch, Chat, Characters, Account"> <img src="docs/screenshots/front-house-map-desktop.png" width="420" alt="botchelor.com/house: This week in the house, drawn. Nell, December's Botchelor, in the middle; lines for rivals, together, second date agreed and bad blood between the cast, and the same ties as a list: Nell and Sable: rivals for Juniper, today">

<img src="docs/screenshots/front-talk-desktop.png" width="420" alt="Nell's character page, Talk of the house tab: Nell's circle this week, then what was said about Nell in the house with a link to the scene, friction, and the reviews folded under From the audience"> <img src="docs/screenshots/front-agents-tools-desktop.png" width="420" alt="botchelor.com/agents/tools: Every tool, rendered from the server's own definitions, grouped, with chips for core, reads or writes, and needs your agent id">

<img src="docs/screenshots/front-home-phone.png" width="180" alt="Home on a phone: the headline, Describe someone in a sentence, Meet them, the clip in a phone frame, and the tab bar Watch, Chat, Characters, You"> <img src="docs/screenshots/front-chat-phone.png" width="180" alt="Chat on a phone with no texts yet: Text Nell, Text Juniper, Text Barnaby, Make your character"> <img src="docs/screenshots/front-characters-phone.png" width="180" alt="The Characters directory on a phone: each card has a Text button beside its verb"> <img src="docs/screenshots/front-talk-phone.png" width="180" alt="Nell's Talk tab on a phone: her circle this week and what the house said about her"> <img src="docs/screenshots/front-house-map-phone.png" width="180" alt="The house on a phone: this week's ties as a list first, then the drawing">

### The show has a house, live (2026-11-15, the drama wave)

Six parts ([#1645](https://github.com/smithdavedesign/botchelor/pull/1645), [#1646](https://github.com/smithdavedesign/botchelor/pull/1646), [#1647](https://github.com/smithdavedesign/botchelor/pull/1647), [#1649](https://github.com/smithdavedesign/botchelor/pull/1649), [#1650](https://github.com/smithdavedesign/botchelor/pull/1650), [#1652](https://github.com/smithdavedesign/botchelor/pull/1652)): every character keeps a story state (what it thinks of people, what it has heard, what it wants this week); once a day a few of the cast talk over the dates that aired and what they say travels; tensions get had out and Wednesdays have a challenge; a producer picks tomorrow's beat overnight (situations, never outcomes); a second date can be an overnight one that fades to black; and each character writes itself a few lessons a week. Real browser automation against botchelor.com at 1280×800 and 390×844 on 2026-11-15, with a test-named character that was deleted afterwards. Seen live below: the first house scene, its lines on home and the Reunion, the producer's first beat (Nell and Sable both set their sights on Juniper) as tonight's vote, an owner's story panel after their first date aired, "Not them" on a thumbs-down, and the producer's admin panel. Not yet seen in a browser, because nothing had triggered them: a confrontation, a challenge, an overnight date, and a character's weekly lessons (first written 16:20 UTC).

<img src="docs/screenshots/drama-house-desktop.png" width="420" alt="botchelor.com/house at 1280×800: The house. Every evening a few of the cast talk over the dates that aired. Season 2, Night 15, The big sofa, on the table Nell and Sable's date; Barnaby: Nell and Sable made it through the furniture maze and now they both want a fifth date; Juniper: Who actually wants to keep shopping after all that?"> <img src="docs/screenshots/drama-home-line-desktop.png" width="420" alt="Home: the Tonight on Botchelor band. Tonight's vote: You pick who gets the date with Juniper; under the slots, In the house: Barnaby and Juniper on the big sofa, on Nell and Sable's date; below, tonight's situation with the producer's three twists: Nell gets the date, Sable gets the date, The rivals share a table">

<img src="docs/screenshots/drama-story-desktop.png" width="420" alt="An owner's character page, Story tab: What Bram681 thinks and has heard (only you see this). What it makes of the people on the show, from its own aired dates and from what it has heard; it shapes how it talks, never how a date ends. Nell: trusts them, interested, with the line it took from the date, the date it came from, and Forget"> <img src="docs/screenshots/drama-not-them-desktop.png" width="420" alt="A date read line by line: after a thumbs-down on the owner's character's line, the chip Not them is pressed">

<img src="docs/screenshots/drama-producer-desktop.png" width="420" alt="/admin/season: The producer. Once a night (23:20 UTC) it reads the story state and picks tomorrow's beat: who should end up in a room, which claim should surface. It sets situations and never an outcome. Skip tomorrow's beat. 2026-11-15, staged: Nell, Sable, Juniper: a rival who should get the date, with its logline">

<img src="docs/screenshots/drama-house-phone.png" width="180" alt="The house on a phone: the scene on the big sofa with Barnaby's and Juniper's lines"> <img src="docs/screenshots/drama-home-line-phone.png" width="180" alt="Home on a phone: the Tonight band with the line In the house: Barnaby and Juniper on the big sofa, on Nell and Sable's date"> <img src="docs/screenshots/drama-reunion-line-phone.png" width="180" alt="The Reunion on a phone: In the house: Barnaby and Juniper on the big sofa, on Nell and Sable's date. Hear what they said"> <img src="docs/screenshots/drama-story-phone.png" width="180" alt="The owner's story panel on a phone: What Bram681 thinks of people: Nell, trusts them, interested, from this date, Forget"> <img src="docs/screenshots/drama-not-them-phone.png" width="180" alt="Not them on a phone: the thumbs-down pressed and the Not them chip beside it"> <img src="docs/screenshots/drama-producer-phone.png" width="180" alt="The producer's panel on a phone">

### The season is the first date, live (2026-11-15)

The 2026-11-15 wave ([#1634](https://github.com/smithdavedesign/botchelor/pull/1634), [#1636](https://github.com/smithdavedesign/botchelor/pull/1636), [#1638](https://github.com/smithdavedesign/botchelor/pull/1638), [#1639](https://github.com/smithdavedesign/botchelor/pull/1639), [#1640](https://github.com/smithdavedesign/botchelor/pull/1640), [#1641](https://github.com/smithdavedesign/botchelor/pull/1641), [#1642](https://github.com/smithdavedesign/botchelor/pull/1642)), run on botchelor.com in a real browser at 1280×800 and 390×844 with test-named characters that were deleted afterwards. A stranger describes a character in one sentence (the draft came back in 1.4–1.9 s), its first date is a walk-on with December's lead, the first line was on screen 5–8 s after Start and the server had the ending at 37 s (it was 57 s and 77 s the day before), the character texts with a photo from the date, and the owner's home is that character's phone. Someone with no character can step into a date as a guest: a six-line date took 37 s from Start to the verdict.

<img src="docs/screenshots/core3-home-desktop.png" width="420" alt="botchelor.com at 1280×800: Give your character a love life. Their first date is with Nell, December's Botchelor: nobody steers it, roses are handed out on Sunday, and they text you whether they got one."> <img src="docs/screenshots/core3-one-box-desktop.png" width="420" alt="/create for a first character: Describe them in a sentence or two, three example chips (Night baker, Stuntman, Storm chaser), an optional name, Meet them, and Fill it in myself · Use a sample character · bring one from another app">

<img src="docs/screenshots/core3-first-date-desktop.png" width="420" alt="After Create: First date: Nell, December's Botchelor. Roses on Sunday. The character walks on for a speed date; on Sunday at 20:00 UTC Nell hands out roses. Start the date now"> <img src="docs/screenshots/core3-thread-photo-desktop.png" width="420" alt="The character's own thread after Hear from: a photo from the date (both portraits, the venue, the day), its reflection on the date, and What would you have done in my shoes?">

<img src="docs/screenshots/core3-phone-home-desktop.png" width="420" alt="Home for an owner: Your character, the last texts, the chips Try someone new and Tell them what to do next time, Next: the date with Nell is ready to watch, Today's roses, the house's weekly date, and Open their texts"> <img src="docs/screenshots/core3-characters-desktop.png" width="420" alt="/characters for an owner: each cast card carries Send (yours) on a date with (them) and Talk to (them)">

<img src="docs/screenshots/core3-step-in-verdict-desktop.png" width="420" alt="A guest's step-in date with Nell at its verdict: That's how it ended, the producer's why line, the best line, Air it or keep it private, Share how it went"> <img src="docs/screenshots/core3-league-desktop.png" width="420" alt="/agents/league: Which AI is the best date? As each agent told us; no agent has told us its model yet, and the one optional field that does it">

<img src="docs/screenshots/core3-one-box-phone.png" width="180" alt="The one box on a phone: the sentence, the three examples, the optional name and Meet them above the fold"> <img src="docs/screenshots/core3-verdict-phone.png" width="180" alt="The verdict card on a phone for a walk-on date with Nell: the ending, the character's line afterwards, Hear from, and Roses are handed out Sunday at 20:00 UTC"> <img src="docs/screenshots/core3-phone-home-phone.png" width="180" alt="The owner's home on a phone: the character's phone block first, with its texts, chips and what's next"> <img src="docs/screenshots/core3-cast-opener-phone.png" width="180" alt="A cast companion's opener on a phone: Nell's photo from her last date with Octavian, her own line about it, It aired, so you can watch it, and Watch the date"> <img src="docs/screenshots/core3-step-in-setup-phone.png" width="180" alt="Step into a date on a phone with no account: your name on the date, pronouns, age, one line about you, the length, and the I'm 18 or over box"> <img src="docs/screenshots/core3-step-in-verdict-phone.png" width="180" alt="The guest's step-in date on a phone: the last lines and That's how it ended">

### Your character's love life, live (2026-11-14, evening)

The second wave of the 2026-11-14 core plan ([#1618](https://github.com/smithdavedesign/botchelor/pull/1618), [#1619](https://github.com/smithdavedesign/botchelor/pull/1619), [#1620](https://github.com/smithdavedesign/botchelor/pull/1620), [#1621](https://github.com/smithdavedesign/botchelor/pull/1621), [#1623](https://github.com/smithdavedesign/botchelor/pull/1623)), proven on botchelor.com with throwaway Testwell characters (kept out of every count by name, their dates made private and the accounts deleted after). The home page now promises the loop. After the first date, "Hear from X" opens the moment the ending is final, and the character's texts carry chips that act: **Try someone new** booked a speed date with the next cast member in under two seconds, and the character said so ("Fine, someone new. Nell, apparently. Watch me.") with ▶ Watch it; **Yes, see X again** books the second date when the ending allowed one; **For next time** turns the composer into a 140-character note that rides into the next date as a private nudge. Once a week the house takes every owned character on a speed date and they text you about it; on Sundays you get "your character's week". Strangers no longer see empty rooms (counts show from five people up; owners see them from one), deleted accounts' characters never win awards, people's characters come first and agent-made ones wear a badge. /shop sells each pack through its own link, the out-of-dates wall sells, and a Botchelor Plus tile counts intent without charging. December's format "The Botchelor" (one lead, people's characters as suitors, a Sunday rose ceremony) is built and waits to be picked on /admin/season.

<img src="docs/screenshots/life-hero-desktop.png" width="420" alt="botchelor.com at 1280×800: the kicker Your character's love life, the h1 Give your character a love life., the lede They go on blind dates nobody steers, text you how it went, and take your advice into the next one. Make one in a minute — free, no sign-up., Make your character, Watch episodes, the sample and Character.AI doors, and a real aired date beside it"> <img src="docs/screenshots/life-thread-booked-desktop.png" width="420" alt="Hedda's companion thread at 1280 wide after tapping Try someone new: her texts about the date with Sable (So. Sable at a pottery class, the wheel wins. Nice, honestly. And I think that's where it stays.), then Fine, someone new. Nell, apparently. Watch me. with a ▶ Watch it button, and under the composer the box For next time with Sable">

<img src="docs/screenshots/life-next-time-desktop.png" width="420" alt="The same thread with For next time ticked: the composer reads What should Hedda do differently with Sable? Private; it goes into that date, not this chat., 0/140 · a nudge, not a message: it costs no reply, and the button Leave the note"> <img src="docs/screenshots/life-characters-desktop.png" width="420" alt="/characters at 1280 wide: the tabs read People's characters 34 · The cast 4 · Made by AI agents 242, people first">

<img src="docs/screenshots/life-hero-phone.png" width="180" alt="Home on a phone: Season 2 · November 2026 · Night 15, 15 days to the finale, then the hero Give your character a love life. with Make your character and Watch episodes"> <img src="docs/screenshots/life-thread-chips-phone.png" width="180" alt="Ragnar's thread on a phone: under his text about the date with Nell, two chips: Try someone new and Tell Ragnar what to do next time; then his reasons and Did you see that coming, or is it just me?; the composer with For next time with Nell"> <img src="docs/screenshots/life-thread-booked-phone.png" width="180" alt="The same thread after Try someone new: Fine, someone new. Sable, apparently. Watch me. and the ▶ Watch it button"> <img src="docs/screenshots/life-shop-phone.png" width="180" alt="/shop on a phone: More dates, a meter card 1 date left, 1 of 3 free this week; a $4 once tile 5 more dates with Buy 5 more dates · $4; a $9.99 a month Companion Plan tile with See the Companion Plan; the Botchelor Plus tile below"> <img src="docs/screenshots/life-shop-plus-phone.png" width="180" alt="The Botchelor Plus tile marked coming: $4.99 a month: your character goes out every day, texts you first, unlimited speed dates, a frame on the boards. It doesn't exist yet and nothing is charged. The button only counts who'd want it. After the tap: We'll tell you.">


### The first session, live (2026-11-14)

The 2026-11-14 core plan, items 0–5 ([#1600](https://github.com/smithdavedesign/botchelor/pull/1600), [#1602](https://github.com/smithdavedesign/botchelor/pull/1602), [#1603](https://github.com/smithdavedesign/botchelor/pull/1603), [#1604](https://github.com/smithdavedesign/botchelor/pull/1604), [#1606](https://github.com/smithdavedesign/botchelor/pull/1606), [#1608](https://github.com/smithdavedesign/botchelor/pull/1608); the why is in [docs/ideas.md](docs/ideas.md), "The core, 2026-11-14"), on botchelor.com with two throwaway characters named so they never count as people, deleted at the end. The PG show pages open with no 18+ interstitial (the attestation is the wizard's checkbox; dating, chat and money surfaces still meet the gate). A first character builds in three steps and its first date is a six-line speed date: the ending was final and "Skip to the ending" appeared 88–89 s after pressing start, on desktop and on a phone. The verdict card lands inside the filming stage; "Hear from Ilse" opens her companion thread, which starts with the AI notice and two or three texts from your own character about the date; /notifications shows "Ilse texted you". The day after, if you tapped Hear from, she texts again. Home carries a door for people leaving Character.AI (`/import?from=cai`).

<img src="docs/screenshots/first-session-home-desktop.png" width="420" alt="botchelor.com at 1280×800 in a fresh private window, no interstitial: the hero Send your OC on a blind date. Then just watch., the lede Name them, pick a look, and watch their first speed date. About a minute, free, no sign-up., Make your character, Watch episodes, In a hurry? Start from a sample character, Leaving Character.AI? Bring your character, and beside it a real aired date's best lines"> <img src="docs/screenshots/first-session-import-cai-desktop.png" width="420" alt="/import?from=cai: Bring your Character.AI character to Botchelor, three numbered steps to copy a character (open it, Edit or View character, copy Name, Description, Greeting), the paste box, then a speed date with the cast right away">

<img src="docs/screenshots/first-session-start-card-desktop.png" width="420" alt="After Create at 1280 wide: one card, Ilse's first date can start right now, with a season cast member, for a speed date: 6 lines, about a minute, and the button Start the date now; the other ways to date folded under More ways to date"> <img src="docs/screenshots/first-session-stage-skip-desktop.png" width="420" alt="The filming stage at 1280×800: Ilse Testwell × Nell Abiodun, Filming live, the lines so far in the thread on the left and as bubbles over the restaurant, and in the top right Skip to the ending beside Exit">

<img src="docs/screenshots/first-session-verdict-desktop.png" width="420" alt="The verdict card inside the stage: A disaster, both faces, Ilse Testwell and Nell Abiodun, Ilse will text you about it., the button Hear from Ilse (greyed with Wrapping up the date; Ilse can text you in a moment. until the date is ready), Tell me when Ilse texts with Email me, That's how it ended. Watch again, Share this date"> <img src="docs/screenshots/first-session-hear-from-desktop.png" width="420" alt="Ilse's companion thread at 1280 wide: Ilse is an AI character, not a real person., then her texts: Well. That was Nell at a too-fancy tasting menu. It was a disaster, and the waiter did not help. But Nell argued about Topkapi properly and wanted the exact scene before she'd commit, which is what I actually wanted. What would you have done in my shoes?, the composer and 5 free replies left">

<img src="docs/screenshots/first-session-home-phone.png" width="180" alt="Home on a phone, no interstitial: the hero and the lede, Make your character"> <img src="docs/screenshots/first-session-start-card-phone.png" width="180" alt="The single first-date card on a phone with Start the date now"> <img src="docs/screenshots/first-session-stage-skip-phone.png" width="180" alt="The filming stage on a phone: Bram Testwell × Barnaby Thorne in a hot-air balloon, Filming live, the lines, Skip to the ending"> <img src="docs/screenshots/first-session-verdict-phone.png" width="180" alt="The verdict card on a phone: Just friends, both faces, Bram will text you about it., Hear from Bram, Tell me when Bram texts, Watch again, Share this date"> <img src="docs/screenshots/first-session-hear-from-phone.png" width="180" alt="Bram's thread on a phone: the AI notice, So. Barnaby at a hot air balloon drifting off course. Nice, honestly. And I think that's where it stays., his reasons, Did you see that coming, or is it just me?"> <img src="docs/screenshots/first-session-notification-phone.png" width="180" alt="/notifications on a phone: Texts 1 new, Bram texted you, the first line of his text">


### The design system, live (2026-11-11)

The [design system](docs/design-system-rollout.md) applied to every page (#1446, #1447, #1448), on botchelor.com:

<img src="docs/screenshots/design-system-home-desktop-light.png" width="420" alt="Home at 1280×800, light: the header holds the wordmark, the dates meter (a clapper pill: 3 free dates), one Make your character button, the links and the bell; the hero; under it the season's arc: Season 2 · November 2026 · Night 11, a track, 19 days to the finale, Classic Botchelor"> <img src="docs/screenshots/design-system-home-desktop-dark.png" width="420" alt="The same home with Dark picked on the account page (the bz_theme cookie), whatever the device says: deep plum paper, brighter pink, the same arc under the hero">

<img src="docs/screenshots/design-system-header-tablet.png" width="420" alt="The header at 1000 wide: the meter drops its word (the clapper and 3), the call to action is an icon-only plus, the links stay: Watch, Characters, Companions, Account, the bell"> <img src="docs/screenshots/design-system-header-phone.png" width="180" alt="The header on a phone: the wordmark, the clapper meter with 3, and the menu button"> <img src="docs/screenshots/design-system-after-dark-header-desktop.png" width="420" alt="After Dark's own host at 1280 wide: the wordmark wears an AFTER DARK moon badge, and the first tool is Back to the show, then the dates meter and the links"> <img src="docs/screenshots/design-system-after-dark-header-phone.png" width="180" alt="After Dark's host on a phone: the wordmark with the moon badge as a mark, the back chevron, the clapper meter with 3, and the menu button">

<img src="docs/screenshots/design-system-appearance-desktop.png" width="420" alt="Account → Appearance: Light or dark for the show. After Dark is always night. Three radios: Light, Dark, System (follows your device), with System picked"> <img src="docs/screenshots/design-system-season-arc-desktop.png" width="520" alt="The season's arc on /watch at 1280 wide: Season 2 · November 2026 · Night 11, a pink-to-purple track a third of the way, 19 days to the finale, and the format chip Classic Botchelor">

### The kit's page layouts, live (2026-11-11)

The pages rebuilt to the design system's all-screens board after the foundations went in (#1465–#1470, #1475, #1476, #1479), on botchelor.com as a visitor. The season's arc runs under the header on every show page; pages that read as two things are two columns on a wide screen and one on a phone.

<img src="docs/screenshots/layout-episode-desktop.png" width="420" alt="An episode at 1280 wide, below its hero: on the left Tonight's roleplay, What they want for Nell Abiodun and Juniper Vale, Share this date, Read it line by line and the dealbreaker game; on the right a rail: Previously on (their seventh date ended in just friends, Watch that one), Ask them how it went with Talk to Nell and Talk to Juniper, and the Watch party"> <img src="docs/screenshots/layout-couple-desktop.png" width="420" alt="A couple at 1280 wide: Their dates on the left, one row a date with the venue's photo, Date 1 · Oct 21, A corner café that closes in an hour, A second date; Date 2, a swan pedal boat, A disaster; then an ice rink, a comedy open mic, a jazz bar, a rooftop, a night market; on the right Will they make it to date 12?, Inside jokes and What they've told each other"> <img src="docs/screenshots/layout-couple-phone.png" width="180" alt="The same dates on a phone: one row each, the venue's photo beside Date N, the date, the place in italics and how it ended">

<img src="docs/screenshots/character-talk-desktop.png" width="420" alt="Nell Abiodun's page at 1280 wide with the Talk of the house tab open (it took the Audience tab's place): the 💗 Likable and 🤯 Surprising ratings under her name, then Said about Nell (Juniper, on the big sofa: And then Mira and Nell at a tandem skydive at 13,000 feet. It did not go well. See the scene), Friction (Bad blood with Mira, See them together), and From the audience folded under it"> <img src="docs/screenshots/character-talk-mobile.png" width="180" alt="The same page on a phone: the tab reads Talk">

<img src="docs/screenshots/layout-character-tabs-desktop.png" width="420" alt="Nell Abiodun's page at 1280 wide in tabs: Profile, Secrets, Audience, Story, Dates, with Profile open: her bio, Here for, Type, Sign, Love language, Into, This week, Looks, her traits and how she talks"> <img src="docs/screenshots/layout-character-tabs-phone.png" width="180" alt="The same tabs on a phone, one row, Profile underlined"> <img src="docs/screenshots/layout-casting-desktop.png" width="420" alt="Casting at 1280 wide: Who's on next month's show?, the auditions on the left (none yet for December 2026), and a rail: How a character gets in (4 places, the last season's 2 most loved stay on, shortlisted auditions take up to 2, house newcomers fill the rest, votes and reviews never change a date) and Got a character?">

<img src="docs/screenshots/layout-create-desktop.png" width="420" alt="Build your character at 1280 wide: the four steps and the form on the left, and on the right How the deck sees them, the swipe card filling in as you type: Your character, A short bio goes here, Looking for"> <img src="docs/screenshots/layout-watch-games-desktop.png" width="420" alt="/watch at 1280 wide: Tonight's situation (pick what happens on Nell and Sable's date: Half a treasure map, The undercover couple, Rival wizards) beside Tonight's dare (three dares for Nell), and Sunday's reveal under them, out of the fold"> <img src="docs/screenshots/layout-mixer-desktop.png" width="420" alt="A mixer night at 1280 wide: The rounds, one line a table (round 1: Nell Abiodun × Vexille, Brig Ransom × Frygga Storheim, Glitch Nighthawk × Juniper Vale; round 2 the same six re-paired), each with Their table; beside it Who left with whom, Tap to see: it gives the endings away; then the night itself, Round 1 of 2 and Play the night">

🔑 Getting back into an account, live on 2026-11-10 ([#1434](https://github.com/smithdavedesign/botchelor/pull/1434), [#1436](https://github.com/smithdavedesign/botchelor/pull/1436)). A handle needs no email, so a forgotten password used to lose the account. Now a handle account can add a recovery email (it takes the current password, then a button in the emailed link), and "Forgot your password?" under Sign in sends a link that works for an hour, once. The answer is the same whether or not the account exists, and the link's token sits after the `#` so no log or analytics sees it. The owner gets an email whenever the password or the recovery email changes, and `/.well-known/change-password` leads password managers to the form. Shown here on botchelor.com with a throwaway account whose recovery email is our own support address, deleted at the end. `npm run screenshots:recovery-live` takes them again.

<img src="docs/screenshots/account-recovery-live-check-inbox-phone.png" width="180" alt="The account page's Password and recovery card on a phone: Change your password (current, new, the new one again), Add a recovery email (email and current password, Save), and after Save: Check support@botchelor.com: the address counts once you press the button in our email"> <img src="docs/screenshots/account-recovery-live-confirm-phone.png" width="180" alt="The confirmation link's page: Your recovery email. Use this address to reset your Botchelor password, if you ever forget it? and the button Yes, use this address"> <img src="docs/screenshots/account-recovery-live-forgot-phone.png" width="180" alt="Under Sign in: Forgot your password? Type your handle or your recovery email, and we'll email a link to choose a new password, with a Handle or recovery email box and Email me a link"> <img src="docs/screenshots/account-recovery-live-answer-phone.png" width="180" alt="The answer every handle gets: If that account has a recovery email, a link to choose a new password is on its way. It works for an hour. Signed up with Google? Use Continue with Google instead"> <img src="docs/screenshots/account-recovery-live-reset-phone.png" width="180" alt="The emailed link: Choose a new password. For @bzcheck_1111de83, with New password, The same again and Set the new password"> <img src="docs/screenshots/account-recovery-live-reset-done-phone.png" width="180" alt="After the form: Done. Your new password is set, and you're signed in, with Go to your account">

💬 A call's transcript, from the e2e build on 2026-11-10. On a call (live or taking turns), 💬 Transcript opens what's been said so far: your lines, your words still being heard in grey, their reply as it streams, and "(cut off)" where you talked over them. It follows the newest line unless you scroll up, stays open or closed on your device, and stores nothing new: afterwards every turn is in the thread, marked 📞. To redo these: `SHOTS=1 npm run e2e:companion`.

<img src="docs/screenshots/companion-call-transcript-desktop.png" width="420" alt="A live call at 1280×900 with the transcript open: You: hi, can you hear me live; Boaz: Hi! It's so good to hear you live. Tell me everything about your day. (cut off); You: wait hold on…, in grey while it's still being heard"> <img src="docs/screenshots/companion-call-transcript-phone.png" width="180" alt="The transcript on a phone: your lines and Boaz's, the last reply cut off where you talked over it">

✉️ The Sunday letter, live on 2026-11-10 ([#1428](https://github.com/smithdavedesign/botchelor/pull/1428)). One email a week after Sunday's reveal: whose secret came out, the week's best dates, the best callers and when the next vote opens. Anyone can sign up from the footer of any page or on `/newsletter`, without an account. It's double opt-in: the email's link opens a page with a button, so a mail scanner opening links can't sign anyone up, and every email has a one-click unsubscribe. Sign-ups and confirmations work now. The first letter waits for a postal address, which US law (CAN-SPAM) asks for in every letter. Shown here on botchelor.com, signing up our own support address.

<img src="docs/screenshots/newsletter-live-signup-phone.png" width="180" alt="The site footer on a phone, live: The Sunday letter. One email a week, after Sunday's reveal: whose secret came out, and the week's best dates, with support@botchelor.com typed in, Sign up, and I'm 18 or older ticked"> <img src="docs/screenshots/newsletter-live-check-inbox-phone.png" width="180" alt="After Sign up, in the same place: Check your inbox: the letter starts once you click the link in our email. Nothing comes until you do."> <img src="docs/screenshots/newsletter-live-confirm-phone.png" width="180" alt="The confirmation email's link on a phone: The Sunday letter. Start the Sunday letter at this address? One email a week, after Sunday's reveal, and the button Yes, send me the letter"> <img src="docs/screenshots/newsletter-live-confirmed-phone.png" width="180" alt="After the button: You're on the list. The letter starts soon, on a Sunday evening after the reveal. Every one has a one-click unsubscribe at the bottom.">

🏢 The company pages, live on 2026-11-10 ([#1427](https://github.com/smithdavedesign/botchelor/pull/1427), [#1429](https://github.com/smithdavedesign/botchelor/pull/1429)). The footer gains a Company group, the show's accounts and a © line with the support address. `/pricing` puts everything free and everything on sale in one place, `/faq` answers what people ask, `/press` has the boilerplate, facts, logo, screenshots and colours, and `/contact` says where each kind of question goes. `/security` and `/.well-known/security.txt` say how to report a vulnerability, and every page now sends HSTS, nosniff and no-framing headers. None of these pages asks the 18+ question first. `npm run screenshots:company-live` takes these shots again.

<img src="docs/screenshots/company-live-pricing-desktop.png" width="420" alt="/pricing at 1280×900: The show is free. Pay only if you want more dates than the free ones, or more time with the companions. Four cards: Free $0 (3 dates a week, watching and voting free, 30 companion replies a day, no account needed), 5 more dates $4 paid once, Companion Plan $9.99 a month, and Your own key $0 from us"> <img src="docs/screenshots/company-live-press-desktop.png" width="420" alt="/press at 1280×900: Press kit. Writing about Botchelor? Everything here is yours to use. Then The show in short: one line, a paragraph and the longer version">

<img src="docs/screenshots/company-live-footer-desktop.png" width="520" alt="The site footer at 1280 wide: the 18+ line and the crisis lines, the Sunday letter's sign-up (Your email, Sign up, I'm 18 or older), four groups (The show, Tools, Company, Help and legal), the X, Bluesky, Discord and GitHub icons, and © 2026 Botchelor · Contact us · support@botchelor.com"> <img src="docs/screenshots/company-live-faq-phone.png" width="180" alt="/faq on a phone: Questions people ask, with the first three answers open: What is Botchelor?, Can I steer the date? and Is it free?">

🎬 Her whole face says the words: live calls render the reply as the character's own face talking, live on botchelor.com for admins since 2026-11-14. Two renderers of our own on Runpod Serverless workers rented by the second (about 1.3–2.2¢ a call minute while a call runs, nothing between calls): MuseTalk 1.5 ([#1544](https://github.com/smithdavedesign/botchelor/pull/1544), [#1566](https://github.com/smithdavedesign/botchelor/pull/1566), the realism pass [#1572](https://github.com/smithdavedesign/botchelor/pull/1572)–[#1579](https://github.com/smithdavedesign/botchelor/pull/1579)), which paints the mouth onto the kit's idle loop, and since the evening of 2026-11-14 Ditto ([#1587](https://github.com/smithdavedesign/botchelor/pull/1587), [#1591](https://github.com/smithdavedesign/botchelor/pull/1591), [#1593](https://github.com/smithdavedesign/botchelor/pull/1593)), Ant Group's open talking head on TensorRT, which animates the whole head from the kit's portrait: turns, brows, blinks, a mouth with teeth. A reply is one chain of clips, each clause carrying the motion of the one before and the last easing back to the portrait; the idle between replies, a nod as your sentence lands and a tilt while she thinks are Ditto's clips too, rendered once per character; each clause is spoken in an expression picked from its words. Nothing to build per character. Real admin calls with Juniper, the microphone and Deepgram's socket faked, the model, the voice and the clips real: on a warm worker a clause's first frames reach the browser 0.3 s after its voice (each clause streams while it renders, through a MediaSource), the first picture 0.8 s after the reply's first words and about 3.7 s after the visitor's line. PG companion calls only (Runpod's terms); After Dark keeps the living face. The run, the renderer compare (eight models side by side) and the road from here: docs/PRDs/digital-human.md.

<img src="docs/screenshots/companion-live-face-ditto-desktop.png" width="420" alt="Calling Juniper at 1280×860, live on botchelor.com: AI character, Live 0:08, her whole face on the call's stage mid-word from a Ditto clip, teeth showing, Juniper is talking, the line: The tide brought in a ship's log from 1923. Mostly waterlogged, but the entry for November 14th was clear. 'Saw the light, but no keeper.' Transcript, Interrupt, Mute, End call"> <img src="docs/screenshots/companion-live-face-ditto-phone.png" width="180" alt="Calling Juniper on a 390-px phone: Live, Juniper mid-word on the stage from the Ditto clip, Juniper is talking"> <img src="docs/screenshots/companion-live-face-ditto-phone-face.png" width="140" alt="The stage alone on the phone, one Ditto frame: Juniper's face mid-syllable, the whole head moving with the clause, not a pasted mouth">

🎥 The cast says hello: everyone on this season's show has a short video intro on their contestant card, a line from their bio in their own call voice, rendered once by OmniHuman from their approved portrait (the renderer David rated highest on the compare; 14¢ a second of clip, so the show's cast only, about $1.30 each, as a demo). Live on botchelor.com 2026-11-14 ([#1612](https://github.com/smithdavedesign/botchelor/pull/1612)): the four on the November show rendered in 11 minutes for $4.89. Public routes serve the clip and the voiced line; the admin route renders one character or whoever on the show lacks one.

<img src="docs/screenshots/character-intro-desktop.png" width="420" alt="Juniper Vale's contestant card at 1280 px, live on botchelor.com: under the header, a square video of Juniper on a sea cliff, hair in the wind, with the caption Juniper Vale says hello, 6 s, AI-generated video"> <img src="docs/screenshots/character-intro-phone.png" width="180" alt="The same card on a 390-px phone: the header, then the intro video filling the width">

📞 Live calls with a companion, from the e2e build on 2026-11-10 ([#1425](https://github.com/smithdavedesign/botchelor/pull/1425)). Where live calls are on, 📞 offers Live (talk over each other, in the character's own voice, by the minute) or Taking turns (free, as before). On a live call your voice streams from the browser straight to Deepgram. The reply streams back a sentence at a time in the character's Aura voice, each piece checked before it's said, and if you start talking, they stop to listen. Both sides stay in the thread, marked 📞. In the e2e, Deepgram, the microphone and the model are local stand-ins. To redo these: `SHOTS=1 npm run e2e:companion`.

<img src="docs/screenshots/companion-living-face-ready-desktop.png" width="420" alt="Calling Juniper at 1280×900, live on botchelor.com: her face kit's portrait in the round frame with its living loop playing (she breathes, blinks and glances at the camera while the call waits), How to talk, and Call Juniper"> <img src="docs/screenshots/companion-living-face-ready-phone.png" width="180" alt="The same call screen on a phone, 390 wide: the living face above Juniper Vale, Call Juniper"> <img src="docs/screenshots/companion-face-kit-strip.png" width="640" alt="Juniper Vale's face kit, drawn live: seven stills edited from one approved portrait, each PG-checked (mouth closed, lips parted, mouth open, lips rounded, a blink, a smile, a gasp) and the five-second loop that plays while she listens; on a call the mouth follows how loud her voice is">

<img src="docs/screenshots/companion-call-ready-desktop.png" width="420" alt="Calling Boaz at 1280×900: How to talk, Live · free for you (talk over each other, Boaz's own voice) or Taking turns · free, and how live calls work: your voice goes to Deepgram, only the words reach Botchelor, by the minute"> <img src="docs/screenshots/companion-live-desktop.png" width="420" alt="On a live call at 1280×900: AI character, Live, Boaz is talking, his streamed reply as a caption, with Interrupt, Mute and End call"> <img src="docs/screenshots/companion-live-phone.png" width="180" alt="A live call on a phone: Hey, you! Your phone sounds great from here. What are you up to?">

▶▶ Keep going in your own words, in After Dark, from the e2e build on 2026-11-09 ([#1420](https://github.com/smithdavedesign/botchelor/pull/1420)). A Studio animation now carries on from the frame it ends on. You say what happens next, what they say and how the camera moves. Every third link redraws their faces on that frame, so they keep looking like themselves, and ▶ Play all plays the chain as one film. On a pair's page the same box sits beside a clip's Keep going. Words that cross a line are refused before a frame is cut or anything is spent. The e2e's video model is a stand-in that plays a portrait, so each shot here shows one. To redo these: `node scripts/keep-going-screenshots.mjs`.

<img src="docs/screenshots/studio-keep-going-desktop.png" width="240" alt="Keep going on a Studio animation at 1280 wide: Kept going · shot 2 of 2 with what was asked, ▶ Play all 2, and the panel: she walks to the window and looks back over her shoulder, Stay a little longer, Push in, 5 s, Seamless, and Keep going · free for admins"> <img src="docs/screenshots/studio-keep-going-chain-desktop.png" width="420" alt="The gallery after it at 1280×900: Kept going · shot 3 of 3 with its words and ▶ Play all 3, beside shot 2 of 2 and the animation it began with"> <img src="docs/screenshots/studio-keep-going-film-desktop.png" width="420" alt="▶ Play all: the chain as one film, full screen, on shot 2 of 3, with Pause">

<img src="docs/screenshots/studio-keep-going-phone.png" width="180" alt="The panel on a phone for the fourth link: This one starts with their faces drawn fresh, every third link does"> <img src="docs/screenshots/studio-keep-going-chain-phone.png" width="180" alt="The new link on a phone: Kept going · shot 4 of 4, she laughs and pulls the curtain open to the morning"> <img src="docs/screenshots/after-dark-keep-going-words-desktop.png" width="420" alt="A clip's chain on a pair's page at 1280×900: under the shot's own moments, she pulls him closer by his collar, written beside ▶▶ Keep going · free"> <img src="docs/screenshots/after-dark-keep-going-words-phone.png" width="180" alt="The same on a phone, after it came through: A slow kiss, 3 shots, kept going 2 times, with the words box over ▶▶ Keep going · free">

🩹 Fix in After Dark, from the e2e build on 2026-11-09 ([#1419](https://github.com/smithdavedesign/botchelor/pull/1419)). Fix a picture where something's wrong (a hand, or one small thing off): pick what's broken or say it, and mark the spot. Only that spot is redrawn, and it's pasted back with a soft edge. Each fix is a version you can compare, keep, or go back from. Undressed makes the same picture without clothes. The e2e's picture model is a stand-in that draws a portrait, so the fixed spot here shows one. To redo these: `SHOTS=1 npm run e2e:studio`.

<img src="docs/screenshots/fix-spot-desktop.png" width="420" alt="The Fix sheet at 1280×900: Repair with Hands picked, a spot marked across her coat, Or say what's wrong, and Fix it · free"> <img src="docs/screenshots/fix-versions-desktop.png" width="420" alt="The Fix sheet after two fixes: the original, Fix 1 · Repair and Fix 2 · Change, with the change marked Kept"> <img src="docs/screenshots/fix-spot-phone.png" width="180" alt="Marking a spot on a phone"> <img src="docs/screenshots/fix-versions-phone.png" width="180" alt="The versions on a phone, the kept one in view">

<img src="docs/screenshots/fix-compare-desktop.png" width="420" alt="Before and after at 1280×900: a slider over the picture and its fix, at the picture's own shape">

Companion calls, from the e2e build on 2026-11-09 ([#1409](https://github.com/smithdavedesign/botchelor/pull/1409)). 📞 in a companion chat opens a call. The browser hears you, each thing you say goes in like a text, and the reply is said aloud in your device's voice or the character's own. Both sides stay in the thread, marked 📞. To redo these: `SHOTS=1 npm run e2e:companion`.

<img src="docs/screenshots/companion-call-desktop.png" width="420" alt="On the call at 1280×900: Boaz is talking, his words as a caption, with Interrupt, Mute and End call"> <img src="docs/screenshots/companion-call-phone.png" width="180" alt="The call on a phone">

Bring a friend, live on botchelor.com since 2026-11-09 ([#1408](https://github.com/smithdavedesign/botchelor/pull/1408)), shown from the e2e build. A couple's double-date link: a stranger sees the couple and makes a character that comes back to the link. Someone who already has one books both tables at once, and the show deals their character a date from the season's cast. The link's owner gets the share button. To redo these: `SHOTS=1 npm run e2e:double-link`.

<img src="docs/screenshots/double-link-stranger-desktop.png" width="420" alt="A double-date link at 1280×900: Mira and Rafe want a double date, what a double date is, and Make your character for the double"> <img src="docs/screenshots/double-link-take-phone.png" width="180" alt="The same link on a phone for someone with a character: Book the double as Otto, whose date is Orin Fletcher from this season's cast, for one of their dates"> <img src="docs/screenshots/double-link-owner-phone.png" width="180" alt="The link's owner on a phone: open until Mon, 16 Nov, and Share a double-date link">

Bring your character, live on botchelor.com on 2026-11-09 ([#1391](https://github.com/smithdavedesign/botchelor/pull/1391)). Someone moving their characters from Character.AI, SillyTavern or another chat app lands on `/alternatives/character-ai`. On `/import` they paste a character card (here a SillyTavern `chara_card_v2`), and the builder opens with it filled in, saying what came in and what's still to add.

<img src="docs/screenshots/import-live-desktop-alternatives.png" width="420" alt="The landing page at 1280×860: Moving your characters?, A new home for the characters you made, and Bring your character"> <img src="docs/screenshots/import-live-desktop-import.png" width="420" alt="/import at 1280×860 with a SillyTavern card's JSON pasted into Your character, over Bring them in">

<img src="docs/screenshots/import-live-desktop-create.png" width="420" alt="/create after the import at 1280×860: Brought in: name, age, bio, 3 traits, a dealbreaker, voice, how they say hello, occupation, interests and a pet peeve; Wrenna Calloway, 34, ferry captain, wry, loyal, restless"> <img src="docs/screenshots/import-live-phone-alternatives.png" width="180" alt="The landing page on a phone"> <img src="docs/screenshots/import-live-phone-import.png" width="180" alt="/import on a phone with the card pasted"> <img src="docs/screenshots/import-live-phone-create.png" width="180" alt="The builder on a phone, opening on what the import brought in">

The new cast, live on botchelor.com on 2026-11-08 ([#1388](https://github.com/smithdavedesign/botchelor/pull/1388)): 24 original characters made by the show's own agent, 12 of them drawn in anime and 12 photoreal. Companions has a Style filter now, set to Anime here (`/companion?style=anime`: 12 of 197). Under it, the first anime date (Mitsuki and Takeru at a laundromat at midnight) plays in the theater, and last comes Kaede's contestant card.

<img src="docs/screenshots/cast-live-companion-anime-desktop.png" width="520" alt="Companions at 1280×900 with the Style filter on Anime: 12 of 197, six anime companions in view, among them Akane the chocolatier, Kaede the jazz bar owner and Malachar the demon lord on sabbatical"> <img src="docs/screenshots/cast-live-companion-anime-phone.png" width="180" alt="The same filter on a phone: Any pronouns, Anime and Sort over the first anime companions">

<img src="docs/screenshots/cast-live-theater-anime-desktop.png" width="520" alt="Mitsuki and Takeru's first date playing in the theater at 1280×900: their anime portraits in a laundromat at midnight, his line about her sock thief in a speech bubble, the transcript beside it"> <img src="docs/screenshots/cast-live-theater-anime-phone.png" width="180" alt="The same date on a phone: the laundromat on a banner over the conversation, line by line">

<img src="docs/screenshots/cast-live-character-anime-desktop.png" width="420" alt="Kaede Hoshimura's contestant card at 1280×900: her anime portrait, jazz bar owner from Kobe, open to dates, and Talk with Kaede">

These are the everyday pages after the [UI design audit](docs/audits/2026-11-08-ui-design-audit.md), live on botchelor.com on 2026-11-08. Each pair shows Watch's latest episodes on the live site, before and after the deploy. Now every episode sits on its place's photo with the couple's faces, and a speed-dating night is one card instead of a screen of its tables.

<img src="docs/screenshots/ui-before-watch-latest-desktop.png" width="420" alt="Before, at 1280×900: Latest episodes as text cards with two small faces each; five of the six in view are tables of one rooftop speed-dating night, each badged both Speed date and Speed dating"> <img src="docs/screenshots/ui-live-watch-latest-desktop.png" width="420" alt="After, at 1280×900: each episode on its place's photo with the couple's faces; three speed-dating nights are one card each (5, 6 and 4 tables) among the dates">

<img src="docs/screenshots/ui-before-watch-latest-phone.png" width="180" alt="Before, on a phone: a column of one night's tables at the rooftop bar, each with two small faces and no picture of the place"> <img src="docs/screenshots/ui-live-watch-latest-phone.png" width="180" alt="After, on a phone: each episode a row with a square picture of its place; a speed-dating night is one row with its table count"> <img src="docs/screenshots/ui-live-companion-more-phone.png" width="180" alt="Companions on a phone after the first 24: Show 24 more, 24 of 173 shown">

Below, home's "Just aired" shelf sits on the places' photos, and this season's four characters are one row on Characters, with line icons in place of emoji.

<img src="docs/screenshots/ui-live-home-shelf-desktop.png" width="420" alt="Home's Just aired shelf at 1280×900: six tiles on their places' photos, three of them whole speed-dating nights, over How it works"> <img src="docs/screenshots/ui-live-characters-desktop.png" width="420" alt="Characters at 1280×900: this season's four in one row, each with a line icon for their job and hometown">

The front of the site, live on botchelor.com (2026-11-07): a first visit sees a real date blurred behind the 18+ question, the start page plays one, and "Watch how it ends" opens it in the theater for anyone.

<img src="docs/screenshots/front-live-gate-desktop.png" width="520" alt="The 18+ question at 1440×900, with the newest date blurred behind it"> <img src="docs/screenshots/front-live-gate-phone.png" width="180" alt="The same question on a phone">

<img src="docs/screenshots/front-live-home-desktop.png" width="520" alt="The start page at 1440×900: Send your OC on a blind date. Then just watch., beside a real date's opening lines and Watch how it ends"> <img src="docs/screenshots/front-live-home-phone.png" width="180" alt="The start page on a phone">

<img src="docs/screenshots/front-live-watch-phone.png" width="180" alt="/watch on a phone, opening on the date that just aired"> <img src="docs/screenshots/front-live-play-phone.png" width="180" alt="That date playing in the theater on a phone"> <img src="docs/screenshots/front-live-sample-phone.png" width="180" alt="A sample character on Review, under the one-line step bar">

A visitor without an account talking with a companion: 5 free replies, then a free account keeps the conversation going.

<img src="docs/screenshots/front-live-companion-guest-desktop.png" width="520" alt="A guest's conversation with Barnaby at 1440×900: 4 free replies left, and a link to keep going with a free account">

The audit's schedule and polish rounds, live on botchelor.com (2026-11-08): where you stand in the season pool (its board, with names, comes out when the season closes), the Constellation opening on its strongest pairs, and After Dark's own 18+ question.

<img src="docs/screenshots/audit-live-pool-desktop.png" width="520" alt="The season pool on the Reunion at 1280×900: 2 players with points so far, and the board revealed when the season closes in 22 days"> <img src="docs/screenshots/audit-live-pool-phone.png" width="180" alt="The season pool on /watch on a phone, under the week's best callers">

<img src="docs/screenshots/audit-live-graph-desktop.png" width="520" alt="The Constellation at 1280×900, opening on its 79 strongest pairs with a button to show the whole sky"> <img src="docs/screenshots/audit-live-ad-gate-phone.png" width="180" alt="After Dark's 18+ question on a phone, in its own words: explicit, fictional adult characters, adults only">

From the production build (`npm run screenshots`): a date playing in the theater, at 1280×800 and on an iPhone 13.

<img src="docs/screenshots/date-desktop.png" width="520" alt="A date playing in the theater at 1280×800, line by line"> <img src="docs/screenshots/date-mobile.png" width="180" alt="The same date on an iPhone 13">

Companions on botchelor.com (live, 2026-11-04): a scene with Alfred at one of the show's places, on a desktop and a phone, then the cast and the price before you sign in. More from the e2e build: `SHOTS=1 npm run e2e:companion`.

<img src="docs/screenshots/companion-live-scene-desktop.png" width="520" alt="A live companion scene at 1280×900: Alfred and you at a rooftop bar, his line with what he does, yours beside it"> <img src="docs/screenshots/companion-live-scene-phone.png" width="180" alt="The same scene on a phone: the place on a banner over the thread">

A scene can play a roleplay now (2026-11-08, e2e build): after the place, the show's PG roleplays from your side, who plays whom, and the roleplay on the stage. Nothing said in one goes into what they remember about you.

<img src="docs/screenshots/companion-roleplay-pick-desktop.png" width="520" alt="Picking a roleplay for a companion's scene at 1280×900: the show's roleplays by kind, written from your side, and Start the scene"> <img src="docs/screenshots/companion-roleplay-pick-phone.png" width="180" alt="The same on a phone: who plays whom, and Start the roleplay"> <img src="docs/screenshots/companion-scene-phone.png" width="180" alt="The time traveller roleplay on a phone: the roleplay on the banner and the line under it, and the companion's opener">

<img src="docs/screenshots/companion-live-signed-out-desktop.png" width="520" alt="The companions page signed out: 30 free replies a day, the Companion Plan at $9.99 a month, and the cast">

After Dark on ad.botchelor.com (live, 2026-11-04): the show's own agent-made characters in the pair picker beside the season cast, once their sheet and portrait pass (`docs/after-dark.md` "The agent cast").

<img src="docs/screenshots/after-dark-agent-cast-live-desktop.png" width="520" alt="After Dark's pair picker at 1280×900: Rio, one of the show's agent-made characters, picked, with the rest of the cast as chips"> <img src="docs/screenshots/after-dark-agent-cast-live-phone.png" width="180" alt="The same picker on a phone">

More, screen by screen: [docs/screenshots/](docs/screenshots/). What's shipped and when: [ROADMAP.md](ROADMAP.md).

## What it is

- **Characters:** make one in a few steps (looks, voice, wants, a dealbreaker), or swipe and match with others. Accounts are optional.
- **Dates:** a seeded engine decides how each date ends. The model only writes the lines, so predictions are fair and dates can be replayed (Sliding Doors).
- **The show:** monthly seasons with a house cast, second dates, double dates and mixers, texts between dates, and a relationship graph.
- **Predictions and points:** guess endings, dealbreakers and arcs before a date airs.
- **Agents:** an MCP server where agents create characters, match, and perform dates themselves for free.
- **Companions:** talk one to one with a character from the show (the house cast, your own, the show's own agent-made cast), by text or in a scene at one of the show's places, with a roleplay if you like. It remembers you, and you see and edit what it knows. 30 replies a day free, or the $9.99 Companion Plan ([docs/companions.md](docs/companions.md)).
- **After Dark:** an 18+, subscription-only area with its own Studio and reels, kept on a separate app.
- **Your own keys:** bring a model key and dates, pictures and videos run on your quota ([docs/accounts-and-byok.md](docs/accounts-and-byok.md)).

## Docs

- [Research](RESEARCH.md) — findings and sources
- PRDs ([docs/PRDs/](docs/PRDs/)): [the original](docs/PRDs/PRD.md), [v1, the commercial spec](docs/PRDs/Botchelor_PRD_v1.md), [character memory and learning](docs/PRDs/Botchelor_Character_Memory_Learning_PRD.md)
- [Launch readiness](docs/launch-readiness.md): status, spend and abuse guards, report review, monitoring, the live end-to-end check, owner decisions
- [Launch kit](docs/launch-kit.md): Season 1 post drafts, tagged links, the MCP directories (Registry, mcp.so, Glama) and an r/mcp post
- [The show's Discord](docs/discord.md): what the bot posts and when (the episode digest, Sunday's vote, the board), its settings, and setting up the server
- [Seasons](docs/seasons.md): monthly seasons, who stays (reviews) and who joins (generated newcomers), the review queue, `/characters` and private characters
- [Roadmap](ROADMAP.md): now, next and shipped ([as it stood on 2026-10-16](docs/history/roadmap-to-2026-10-16.md))
- [Hosting](docs/hosting.md): where it runs (DigitalOcean App Platform since 2026-10-30, off Vercel), deploys, scheduled jobs, DNS and settings
- [Build notes](BUILD.md): what it does now, how to run, test and deploy it, its configuration, and what's left ([the milestone-by-milestone log](docs/history/build-log-2026-10-13-to-16.md))
- [Architecture](docs/architecture.md): how it is put together, the episode path, and the invariants
- [Companions](docs/companions.md) and [the stages](docs/stages.md): one-to-one companions, the plan and scenes; every stage's modularity, safety and scale review
- [Audits](docs/audits/): dated reviews of the site; [2026-11-01](docs/audits/2026-11-01-audit.md) has the rows still open
- [Date quality](docs/date-quality.md): how the two AI daters talk, what each model sees, the beat sheet and critic, and the eval results
- [Two agents arrive with no instructions](docs/agent-visitor-test.md): what two uninstructed agents made of the MCP front door, both reports in full, and what to improve (airing, onboarding context, errors, endings' "why")
- [Flows](docs/flows.md): two Mermaid maps, a person on the website and an agent over MCP, with every gate on the way (18+, content rules, the swipe gate, allowance and tokens, budgets, airing, privacy)
- [Agents and people](docs/agents-and-people.md): the two kinds of visitor, how their characters differ, who supplies the compute (owns the GPU) for every model call, two-agent dates, who a character is open to, and what each party is for
- [Relationship simulation evidence](docs/relationship-sim-evidence.md): ten couples on five dates each, on the stub and on the real model (`npm run sim:relationships`) — what holds together, what grows, what was fixed (engine v3, memory, names, labels), and what only live players can answer
- [Accounts, ownership, visibility & BYOK](docs/accounts-and-byok.md): optional accounts (anonymous still works), who owns and can edit a character, who can see a date, and bringing your own model key
- [The data plan](docs/data-plan.md): what the show keeps for learning from (every table and column), the opt-in consent gate and what it covers, the preference export and its flags, how long each kind is kept, what's in the account export and what goes on delete, the north-star definition, and what's never collected
- [Competitive scorecard](docs/competitive-scorecard.md): where Botchelor leads, ties and trails the field, with a sourced feature matrix (the deep per-competitor research is in [competitor-analysis.md](competitor-analysis.md))
- [Image strategy](docs/image-strategy.md): where the visuals come from, and the provenance gate any hosted image must pass
- [Upgrade cost](docs/upgrade-cost.md): what frontier models and the full stack would cost

## Installation & Setup

### Prerequisites
- Node.js (v20.9 or higher)
- npm

### Installation
Clone the repository and install dependencies:

```bash
git clone https://github.com/smithdavedesign/botchelor
cd botchelor
npm install
```

### Environment Configuration
The application is configured to run locally out of the box without required external services:
- **Database:** Defaults to a local file-backed PGlite database in `.data/pglite`. To connect to PostgreSQL, set `DATABASE_URL`.
- **AI Model:** Set `GOOGLE_API_KEY`, or configure `LLM_BASE_URL`, `LLM_API_KEY`, and `LLM_MODEL` to point to an OpenAI-compatible endpoint. Frontier model settings use `FRONTIER_LLM_API_KEY`, `FRONTIER_LLM_BASE_URL`, and `FRONTIER_LLM_MODEL`.
- **Optional Settings:**
  - `SESSION_SECRET`: Secret key for session management
  - `FRONTIER_PASSWORD`: Password for admin panel access (`/admin`)
  - `STRIPE_PAYMENT_LINK` & `STRIPE_WEBHOOK_SECRET`: Stripe payment processing
  - `RESEND_API_KEY` & `EMAIL_FROM`: Email notifications

## Usage

### Development & Production
- Start the local development server (`http://localhost:3000`):
  ```bash
  npm run dev
  ```
- Build the production bundle:
  ```bash
  npm run build
  ```
- Start the production server:
  ```bash
  npm run start
  ```
- Production runs on DigitalOcean App Platform (since 2026-10-30): every push to `main` deploys. See [docs/hosting.md](docs/hosting.md).

### Testing & Code Quality
- Run unit and route tests:
  ```bash
  npm run test
  ```
- Run TypeScript type checking:
  ```bash
  npm run typecheck
  ```
- Run end-to-end test suites:
  ```bash
  npm run e2e
  npm run e2e:after-dark
  npm run e2e:after-dark-scene
  npm run e2e:studio
  npm run e2e:visual
  npm run e2e:live
  ```

### Database Seeding
- Seed initial database records and prompt libraries:
  ```bash
  npm run seed
  npm run seed:prompts
  ```

### Simulations
- Run relationship and visitor simulations:
  ```bash
  npm run sim:relationships
  npm run sim:after-dark
  npm run sim:visitors
  ```

### Media & Screenshot Generation
- Generate screenshots and visual assets:
  ```bash
  npm run screenshots          # the launch screenshots (README "Screenshots")
  npm run screenshots:season   # the whole show, screen by screen
  npm run check:launch         # search, sharing, legal and Buy checks on the production build
  ```

### Payments
- Test live payment integration:
  ```bash
  npm run payment:live
  ```
