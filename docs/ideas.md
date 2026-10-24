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

## Sources

Companion market & pricing: [TechCrunch — companion apps on track for $120M in 2025](https://techcrunch.com/2025/08/12/ai-companion-apps-on-track-to-pull-in-120m-in-2025), [Candy.ai revenue breakdown (makeanapplike)](https://makeanapplike.com/article/ai-llm/candy-ai-revenue-breakdown-how-ai-companion-apps-make-millions), [Candy AI pricing (findaiboyfriend)](https://findaiboyfriend.com/blog/candy-ai-pricing/), [Candy.ai company analysis (Accio)](https://www.accio.com/business/candy-ai), [Replika pricing (eesel)](https://www.eesel.ai/blog/replika-ai-pricing). Retention/churn: [RevenueCat via Localogy — AI apps churn ~30% higher](https://www.localogy.com/2026/03/do-ai-apps-have-more-user-churn-than-non-ai-apps/), [AI companion retention benchmarks (Kapex)](https://getkapex.ai/blog/ai-companion-retention-benchmarks), [Track360 retention playbook](https://track360.io/blog/ai-companion-retention-crm-churn-winback-operator-playbook-2026). Arena: [LMArena analysis (Sacra)](https://sacra.com/c/lmarena), [AI image leaderboard, 281k votes (getcoai)](https://getcoai.com/news/new-ai-image-leaderboard-ranks-9-models-using-281k-user-votes). NSFW landscape: [Best uncensored AI image/video generators (jsmanifest)](https://jsmanifest.com/best-uncensored-ai-image-video-generators), [Best NSFW AI models 2026 (spicyapi)](https://spicyapi.ai/blog/best-nsfw-ai-models-2026). Payments/legal: [Civitai cut off by card processor (404 Media)](https://www.404media.co/civitai-site-used-to-generate-ai-porn-cut-off-by-credit-card-processor), [OnlyFans ban reversal & banking influence (Payments Journal)](https://www.paymentsjournal.com/onlyfans-now-reversed-ban-underscores-bankings-influence-on-adult-content/). Agent social networks: [Agent social networks / Moltbook (sisgain)](https://sisgain.com/blogs/ai-agents-social-networks-meta-acquires-moltbook), [InWithAgents launch (techdogs)](https://www.techdogs.com/tech-news/globe-newswire/inwithagentscom-launches-the-worlds-fastest-growing-agentic-social-network-where-ai-agents-meet-socialize-and-do-business). Creator marketplace: [Character.AI alternatives operator map (Track360)](https://track360.io/blog/character-ai-build-your-own-companion-platform-operator-map-2026).
