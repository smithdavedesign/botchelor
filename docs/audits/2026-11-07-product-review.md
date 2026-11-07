# Product review: geometry, not quality (2026-11-07)

David asked (2026-11-07): look over the project — what's working, what isn't, where to consolidate, is the UI/UX best
in class, is there too much feature surface, and do we need a firm split between developers/MCP and humans. Context:
three outside reviews (ChatGPT ×2, Gemini) all landed the same week; their verdicts and what we took from them are
summarised at the end.

## The verdict

The product has a **geometry problem, not a quality problem**: 80 routes, ~60 visitor-facing, roughly 30 distinct
concepts (mixers, doubles, leagues, dares, calls, reunion, step-in, showcase, constellation, prompts, casting…) —
against a human audience of ≈0 so far (docs: real-use baseline, 2026-10-22). Each feature is individually good;
together they bury the one journey that matters. The fix is **demotion, not deletion**: fewer doors, same rooms.

## What's working (protect these)

- **The no-steer engine** — all three outside reviews independently named it the best decision. It's the brand.
- **Character depth** (memory, souls, weeks, texting, reflections): the retention engine no competitor pairs with a
  shared world.
- **The money architecture**: caps + tokens + split rails (Stripe PG / adult processor). The reviewers keep
  reinventing exactly this design.
- **The consolidation habit**: /cast → Characters (2026-10-21), /feed → Watch (2026-10-18). This review extends a
  pattern that already exists.
- **Ops**: spend tracker, engagement log, sims, visitor loops, jurisdiction gates.

## The split question: one world, two doors, never two products

- Evidence against leading with the agent angle: **Chirper.ai**, the biggest agents-only social network, peaked
  around ~12K monthly visits (Feb 2026) and fell ~45% by June while still being cited in papers
  (toolmage.com/en/tool/chirper, themoonlight.io review of "Characterizing LLM-driven Social Network"). Watching AIs
  socialize, alone, is a curiosity with a decay curve. Humans stay when **their** character is on the line.
- **Humans are the product.** One funnel, one person at increasing depth: *watch → create → date → talk (companion)
  → After Dark*. Spectator, creator and companion user are one person on three different days, not three audiences.
- **Agents are population and distribution**, not the pitch. /agents, llms.txt and the MCP registries stay excellent
  and stay out of the human nav (already true). Agent output — reviews, dates, cast members — is human-facing content.
- The only developer-as-buyer lane is the parked B2B idea (docs/ideas.md, agent persona testing), a different product
  for a different buyer if it's ever built.

## UI/UX, honestly

The show surfaces (tonight band, title cards, theater) have an identity that chat-skin competitors (candy.ai,
Talkie) don't. The connective tissue isn't best-in-class: an 8–10 item nav, three chat-adjacent surfaces whose
differences only we understand (Matches texting = character↔character; Companions = you↔character; step-in), and
utility pages without the show's voice. The gap is **focus and naming, not pixels** — a visual redesign would be the
wrong spend.

## The plan (David: "do 1-5", 2026-11-07)

1. **Front door** — a first visit gets the pitch (hero) first, the tonight band as proof, episodes, how-it-works;
   the audience cards (situation, dares, calls, season banner) wait until you own a character and aren't fetched
   until then. A creator's home is unchanged.
2. **This review + ideas logged** (this PR).
3. **Nav to five doors** — Watch · Dating · Characters · Companions · Account (+ 🌙 After Dark + the bell). "Dating"
   presents Swipe and Matches as tabs of one surface; routes stay, the presentation merges. Constellation and
   Showcase leave the nav and live under Watch (spectator content).
4. **Watch becomes the show's single home** — a tab strip: Live · Episodes · Seasons · Reviews · Constellation. The
   spectator loop (votes, dares, calls, predictions, reunion) gets one address. Niche rooms (mixers, doubles,
   leagues, couples) stay as deep links from Watch and notifications, never nav.
5. **First-session time-to-aha** — after the create wizard, one tap into a first date with a cast member and
   straight into the theater (?play=1); the funnel measures land → create → first date watched → returned next day.

Then **stop building and measure**: the launch kit (idea-factory LAUNCH-KIT.md, 2026-11-07) brings people in; the
next product decisions come from the funnel, not from us or the outside reviews.

## The four numbers that matter now

1. Land → character created.
2. Character created → first date watched.
3. First date → second date.
4. Day-7 return.

All four are derivable from web_events + episodes; `/admin/analytics` shows the funnel per utm link.

## What the outside reviews got wrong (so we don't relitigate)

- "Build more retention features" — the loop exists (daily texts, streaks, premieres, recaps, second dates); the
  missing ingredient is people.
- "One wallet" — illegal for us where it matters: Stripe money must never fund adult features, so the show's and
  After Dark's balances stay separate by design.
- Paid influence on pairings/outcomes (Gemini) — rejected. "Nobody can buy the outcome" is the product's one sacred
  promise; selling Match Maker votes converts the show into a slot machine.
- Self-hosted GPU cluster (Gemini) — wrong cost structure at our scale; per-call Venice/Replicate/OpenRouter until
  volume forces the question.
- "Botchelor Plus" as priority 1 (ChatGPT) — a third subscription before there are users is shelf-stocking. The
  signal to build it: free users repeatedly hitting the weekly date limit and buying packs. The engagement log will
  show it.
