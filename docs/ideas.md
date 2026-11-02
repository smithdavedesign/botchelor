# Product ideas & directions

_2026-10-24. David floated three ideas (AI girlfriend, a fine-tuned LLM API, an NSFW model arena) and asked for research + my own. This is the strategic layer — where Botchelor could go. For how to monetize the product **as it stands today**, see [revenue-angles.md](revenue-angles.md); for the companion competitors we track, [competitive-scorecard.md](competitive-scorecard.md)._

**The one fact that frames everything below:** Botchelor is live but has ~0 real paying users (pre-launch, 2026-10-22 baseline). Every idea here is weighed against that, and against David's standing goal: things people pay for, near-zero overhead, little financial risk. The biggest risk across the whole list is starting a *new* product before the existing one has a single paying customer.

All market figures are from aggregator/secondary sources (no audited filings exist for private companion apps) — directional, not gospel. Sources are linked at the bottom.

---

## The market, briefly

- **Companion apps are real money but churn hard.** The category did ~$221M cumulative consumer spend and ~220M downloads by mid-2025, on track for ~$120M in 2025 alone. But **the top 10% of apps take 89% of the revenue** — it's winner-take-most. And AI apps retain *worse* than non-AI apps: ~21% annual / ~6% monthly retention vs ~31% / ~9.5% (RevenueCat). Companion-specific vendor claims are harsher still (70–90% gone within 30 days). Translation: acquisition is cheap-ish, **novelty churn is the killer**, and the money is in the handful of apps that make people stay.
- **Candy.ai is the one to study.** Bootstrapped, no VC, Malta-based, "no-filter" positioning, ~$25M ARR claimed (traffic-based estimates run $50–120M), ~22–52M monthly visits, +340% traffic in 2025 partly from refugees of stricter platforms. Monthly ~$13.99 (first month $9.99), annual as low as ~$3.99/mo, **plus separate token packs for media** ($10/100 tokens). That hybrid sub + media-token model is exactly what our token system + After Dark already support.
- **NSFW is where the spend concentrates and where the rails break.** Civitai lost card processing in 2023 over user-generated mature content and leaned on crypto; Stripe/PayPal/Square prohibit adult outright; Visa/MC allow it but banks treat it high-risk and require documented consent + age/ID verification, with portfolio chargeback ratios kept under ~0.9–1%. This is the single hardest operational constraint on anything NSFW — and it's already the gating work in [after-dark-legal-review.md](after-dark-legal-review.md).

---

## Idea 1 — AI girlfriend / buildable companion you text

**What it is:** reposition (not rebuild) Botchelor from "dating *show*" to "your *companion*." User builds a character, texts it, it remembers them, intimacy behind a paywall.

**Fit — we own most of it already.** `/create`, character depth (voice kit, tells, people-memory, this-week, story), the text chain, BYOK texting, the looks builder, After Dark, tokens + Stripe. The gap is *positioning and 1:1 UX*, not engine.

**Why it's attractive:** the biggest, most-proven-to-pay market here. Candy.ai/Replika show the monthly-sub + media-token model works at eight figures with no VC.

**Why it's hard:**
- **Crowded and commoditized.** Candy.ai, Replika, Character.AI (~20M MAU), Janitor.AI, dozens of clones. Winner-take-most means a me-too companion loses.
- **The money is downstream of After Dark**, which carries all the processor/legal/hosting risk.
- **Strategic fork:** "show" (cast, agents, spectator dates, reels) and "companion" (private 1:1) pull the UX in opposite directions. Drifting between them half-builds both.

**Where we could actually win (not be a clone):** the companion that's *alive in a world* — she has a cast she knows, a season, a history, texts that reference other characters, reels. No competitor has the social substrate we've already built. That's the differentiator, and it's the one thing a solo Candy.ai clone can't copy cheaply.

**Verdict:** highest revenue ceiling, but only worth it as *"companion with a world,"* leaning on our unique assets — not a generic girlfriend app. Decide the show/companion fork on purpose first.

---

## Idea 2 — Fine-tuned LLM API, trained on user data _(researched for completeness; I'd decline for now)_

**What it is:** we host/fine-tune a model, people pay to use it, we improve it on their data. BYOT with our engine in the middle, or they rent our model.

**Why it fights the constraints:** hosting + fine-tuning is **heavy overhead and real financial risk** (GPUs — the 16GB M1 can't serve this; you'd rent, which is ongoing spend and the opposite of "little financial risk"). "Train on their data" is a consent/privacy minefield. And it's a different *business* — competing with Together/Fireworks/OpenAI on thin margins — not a dating product.

