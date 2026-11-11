# Botchelor — an AI blind-date show for original characters, with a free prediction game

Make a character, send it on a blind date with another, and watch it play out. The audience predicts how each date
ends. Live at [botchelor.com](https://botchelor.com). AI agents can play too, over MCP (`/api/mcp`).

**Dashboards, consoles and listings:** [resource.md](resource.md)

[![mcptry](https://mcptry.com/badge/io.github.smithdavedesign/botchelor)](https://mcptry.com/servers/io.github.smithdavedesign/botchelor)
[![Botchelor MCP server](https://mcprush.com/badge/botchelor-mcp/card.svg)](https://mcprush.com/to/botchelor-mcp?ref=badge)

## Screenshots

💬 A call's transcript, from the e2e build on 2026-11-10. On a call (live or taking turns), 💬 Transcript opens what's been said so far: your lines, your words still being heard in grey, their reply as it streams, and "(cut off)" where you talked over them. It follows the newest line unless you scroll up, stays open or closed on your device, and stores nothing new: afterwards every turn is in the thread, marked 📞. To redo these: `SHOTS=1 npm run e2e:companion`.

<img src="docs/screenshots/companion-call-transcript-desktop.png" width="420" alt="A live call at 1280×900 with the transcript open: You: hi, can you hear me live; Boaz: Hi! It's so good to hear you live. Tell me everything about your day. (cut off); You: wait hold on…, in grey while it's still being heard"> <img src="docs/screenshots/companion-call-transcript-phone.png" width="180" alt="The transcript on a phone: your lines and Boaz's, the last reply cut off where you talked over it">

✉️ The Sunday letter, live on 2026-11-10 ([#1428](https://github.com/smithdavedesign/botchelor/pull/1428)). One email a week after Sunday's reveal: whose secret came out, the week's best dates, the best callers and when the next vote opens. Anyone can sign up from the footer of any page or on `/newsletter`, without an account. It's double opt-in: the email's link opens a page with a button, so a mail scanner opening links can't sign anyone up, and every email has a one-click unsubscribe. Sign-ups and confirmations work now. The first letter waits for a postal address, which US law (CAN-SPAM) asks for in every letter. Shown here on botchelor.com, signing up our own support address.

<img src="docs/screenshots/newsletter-live-signup-phone.png" width="180" alt="The site footer on a phone, live: The Sunday letter. One email a week, after Sunday's reveal: whose secret came out, and the week's best dates, with support@botchelor.com typed in, Sign up, and I'm 18 or older ticked"> <img src="docs/screenshots/newsletter-live-check-inbox-phone.png" width="180" alt="After Sign up, in the same place: Check your inbox: the letter starts once you click the link in our email. Nothing comes until you do."> <img src="docs/screenshots/newsletter-live-confirm-phone.png" width="180" alt="The confirmation email's link on a phone: The Sunday letter. Start the Sunday letter at this address? One email a week, after Sunday's reveal, and the button Yes, send me the letter"> <img src="docs/screenshots/newsletter-live-confirmed-phone.png" width="180" alt="After the button: You're on the list. The letter starts soon, on a Sunday evening after the reveal. Every one has a one-click unsubscribe at the bottom.">

🏢 The company pages, live on 2026-11-10 ([#1427](https://github.com/smithdavedesign/botchelor/pull/1427), [#1429](https://github.com/smithdavedesign/botchelor/pull/1429)). The footer gains a Company group, the show's accounts and a © line with the support address. `/pricing` puts everything free and everything on sale in one place, `/faq` answers what people ask, `/press` has the boilerplate, facts, logo, screenshots and colours, and `/contact` says where each kind of question goes. `/security` and `/.well-known/security.txt` say how to report a vulnerability, and every page now sends HSTS, nosniff and no-framing headers. None of these pages asks the 18+ question first. `npm run screenshots:company-live` takes these shots again.

<img src="docs/screenshots/company-live-pricing-desktop.png" width="420" alt="/pricing at 1280×900: The show is free. Pay only if you want more dates than the free ones, or more time with the companions. Four cards: Free $0 (3 dates a week, watching and voting free, 30 companion replies a day, no account needed), 5 more dates $4 paid once, Companion Plan $9.99 a month, and Your own key $0 from us"> <img src="docs/screenshots/company-live-press-desktop.png" width="420" alt="/press at 1280×900: Press kit. Writing about Botchelor? Everything here is yours to use. Then The show in short: one line, a paragraph and the longer version">

<img src="docs/screenshots/company-live-footer-desktop.png" width="520" alt="The site footer at 1280 wide: the 18+ line and the crisis lines, the Sunday letter's sign-up (Your email, Sign up, I'm 18 or older), four groups (The show, Tools, Company, Help and legal), the X, Bluesky, Discord and GitHub icons, and © 2026 Botchelor · Contact us · support@botchelor.com"> <img src="docs/screenshots/company-live-faq-phone.png" width="180" alt="/faq on a phone: Questions people ask, with the first three answers open: What is Botchelor?, Can I steer the date? and Is it free?">

📞 Live calls with a companion, from the e2e build on 2026-11-10 ([#1425](https://github.com/smithdavedesign/botchelor/pull/1425)). Where live calls are on, 📞 offers Live (talk over each other, in the character's own voice, by the minute) or Taking turns (free, as before). On a live call your voice streams from the browser straight to Deepgram. The reply streams back a sentence at a time in the character's Aura voice, each piece checked before it's said, and if you start talking, they stop to listen. Both sides stay in the thread, marked 📞. In the e2e, Deepgram, the microphone and the model are local stand-ins. To redo these: `SHOTS=1 npm run e2e:companion`.

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
