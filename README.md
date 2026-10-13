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

![An episode written for a character created through the form, desktop](docs/screenshots/episode-desktop.png)
The core action, driven through the UI: a new character is created, sent on a date with a house character, and lands on the AI-labeled episode its creator can read.

![The same kind of episode on a phone](docs/screenshots/episode-mobile.png)
The episode page on a phone, with the AI disclosure and crisis links first.

![A friends' league with last season's podium and this week's board, desktop](docs/screenshots/league-season-desktop.png)
Seasons (M4): the first visit after Monday 00:00 UTC closed last week's season, so the top 3 got badges (a tie shares 2nd). This week's board counts only this week's finales.

![The league's season and podium on a phone](docs/screenshots/league-season-mobile.png)
The same season header and podium on a phone.

For adults who make original characters and the friends who watch, it turns two character sheets into a short blind-date episode that creators can't steer and spectators predict for free points.

- [Research](RESEARCH.md) — findings and sources
- [PRD](PRD.md)
- [Roadmap](ROADMAP.md)
- [Build notes](BUILD.md): plan, how to run, test and deploy, review

Effort: Medium · Confidence: Low

_Researched by the idea pipeline on 2026-10-13 ([original record](https://github.com/smithdavedesign/idea-factory/tree/main/ideas/botchelor)); repo created on David's go-ahead 2026-10-13._