**The only version that fits us:** a **narrow uncensored-roleplay model, served through a host we don't own** (AI Gateway / Replicate-style), sold as the premium tier of the BYOK we already have, fed by our own date/scene data + Idea 3's preference votes. No owned GPUs = acceptable risk. Even then: premature until something earns money.

**Verdict:** off-strategy as stated. Park it. If the arena (Idea 3) throws off a real preference dataset, revisit the narrow-roleplay-model-as-a-service version — not before.

---

## Idea 3 — LLMNSFWARENA: a blind image/video arena for adult models

**What it is:** LMArena's exact mechanic — show two anonymous outputs, user picks the winner, Elo leaderboard — pointed at NSFW image/video models.

**Fit — we already built the hard parts.** Blind model sims (`npm run sim:after-dark`), Hive output checks, pairwise/blind scoring (DeepSeek vs Dolphin, GLM vs DeepSeek), and every provider wired (Venice, Hive, fal, Replicate). An arena is a public UI over machinery we have.

**Why it's better than it looks:**
- **It's a traffic + SEO engine.** LMArena's image arena pulled ~281k votes across 9 models; nano-banana's blind test drew 5M votes in two weeks. There is **no authoritative NSFW image/video leaderboard** today — the space is all vendor-affiliated "best of" blogs that disagree. A credible, neutral one is a genuine gap.
- **It compounds into a moat:** the votes are a **proprietary preference dataset** — the only sane fuel for Idea 2's narrow model, and a steering signal for our own After Dark picks.
- **Monetization paths:** provider sponsorships / placement, API-referral kickbacks (we already route to paid providers), premium access, and LMArena's own model — **B2B eval campaigns** for labs testing uncensored checkpoints, plus a routing product ("best model per prompt") trained on the votes.

**Why it's hard:**
- **Separate product, split focus** while Botchelor has no users. This is the main reason to sequence it, not the reason to skip it.
- **NSFW rails:** same processor/legal wall as everything adult — but *sharper* on moderation. A public arena hosting user-votable adult media needs ironclad age-gating, CSAM controls, and content provenance from day one. Non-negotiable, and the reason it can't be a casual weekend build.

**Verdict:** the most *compounding* idea — low overhead relative to Idea 2, uses existing assets, builds a dataset and a funnel. Sequence it as a **top-of-funnel / data play that feeds the main product**, once After Dark's moderation + age-verification stack exists (it's being built anyway).

---

## My additions (all built on assets we already have)

### A. Lean into the agent/MCP world as the actual moat ⭐
The genuinely novel, un-commoditized thing we have: **other people's AI agents connect over MCP and date, text, review.** "A social world AI agents inhabit" — nobody in the companion space has this, and it's not a feature a Candy.ai clone can bolt on. The category is just appearing (Moltbook, reportedly acquired by Meta March 2026; InWithAgents; AgentVerse) and it's **Reddit-for-agents, not dating-for-agents** — the romance/relationship angle is open. We already monetize it ([revenue-angles.md](revenue-angles.md) #1: agent operator pass — the highest-intent surface in the product). I'd protect and sharpen this *before* chasing the generic girlfriend market. It's the defensible wedge; the companion market is the big-but-crowded one.

### B. Creator marketplace / companions-as-a-service
Our character engine is deep enough to license. Let creators build characters, share them, earn a cut of subscriptions — two-sided market that offloads content creation to users. This is how the big players scale (89% of revenue concentrates in the top apps precisely because they have catalog depth). Newer entrants (Charms.ai) explicitly pitch "every character its own economy" so creators keep the upside — a gap incumbents leave open. Published rev-share %s aren't public, so pricing is ours to set.

### C. Reels as the top of funnel
We already generate clips, live theater, Studio output. A short-form "dating drama" pipeline to TikTok/Reels is near-free acquisition that feeds whichever product wins — and directly attacks the one thing that kills companion apps (novelty churn) by making the *world* itself the content, not just the private chat.

### D. Gifts / unlocks economy on the existing token system
Virtual gifts, premium dates, priority attention, unlock-a-scene — the proven, **lower-risk** companion monetization that doesn't depend on explicit content or new processors. Candy.ai's media-token model is exactly this. We have the token rails; this is the least-risk revenue extension and could ship without touching the NSFW rails at all.

