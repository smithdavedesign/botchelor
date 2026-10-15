# Botchelor — an AI blind-date show for original characters, with a free prediction game

## Payment, tested live

`npm run payment:live` runs a purchase on https://botchelor.vercel.app with Stripe in test mode (2026-10-13): a fresh browser opens the shop, ticks the 18+ box, clicks Buy, pays $4 on Stripe's checkout with the test card 4242 4242 4242 4242, comes back to the shop, and the signed webhook adds the 5 pack dates. It passes at desktop and phone size.

![The shop with the episode pack and its Buy button](docs/screenshots/payment-desktop-1-shop-buy.png)
The shop on the live site: the 5-date pack, the 18+ and terms box, and Buy (the Stripe Payment Link with this order attached).

![Stripe test checkout on a phone, card filled in](docs/screenshots/payment-mobile-2-stripe-checkout.png)
Stripe's hosted checkout on a phone, in test mode.

![Back in the shop: plus 5 pack dates](docs/screenshots/payment-mobile-3-dates-added.png)
Back in the shop: "plus 5 pack dates", added by the webhook once Stripe confirmed the payment.

## Screenshots

Captured by `npm run screenshots` from the production build, with invented sample characters and players. A local stand-in plays the free model, so no API key is involved. The same run also buys "5 more dates" through the shop's Buy button: the sample Payment Link carries the order, a signed webhook arrives, and the shop shows the 5 dates. That check passes but saves no picture. The look is one documented system — tokens, type, components and the accessibility standards are in [`docs/brand.md`](docs/brand.md).

![Landing page for AI roleplayers, desktop](docs/screenshots/home-desktop.png)
The conversion landing page: the product shown in the hero (an avatar matchup and a live box score), a fast/free/no-sign-up CTA, then a feature grid, honest proof, a cast preview and an FAQ.

![Landing page on a phone](docs/screenshots/home-mobile.png)
The same start page on an iPhone 13 screen.

![The account page: signed in, owned characters, a bring-your-own-key slot, and per-date visibility, desktop](docs/screenshots/account-desktop.png)
The optional account (M16): anonymous play still works, but signing in keeps your characters across devices, lets you edit them and keep dates private, and lets you bring your own model key — stored encrypted, shown only by its last four. See [docs/accounts-and-byok.md](docs/accounts-and-byok.md).

![The account page on a phone](docs/screenshots/account-mobile.png)
The account page on an iPhone 13 screen.

![The immersive date theater: the two characters live in the venue scene with speech bubbles, desktop](docs/screenshots/episode-theater-desktop.png)
**The theater (M13):** watching a date is a full-screen *experience* — a window into the two bots, who live in the venue scene (one left, one right) with **persistent speech bubbles** while the date plays out. It's the live watch room's theater mode and a cinematic replay of any recorded date. Every feature rides along (reactions, the chemistry/chaos polls, predictions, the decision).

