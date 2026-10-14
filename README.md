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

Captured by `npm run screenshots` from the production build, with invented sample characters and players. A local stand-in plays the free model, so no API key is involved. The same run also buys "5 more dates" through the shop's Buy button: the sample Payment Link carries the order, a signed webhook arrives, and the shop shows the 5 dates. That check passes but saves no picture.

![Landing page for AI roleplayers, desktop](docs/screenshots/home-desktop.png)
The start page explains the show, the free prediction game and weekly seasons: 3 free dates a week, and the first date is always free.

![Landing page on a phone](docs/screenshots/home-mobile.png)
The same start page on an iPhone 13 screen.

![The character builder with the private-soul section open, desktop](docs/screenshots/builder-desktop.png)
The builder: the public character sheet, plus an optional **private soul** (values, humour, communication style) that shapes how the AI behaves on the date without ever being shown to the audience.

![The date settings: autonomy, strategy, budget, agenda, a note, desktop](docs/screenshots/date-settings-desktop.png)
Before a date, the owner sets **autonomy** (how closely the AI follows them), a **strategy**, a fictional **date budget**, a **secret agenda**, and slips in **a note in the pocket**. None of it can be bought.

![An episode written for a character created through the form, desktop](docs/screenshots/episode-desktop.png)
The core action, driven through the UI: a new character is created, sent on a date with a house character, and lands on the AI-labeled episode its creator can read.

![The date told as three acts, desktop](docs/screenshots/episode-acts-desktop.png)
Every date is a **three-act story** — first impressions, a revealing challenge (dealt by the AI producer), and the decision — with the engine deciding the outcome and the model narrating to it.

![The box score, secret agendas and confessionals on an aired episode, desktop](docs/screenshots/episode-boxscore-desktop.png)
The outcome is decided by a **deterministic engine**, not the model: the **box score** shows how chemistry, attraction, trust and awkwardness moved, with the best line, the revealed **secret agendas**, and the **confessionals**.

![The same kind of episode on a phone](docs/screenshots/episode-mobile.png)
The episode page on a phone, with the AI disclosure and crisis links first.

![The box score on a phone](docs/screenshots/episode-boxscore-mobile.png)
The box score on an iPhone 13 screen.

![A friends' league with last season's podium and this week's board, desktop](docs/screenshots/league-season-desktop.png)
Seasons (M4): the first visit after Monday 00:00 UTC closed last week's season, so the top 3 got badges (a tie shares 2nd). This week's board counts only this week's finales.

![The league's season and podium on a phone](docs/screenshots/league-season-mobile.png)
The same season header and podium on a phone.

![The cast gallery with avatars, house badges and trait chips, desktop](docs/screenshots/cast-desktop.png)
The cast gallery: a browsable, avatar-rich library of the living cast, with a matchmaker and the relationship graph below.

![A shareable contestant card for a character, desktop](docs/screenshots/contestant-desktop.png)
Every character has a **shareable contestant card** (public persona only, with its own link-preview image) — a $0 growth loop.

For adults who make original characters and the friends who watch, it turns two character sheets into a short blind-date episode that creators can't steer and spectators predict for free points.

## The simulation (the "Full $0 vision")

Beyond the blind-date MVP, Botchelor is a social simulation built on a **deterministic, seeded engine** (`lib/engine.ts`). The model only narrates; the engine decides the outcome, so predictions are fair, the box score has real numbers, and dates are replayable. All of it runs at **$0 on free models**:

- **Custom characters with avatars.** Every character gets a generated avatar — pick a colour, or style it from a reference image (read in your browser, never uploaded) — plus an optional appearance line. Every character has a **shareable contestant card**.
- **Public persona vs. private soul.** The audience sees the public sheet; the owner-only soul shapes behaviour without being revealed, can be deleted, and can be kept **local-only** (never sent to any model).
- **Budget & autonomy.** Owners choose how much their AI follows them, a strategy, a fictional date budget, a secret agenda, and a one-sentence note in the pocket.
- **A three-act date.** First impressions → a revealing challenge (dealt by the AI producer) → the decision.
- **The payoff.** A box score, a private debrief ("does your AI surprise you?"), confessionals, and a persistent relationship graph.
- **Free side games.** Guess the dealbreaker, know-your-own-AI surprise score, matchmakers, and **Sliding Doors** (replay a date with one thing changed, same seed).

Turning on frontier models, images or video costs money and needs the owner's approval first — see **[docs/upgrade-cost.md](docs/upgrade-cost.md)**.

- [Research](RESEARCH.md) — findings and sources
- [PRD](PRD.md)
- [Roadmap](ROADMAP.md)
- [Build notes](BUILD.md): plan, how to run, test and deploy, review
- [Competitive analysis](docs/competitive-analysis.md): what rivals do, where we win, and the feature roadmap
- [Upgrade cost](docs/upgrade-cost.md): what frontier models and the full stack would cost

Effort: Medium · Confidence: Low

_Researched by the idea pipeline on 2026-10-13 ([original record](https://github.com/smithdavedesign/idea-factory/tree/main/ideas/botchelor)); repo created on David's go-ahead 2026-10-13._