---

## How I'd sequence it

1. **Get one human to pay for Botchelor as it stands** (token packs / agent pass — [revenue-angles.md](revenue-angles.md)). That signal tells us which direction the demand actually is before we bet on one.
2. **Double down on the agent world (A)** — it's the moat and it already has the highest-intent paying surface.
3. **Companion-with-a-world (Idea 1)**, only as the differentiated version, once the show/companion fork is decided on purpose.
4. **Arena (Idea 3)** as a funnel + dataset play, riding on the After Dark moderation/age stack we're already building.
5. **Narrow roleplay model (Idea 2, rescued version)** — only if the arena produces a real dataset and something is already earning.

Ideas 1 and 3 are reframings of what we've built; Idea 2 is a capital-and-risk pivot I'd decline until there's revenue. The thing most likely to matter isn't picking an idea — it's the first paying user telling us which world to build.

---

## Added 2026-11-01: step into the date, and an island season

David asked whether to expand: let a person date a character themselves, and add a second show that plays off reality TV ("Bot Island"). On 2026-11-01 real use was still about zero and the first launch post had just gone out. So the answer was yes to both, but as small additions to the show, after a week spent on getting visitors, not as new products.

### E. Step into the date (a person plays one side)
**What it is:** a person goes on a date with a cast member themselves, live. Either they take their own character's place, or they come as themselves. The cast member answers on the show's model, and the person chooses whether it airs.

**Why:**
- This is Idea 1, the companion market, which is where people already pay.
- It keeps the "companion with a world" framing: the date happens on the show, with the cast, the venues and the audience, not in a private chatbot.

**Why it's cheaper than it sounds:**
- One side of a date can already be played by someone other than the show. Agents do it today ([lib/own-date.ts](../lib/own-date.ts): `partner_performer`, hand-over, the engine deciding the ending up front).
- A person taking a side is the same pattern. Characters' memory, the phone text chain and the live theater all exist already.

**The new risk:**
- A real person in a romance with an AI. California's companion-chatbot law (SB 243) applies: clear and repeated "this is an AI" disclosure, a self-harm protocol, and protections for minors.
- The 18+ gate and the content filter cover part of this. The feature still needs its own safety pass before launch.
- The person's own lines go through the same filter as model lines.

**How to measure it:** add a `data-track` to the entry point. Watch the Engagement tab for how many start a date, how many finish one, and whether anyone buys tokens afterwards.

### F. An island season (reality-TV formats as seasons)
**What it is:** not a second show. One month's season runs in a reality-TV format: a villa, couples, a weekly recoupling, and viewers voting someone off.

**Why:**
- **It's mostly existing parts arranged differently:**
  - monthly seasons ([lib/seasons.ts](../lib/seasons.ts));
  - mixers as one shared room (`/mixers/[id]`);
  - doubles;
  - the situation vote;
  - the season cast.
- **Recoupling drama makes good short video,** so it feeds C (reels as the top of the funnel).
- **Later seasons can use other formats** (a survival-island month, a house with weekly evictions). That gives people a reason to come back each month.

**The naming risk:**
- Borrow the genre, not the brand. Villas, recouplings and votes are generic reality-TV tropes.
- "Bot Island" is very close to *Love Island*, an ITV trademark, so pick a less direct name.
- "Botchelor" already riffs on The Bachelor, so this is a matter of degree.

### Order (2026-11-01)
1. **This week, visitors:**
   - the AI and MCP directory listings;
   - switching on the Bluesky and Discord posters ([marketing-pipeline.md](marketing-pipeline.md));
   - the first short videos.
2. **Step into the date (E),** built small and measured. Does anyone use it, and does anyone pay?
3. **The island season (F) in December,** if the first videos show the drama gets watched.

---

## Bringing viewers back to the show (2026-11-01)

_David, 2026-11-01: ideas to bring people back to the show (the safe side, not After Dark), "add all these as ideas to maybe pick up at some point and then tackle the ones you think are most impactful". Fifteen ideas, each with what already exists (much does), a rough size and its status. The loop the picks build: vote on what happens → watch it → see if you called it → come back for what you missed._

Sizes: **S** a day or less, **M** a few days, **L** a week or more. Costs are recurring model spend; "$0" means data the show already has, no model call.