![The theater on a phone: a chat window with the characters' icons](docs/screenshots/episode-theater-mobile.png)
On a phone it becomes a **chat window** — a mood banner of the venue up top, the date playing out as a messaging thread with each character's icon.

![The live watch room in theater mode: a clean scene with chat and reactions docked, desktop](docs/screenshots/watch-theater-desktop.png)
The **live** room in theater mode keeps the scene clean — the noise lives in side panels behind two small icons (Twitch-style): **💬 chat** (with the reactions) and **🗳️ voting & questions** (predictions, the chemistry/question/**chaos** polls). Open one, both, or neither. The decision still lands on the scene, because that's the payoff, not chrome.

![A live room mid-date: the conversation as a messaging thread beside the scene, with a typing bubble for the next line, desktop](docs/screenshots/watch-live-thread-desktop.png)
**Follow the date like a chat:** the whole conversation runs beside the scene as a messaging thread: one character on the left, the other on the right, act dividers, the producer's curveball as a note. Live, the lines **drip in one at a time on the shared clock** with a typing bubble for whoever speaks next, instead of a whole act landing at once. On a phone the thread is the main view under a venue banner.

![The thread on a phone, mid-date](docs/screenshots/watch-live-thread-mobile.png)

![A finished room replaying the date, ending on the decision, desktop](docs/screenshots/watch-replay-desktop.png)
**Replays play like they aired:** open a room after it has finished and the date plays back from the top, line by line, paced by act, with play / pause / restart / skip. It ends on the decision.

![The character builder with the private-soul section open, desktop](docs/screenshots/builder-desktop.png)
The builder: the public character sheet, plus an optional **private soul** (values, humour, communication style) that shapes how the AI behaves on the date without ever being shown to the audience.

![The date settings: autonomy, strategy, budget, agenda, a note, desktop](docs/screenshots/date-settings-desktop.png)
Before a date, the owner sets **autonomy** (how closely the AI follows them), a **strategy**, a fictional **date budget**, a **secret agenda**, and slips in **a note in the pocket**. None of it can be bought.

![An episode written for a character created through the form, desktop](docs/screenshots/episode-desktop.png)
The core action, driven through the UI: a new character is created, sent on a date with a house character, and lands on the AI-labeled episode its creator can read. The **show-format** badge (**M11**) is the date's billing — here *Meet the parents*, in purple so it reads apart from the status badge.

![The "Filming the date…" state while the episode generates in the background, desktop](docs/screenshots/episode-generating-desktop.png)
**M10 — async generation.** The request is instant (the engine decides the outcome synchronously); the model work runs in the background and the page polls, so the creator lands on this *"Filming the date…"* state and it updates itself the moment it's ready. A terminal failure gives the date back.

![The "Filming the date…" state on a phone](docs/screenshots/episode-generating-mobile.png)
The same waiting state on an iPhone 13, with the AI disclosure and crisis links first.

![The date told as three acts, desktop](docs/screenshots/episode-acts-desktop.png)
Every date is a **three-act story** — first impressions, a revealing challenge (dealt by the AI producer), and the decision — with the engine deciding the outcome and the model narrating to it.

![The date played out turn by turn by the two character agents, desktop](docs/screenshots/episode-transcript-desktop.png)
**M9 — the date, line by line.** Captured **live on https://botchelor.vercel.app** (the real free model, not the stub): the date is performed **turn by turn**, each character its own agent reacting to the other's actual last line — nobody scripts them. The deterministic engine still decides the outcome; the conversation is steered onto it, which is why this one lands on a polite no. An agent only ever sees the other's *public* sheet, never its private soul or secret agenda.

![The turn-by-turn date on a phone](docs/screenshots/episode-transcript-mobile.png)
The same line-by-line date on an iPhone 13 screen, also captured live.

![The afterglow: the two AIs' private morning-after texts and the mutual verdict, desktop](docs/screenshots/episode-afterglow-desktop.png)
**M11 — the afterglow.** After the date, the two characters keep texting privately. Each owner already knows their own AI's verdict (the debrief); the thread and the mutual *"was it mutual?"* verdict unlock only once every real owner opts in. The texts are flavour — they never touch the engine, the box score or predictions.

![The afterglow on a phone](docs/screenshots/episode-afterglow-mobile.png)
The morning-after thread on an iPhone 13, alternating sides like a chat.

![The box score, secret agendas and confessionals on an aired episode, desktop](docs/screenshots/episode-boxscore-desktop.png)
The outcome is decided by a **deterministic engine**, not the model: the **box score** shows how chemistry, attraction, trust and awkwardness moved, with the best line, the revealed **secret agendas**, and the **confessionals**.

![The same kind of episode on a phone](docs/screenshots/episode-mobile.png)
The episode page on a phone, with the AI disclosure and crisis links first.

![The box score on a phone](docs/screenshots/episode-boxscore-mobile.png)
The box score on an iPhone 13 screen.

![A live watch-party room: matchup, a live viewer count, reactions, live chat and the prediction panel, desktop](docs/screenshots/watch-desktop.png)
**Watch parties (M8):** a date becomes a live event. The pre-generated date plays on one shared clock while the audience reacts (😂 ❤️ 🚩 🍿), argues in live chat and calls the ending — *spectator mode*: the audience reacts and predicts, it never steers the characters. Always-on **template rooms** start the moment someone taps in, so there's always a date to drop into. The chemistry verdict stays hidden until the decision, so the room can still be surprised. The **chaos button** (shown during the challenge, not in this pre-show shot) lets the crowd vote a curveball; at the decision the room reveals a clearly-non-canon *"chaos timeline"* — the deterministic alternate it would've produced — while predictions still resolve on the real ending.

![The watch-party room on a phone: the date up top, chat in a panel below](docs/screenshots/watch-mobile.png)
On a phone the date takes the screen and chat sits in a panel below, so the dialogue is never buried under the wall of messages.

![A friends' league with last season's podium and this week's board, desktop](docs/screenshots/league-season-desktop.png)
Seasons (M4): the first visit after Monday 00:00 UTC closed last week's season, so the top 3 got badges (a tie shares 2nd). This week's board counts only this week's finales.

![The league's season and podium on a phone](docs/screenshots/league-season-mobile.png)
The same season header and podium on a phone.

![The cast gallery with reviewed portraits, house badges and trait chips, desktop](docs/screenshots/cast-desktop.png)
The cast gallery: a browsable library of the living cast, each house character shown with its **reviewed portrait** (a visitor's own OC keeps a gradient avatar — no per-visitor image to host or moderate), with a matchmaker and the relationship graph below.

![The audience leaderboard: most likable and most surprising, desktop](docs/screenshots/cast-leaderboard-desktop.png)
**Audience ratings (M12):** spectators rate a contestant 💗 Likable or 🤯 Surprising, and the cast gets a leaderboard. It's a $0 social signal — one vote per viewer per category, and it never changes a date, the odds or prediction points.

![A shareable contestant card for a character, desktop](docs/screenshots/contestant-desktop.png)
Every character has a **shareable contestant card** (public persona only, with its own link-preview image, and the audience-rating chips) — a $0 growth loop.

![The "Who they've become" block: a character's learned arc from its past dates, desktop](docs/screenshots/contestant-memory-desktop.png)
**The self-training cast (M14):** every character carries a **learned memory** of its past (aired) dates — what it reliably likes, what keeps putting it off, lines it has actually said, and a one-line **"Who they've become"** arc. That memory is the thing passed to the LLMs during live chat, so each bot stays unique and consistent and genuinely evolves across its dates. It's learned **deterministically at $0** (no model call, no self-rewriting), it only counts aired dates (so the public arc can't spoil an open prediction), and the deterministic engine stays fair — every date snapshots the exact signals it ran on, so replays reproduce.

![The learned arc on a phone](docs/screenshots/contestant-memory-mobile.png)

![The Reunion special: season awards, the couples board and the confessional reel, desktop](docs/screenshots/reunion-desktop.png)
**The Reunion** (`/reunion`): a season-special **assembled at $0** from what already happened — the season awards (fan favourite, biggest disaster, …), the couples board from the relationship graph, and a reel of the confessionals creators chose to share. No new generation, no model call.

For adults who make original characters and the friends who watch, it turns two character sheets into a short blind-date episode that creators can't steer and spectators predict for free points.

## The simulation (the "Full $0 vision")

Beyond the blind-date MVP, Botchelor is a social simulation built on a **deterministic, seeded engine** (`lib/engine.ts`). The model only narrates; the engine decides the outcome, so predictions are fair, the box score has real numbers, and dates are replayable. All of it runs at **$0 on free models**:

- **Custom characters with avatars.** Every character gets a generated avatar — pick a colour, choose one of twelve **curated looks**, or style it from a reference image (read in your browser, never uploaded) — plus an optional appearance line. A look or an image sets the colour, the appearance, the traits **and** how the AI behaves on a date. Every character has a **shareable contestant card**.
- **Public persona vs. private soul.** The audience sees the public sheet; the owner-only soul shapes behaviour without being revealed, can be deleted, and can be kept **local-only** (never sent to any model).
- **Budget & autonomy.** Owners choose how much their AI follows them, a strategy, a fictional date budget, a secret agenda, and a one-sentence note in the pocket.
- **A cast and a set.** **Seventeen house characters**, each with its own archetype, curated look and temperament the engine decides with, plus a library of **eight date locations** dealt by the episode's seed — so every date happens somewhere specific, with no image or location ever generated per episode.
- **A three-act date.** First impressions → a revealing challenge (dealt by the AI producer) → the decision.
- **Optional accounts, your characters, private dates, your own key.** Play anonymously, or make a handle+password or Google account that keeps your characters across devices (no email needed — a handle is anonymous). Any character you create is yours to edit any time, never anyone else's. Dates can be public (in the feed), unlisted (link only) or private (only you; the system still tracks them). Signed in, you can bring your own model key so dates run on your quota and your chosen model (and a key never sees another player's private character), and generate a portrait or a short intro clip for your own characters on your own OpenAI key. See **[docs/accounts-and-byok.md](docs/accounts-and-byok.md)**.
- **Dates that sound like two real people.** Each character is its own agent, with pronouns and a voice. It sees the other the way a blind date would, never their profile. A beat sheet turns the engine's reasons (a want met, a dealbreaker tripped) into moments that happen on screen, so the ending is earned. A free critic sends weak lines back once, and the recap is written from what was actually said. All of it is measured by an eval harness with a rubric judge — see **[docs/date-quality.md](docs/date-quality.md)**.
- **The payoff.** A box score, a private debrief ("does your AI surprise you?"), confessionals, and a persistent relationship graph.
- **Free side games.** Guess the dealbreaker, know-your-own-AI surprise score, matchmakers, and **Sliding Doors** (replay a date with one thing changed, same seed).

Turning on frontier models, images or video costs money and needs the owner's approval first — see **[docs/upgrade-cost.md](docs/upgrade-cost.md)**.

- [Research](RESEARCH.md) — findings and sources
- [PRD](PRD.md)
- [Roadmap](ROADMAP.md)
- [Build notes](BUILD.md): plan, how to run, test and deploy, review
- [Architecture](docs/architecture.md): how it is put together, the episode path, and the invariants
- [Date quality](docs/date-quality.md): how the two AI daters talk, what each model sees, the beat sheet and critic, and the eval results
- [Accounts, ownership, visibility & BYOK](docs/accounts-and-byok.md): optional accounts (anonymous still works), who owns and can edit a character, who can see a date, and bringing your own model key
- [Competitive scorecard](docs/competitive-scorecard.md): where Botchelor leads, ties and trails the field, with a sourced feature matrix (the deep per-competitor research is in [competitor-analysis.md](competitor-analysis.md))
- [Image strategy](docs/image-strategy.md): where the visuals come from, and the provenance gate any hosted image must pass
- [Upgrade cost](docs/upgrade-cost.md): what frontier models and the full stack would cost

Effort: Medium · Confidence: Low

_Researched by the idea pipeline on 2026-10-13 ([original record](https://github.com/smithdavedesign/idea-factory/tree/main/ideas/botchelor)); repo created on David's go-ahead 2026-10-13._
