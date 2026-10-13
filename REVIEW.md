# Review: Botchelor — PASS, score 4/10

**Verdict: pass (4/10).** A fun, weekend-buildable idea with no demand evidence, an unproven payment story, heavy moderation and legal exposure, and a narrow, awkward audience.

## Forcing questions
- **Q1 Demand Reality — 2/10.** Nobody has asked for it. The evidence is adjacent: Character.AI is large (~20M MAU, from affiliate blogs) and Love Island's prediction game drew 25%+ of mobile viewers (RESEARCH.md). Neither shows demand for fan-made, watch-only AI dates. RESEARCH.md rates confidence Low and found no community-size data. This is assumed interest. Stronger evidence: 20+ OC owners submitting characters to a hand-run season, or anyone paying $3+ before the app exists.
- **Q2 Status Quo — 4/10.** Shippers already do this free in Discord/Reddit or Character.AI group chats. The habit is real, but the product removes steering, which many like, and the workaround costs an evening, not a loss.
- **Q3 Desperate Specificity — 3/10.** "Adults who make OCs and follow relationship drama" is a category. No name, community or size. Art-first OC communities reject AI (r/OriginalCharacter, itch.io thread), leaving a pro-AI crowd that RESEARCH.md says may skew young or NSFW.
- **Q4 Narrowest Wedge — 5/10.** M1 is a weekend build, but the loop needs spectators and a second creator, so M1 can't show its value. The honest wedge is a hand-run season.
- **Q5 Observation (no product yet).** Watch M1 users: do they finish the episode or immediately edit and rerun (wanting to steer)? Share the link unprompted? Predict before the reveal? Return next day?
- **Q6 Future-Fit — 4/10.** AI fiction is commoditising; Character.AI could add an episode mode. Regulation (SB 243, FTC 6(b), age gating) is tightening on exactly this space. The shareable prediction habit is the only durable piece, and unproven.

## Premises
1. Creators want to watch, not steer — unsupported.
2. A free prediction game brings spectators back — partly supported (Love Island has a real cast and TV audience).
3. People pay $3–$10 for characters, packs or cosmetics — unsupported; all price evidence is chat subscriptions.
4. A watch-only show avoids companion-chatbot and gambling law — unsettled; needs counsel.
5. Free models keep episodes funny and varied weekly — untested.

## Alternatives
- **Minimal:** single-player "date my OC" page with a shareable card; no accounts, predictions or payments. S effort, low risk, tests novelty only.
- **Ideal:** the full PRD platform. L effort, high risk; needs community, moderation and legal work first.
- **Lateral (recommended):** hand-run season of 20–50 OCs in an existing pro-AI roleplay Discord, predictions by reaction, no app.
- **Extend an existing repo:** pettycourt already has AI-judged story, friend voting and a shareable card; a dating-episode mode reuses it.

## Narrowest wedge
One hand-run season in an existing community: 20 OCs paired by David, one prompt per episode, followers predict via reactions. Build only if requests for more episodes show up unprompted.

## M1 feasibility
- Weekend, one person: yes (Next.js, Neon/Turso free, free model via LiteLLM, Zod).
- Zero cost: yes for M1; M3 payments need a commercial-use host (not Vercel Hobby).
- The one test: `POST /episodes` with two valid characters returns a schema-valid episode (setting, two goals, twist, ending in the enum, at most 450 words), and returns 502 with nothing stored after two invalid model outputs.
- The weekend estimate hides the real work: the character filter and moderation.

## Risks
- Moderation load (minors, NSFW, real people) vs near-zero owner time.
- California SB 243: $1,000-per-violation private right of action; scope for a watch-only show unsettled.
- Contest/gambling rules for free points plus paid cosmetics.
- Cold start: predictions need many spectators per episode.
- OC-artist hostility to AI; narrow reachable audience.
- Free-model episodes may turn repetitive.
- No payment evidence for the game half.

## Kill criteria
Drop it if a hand-run season gets fewer than 20 OC submissions, fewer than 25% of spectators predict a second episode, nobody asks for the next episode unprompted, counsel says SB 243 applies with obligations that cost money, or moderation needs over an hour a week.

## Fit with David
His interests (design, frontend, AI tools, job search) show no roleplay or OC audience, so he has no community to seed a test. Closest overlap is pettycourt.