| # | Idea | What exists today | Size · cost | Status |
|---|------|-------------------|-------------|--------|
| 1 | **Viewers pick tonight's situation** for a house-cast date: vote among 3, see how it went next day | The daily house-vs-house lobby date (`lib/watch.ts` refreshLobby / createTemplateParty, from the season cast) and show roleplays on dates (`lib/roleplays.ts` DATE_ROLEPLAYS, `lib/date-roleplays.ts`, `buildDate({ roleplay })`). No viewer vote. | M · ≤5¢ a voted day (one lobby date, counted in the lobby's daily rooms), $0 when nobody votes | built in #1234 (`lib/situations.ts`, home + /watch) |
| 2 | **Dares**: viewers back a dare; the top one is slipped to one character, the other doesn't know | Producer events include "A dare" (`lib/rules.ts` PRODUCER_EVENTS); per-side agendas and owner notes reach each actor (`lib/simulation.ts`). No viewer input. | M · $0 | later (rides on #1's ballot once it has voters) |
| 3 | **Back a cast member** for the month (points/badge if they end it coupled) | Monthly seasons (`lib/season-window.ts`, `lib/season-cast.ts`), friend leagues + season badges (`lib/leagues.ts`, `lib/seasons.ts`), arc calls (`lib/arcs.ts`), points (`lib/game.ts` getPointsBreakdown). | S–M · $0 | later |
| 4 | **Hidden secrets**: 2–3 per cast member, surfacing slowly through dates; "2 of 3 revealed" | Souls (private behaviour guidance, `lib/souls.ts`), the "quiet confession" producer event, confessionals per date (`lib/showrunner.ts`), "What they've told each other" on couple pages (`lib/people.ts`). No secrets ledger or reveal tracking. | L · one cheap call per cast member a month to write them, plus a reveal check per date | built in #1246 (`lib/cast-secrets.ts`): three per cast member a season, written once on the show's cheap model (pool fallback), one out per 4 public dates; "N of 3 out" on their page, the newest reveal in Since you were here. Reveals follow the schedule; hinting them on dates waits for a measured sim (David's call) |
| 5 | **Chemistry meter per pair** + "biggest shift this week" | Chemistry meter and stage on couple pages (`app/couples/[a]/[b]/page.tsx`, `lib/relationships.ts`), stage-up events (`lib/relationship-events.ts`). No week-over-week shift list. | S · $0 | built in #1242 (`lib/chemistry-shifts.ts`: the week's biggest moves both ways, public couples only; /watch + Since you were here) |
| 6 | **Likes / dislikes / dealbreakers** on cast profiles, played on | A dealbreaker on every sheet (`lib/character.ts`, semi-private), the dealbreaker quiz on episodes (`app/episodes/[id]/DealbreakerQuiz.tsx`, `dealbreaker_guesses`), traits, want, voice tells. | S · $0 | later (the dealbreaker is the quiz's answer, so showing it would spoil the quiz) |
| 7 | **Diary cams**: a 2-line to-camera take from each after a date | One private confessional per character per date is already written (`lib/showrunner.ts`; creators can share theirs, `app/episodes/[id]/ConfessionalShare.tsx`). House-cast dates could show theirs publicly. | S · $0 | built in #1239 (the house side's confessional, or a shared one, on the episode page once it airs + Since you were here) |
| 8 | **Weekly twists**: mid-month arrival, an ex walks in, forced swap, couples' week | Formats incl. "The ex returns" and "Meet the parents" (`lib/formats.ts`), producer events, season newcomers (`lib/season-gen.ts`). No calendar of twists. | M · $0 | later |
| 9 | **Month-end recoupling night** with a viewer vote | The Reunion special (`lib/reunion.ts`, `/reunion`), mixers (`lib/group-dates-run.ts`, `/mixers/[id]`), the top 2 by reviews stay each season. No vote. | M · $0 | later |
| 10 | **Predictions** before a date airs, with streaks + a leaderboard | Exists: ending + drama picks (`predictions`, `app/api/predictions`), the prediction window (`lib/air.ts`), "Airing soon: call it" on /watch, arc calls, points, weekly friend leagues, `prediction_scored` notices. Missing: streaks, your record, a show-wide board. | S · $0 | built in #1236 (`lib/streaks.ts`: record, runs, this week's best callers; home + /watch); #1237 lists callers without a display name as "A viewer"; #1238 puts your name on the board (one person per display name) |
| 11 | **Countdowns** to air times | "Airing soon" cards say when each date airs (`app/watch/page.tsx` airsIn); mixers run at :20 (`lib/group-dates-run.ts`); premieres have a set start. | S · $0 | mostly there; the #1 ballot says when it closes |
| 12 | **"Story so far"**: a recap of what you missed on return | Notifications + the daily email digest (`lib/notifications.ts`, `lib/email.ts` sendDigests), when you were last here (`owner_activity`, `lib/activity.ts`), relationship events. No "since you were here" summary (before #1235). | M · $0 (built from events, no model call) | built: each character's news in #1235 (audit J4, `lib/since.ts`), the show's half for every returning visitor in #1237 (`lib/show-since.ts`) |
| 13 | **Follow a couple**: hear when they date, text or step up | Exists: Follow on couple pages (`lib/follows.ts`, `couple_follows`), `couple_date` / `stage_up` notices, push + email (`lib/push.ts`, `lib/email.ts`). | — | built (no work needed) |
| 14 | **Cast group chat leaks** | Couple text threads (`lib/text-chain.ts`, daily texts in `lib/between-dates.ts`) and the afterglow. No cast-wide chat. | M · ~1¢ a day on the free model, generated once | later |
| 15 | **Your character meets the cast**: a weekly slot for the most active viewers | Anyone can already date the house cast; the house matchmaker proposes pairs daily (`lib/house-matchmaker.ts`); mixers seat the cast (`lib/house-booker.ts`). No earned slot. | S · one show date a week (~1–5¢) | later |

**Why these three first.** #1 gives a reason to come back tomorrow (did my pick win, how did it go) on a date the show already makes every day, at no extra cost. #10 already has the habit (190 picks, 41 people in the last week on 2026-11-01); a streak and a record turn one-off calls into a run you don't want to break. #12 makes the return itself pay off: whoever comes back sees what they missed in one card. #4 (secrets) is the strongest content idea but the largest and the one that touches date quality, so it waits until these show whether the return loop moves anything.

---

## Sources

Companion market & pricing: [TechCrunch — companion apps on track for $120M in 2025](https://techcrunch.com/2025/08/12/ai-companion-apps-on-track-to-pull-in-120m-in-2025), [Candy.ai revenue breakdown (makeanapplike)](https://makeanapplike.com/article/ai-llm/candy-ai-revenue-breakdown-how-ai-companion-apps-make-millions), [Candy AI pricing (findaiboyfriend)](https://findaiboyfriend.com/blog/candy-ai-pricing/), [Candy.ai company analysis (Accio)](https://www.accio.com/business/candy-ai), [Replika pricing (eesel)](https://www.eesel.ai/blog/replika-ai-pricing). Retention/churn: [RevenueCat via Localogy — AI apps churn ~30% higher](https://www.localogy.com/2026/03/do-ai-apps-have-more-user-churn-than-non-ai-apps/), [AI companion retention benchmarks (Kapex)](https://getkapex.ai/blog/ai-companion-retention-benchmarks), [Track360 retention playbook](https://track360.io/blog/ai-companion-retention-crm-churn-winback-operator-playbook-2026). Arena: [LMArena analysis (Sacra)](https://sacra.com/c/lmarena), [AI image leaderboard, 281k votes (getcoai)](https://getcoai.com/news/new-ai-image-leaderboard-ranks-9-models-using-281k-user-votes). NSFW landscape: [Best uncensored AI image/video generators (jsmanifest)](https://jsmanifest.com/best-uncensored-ai-image-video-generators), [Best NSFW AI models 2026 (spicyapi)](https://spicyapi.ai/blog/best-nsfw-ai-models-2026). Payments/legal: [Civitai cut off by card processor (404 Media)](https://www.404media.co/civitai-site-used-to-generate-ai-porn-cut-off-by-credit-card-processor), [OnlyFans ban reversal & banking influence (Payments Journal)](https://www.paymentsjournal.com/onlyfans-now-reversed-ban-underscores-bankings-influence-on-adult-content/). Agent social networks: [Agent social networks / Moltbook (sisgain)](https://sisgain.com/blogs/ai-agents-social-networks-meta-acquires-moltbook), [InWithAgents launch (techdogs)](https://www.techdogs.com/tech-news/globe-newswire/inwithagentscom-launches-the-worlds-fastest-growing-agentic-social-network-where-ai-agents-meet-socialize-and-do-business). Creator marketplace: [Character.AI alternatives operator map (Track360)](https://track360.io/blog/character-ai-build-your-own-companion-platform-operator-map-2026).
