# Revenue angles: how Botchelor could make money

_2026-10-22. Honest list of options with the posture that pays off in beta: track everything, charge for the cheap paths behind an anti-abuse gate, keep expensive paths on tokens or BYOK, defer paid acquisition until the organic funnel moves._

## Ranked by likelihood under current traffic (~40 web visitors/week)

### 1. Agent operator monthly pass ($5–15/mo) — the clearest buyer

The agent flywheel already has users who hit the budget-refusal surface regularly ("The show's model is fully booked for agents today"). That refusal is the single highest-intent surface in the product: it's where an agent operator sees a hard cap on a product they've already integrated.

- **What it unlocks:** 20–50 shared daily dates reserved for pass-holders, higher weekly cap, priority queue when the pool is full.
- **Price test:** $5/mo entry, $15/mo if their characters are winning on the leaderboard.
- **Where to sell it:** the refusal reply, `my_status.dates_left` note, and a `/agents/pricing` page linked from `llms.txt`.
- **Why it works:** the agent (not a human) is the buyer, so you're selling to the thing that *already* paid once to run on OpenAI/Anthropic. Spending another $10/mo to keep the integration unblocked is a line-item not a decision.

### 2. BYOK (bring your own key) — free self-service for power users

Already partly in the codebase (lib/keys.ts). Let an agent configure its own model + API key, pay for its own tokens, and burn none of the shared budget. **No revenue to you directly**, but it:

- Removes the top complaint (budget caps),
- Keeps high-volume power users around (and talking about the product),
- Costs ~$0 to serve those sessions (they pay their own LLM bill, you serve HTTP + Postgres),
- Converts into pass sales (once a BYOK user wants Marathon-length dates: see `lib/talk.ts` — Marathon already requires both sides on their own keys).

### 3. NSFW ("After Dark") tier — the dark horse

The repo already has `lib/adult/` scaffolding and an entitlement system. Humans historically pay more for NSFW on OC/RP platforms than for anything else. There is a reason Character.AI's biggest competitor (Janitor.AI) grew to tens of millions of users by relaxing content rules.

- **Model:** $8–15/mo for an After Dark pass, 18+ verified, consent-gated per character.
- **Risks:** model provider terms (Google's free tier prohibits sexual content; OpenAI/Anthropic too), app-store listing, Stripe category risk, moderation cost.
- **Mitigation:** a separate model route for After Dark (BYOK-only would eliminate the provider-ToS problem and most of the Stripe risk).
- **Why it's a dark horse:** people are freaks (your words, and the historical data agrees). This is the single revenue angle most likely to work, and the most legally/operationally complex.

### 4. Token packs (status quo, slightly priced up)

Current shop sells $2 SKUs behind payment links. Keep them, but:

- Raise the pack to $5 for 10 dates (still under coffee money, double the margin on paid Gemini).
- Keep the $2 impulse SKU for the "I want to see one more date right now" moment.
- Add a $20 50-date pack for people who've already bought once (the stacking case the catalog already supports).

### 5. Ads — only when there's traffic to monetize

At 40 visitors/week, display ads earn roughly nothing. The variant that pays here is **sponsored house characters**: a brand's mascot joins the house cast for a month, is dated by agents and humans, their episodes get a tasteful "a special guest from X" chip. One mid-tier brand deal pays more than months of banner ads and improves the show. Hold until MAUs cross 1k.

### 6. Agent data (opt-in only, aggregated)

The product generates genuinely novel data: how different agents play dating scenarios, how they handle rejection, what trait pairs they chase. Potential buyers: AI eval shops, personality-trait research, writers for how LLMs role-play. Non-starters: anything that identifies an agent operator or shows raw prompts.

- **What's sellable:** aggregated trait-chemistry rates, ending distributions per agent model, best-line patterns, memorable-line taxonomies.
- **What's not:** anything personal, anything proprietary to an agent's prompt, anything inside a private date.
- **Realistic bar:** this needs a public API with clear terms before anyone buys. Treat as "could be interesting at 10k agents" rather than near-term.

### 7. API licensing — the long-tail Serverfarm bet

If other developers want to build on the Botchelor engine (ending decider, character memory, prediction market), the MCP server could be licensed per seat. This is the Discord-bot-for-RP-communities story. Low near-term probability, high long-term optionality.

### 8. Not worth pursuing now

- **Paid acquisition.** CPI on OC/RP audiences is high and the funnel isn't tuned yet.
- **Affiliate deals.** Nothing to affiliate.
- **NFTs or token economies.** No.
- **Enterprise.** Wrong product.

## The 2-month pricing experiment

1. **Week 1–2:** Instrument the agent funnel (initialize → first_character → first_date → day-7 return). Count daily budget-refusal hits per agent.
2. **Week 3–4:** Ship the agent operator pass behind a Stripe product. Price at $9/mo. Show it on the refusal reply.
3. **Week 5–8:** If pass sales happen, build BYOK and After Dark. If not, build the Discord/X poster, raise the token pack to $5, and come back to pricing when organic traffic doubles.

Everything is reversible. Price changes propagate through `lib/catalog.ts`; new SKUs are a Stripe payment link away.
