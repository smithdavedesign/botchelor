# Botchelor: path to the first dollar

**Bottom line:** the evidence that anyone will pay for this is weak. The review scored demand 2/10 and the research rates its own confidence Low. I'd still test it, cheaply: a hand-run mini-season, then a $4 pack. If nobody pays within 3 weeks, stop.

## Forcing questions, applied to money

**Who pays?** An adult who has written an original character and already roleplays it with AI. Concretely, they're a regular on r/CharacterAI or r/SillyTavernAI, or in an AI-character Discord such as Shapes Inc. I can't name a person, and I found no community-size numbers. That is the main gap, and it fails the "name the human" test. Spectators (friends, Love Island fans) are the free audience and aren't expected to pay.

**What do they pay today?** Chat subscriptions only:
- Character.AI c.ai+ is $9.99/mo. The annual plan is listed at $79.99 to $94.99, depending on the tracker ([recurdash](https://recurdash.com/subscription-pricing/character-ai), [Sacra](https://sacra.com/c/character-ai/)).
- Chai is listed at $13.99/mo, or $134.99/yr, from a single March 2026 source ([aicompanionguides](https://aicompanionguides.com/blog/ai-companion-pricing-guide-2026/)).
- I found no confirmed Talkie price. Third-party aggregators disagree with each other, so treat all of these as approximate.

Nothing shows anyone paying for a watched episode or a prediction-game cosmetic. Love Island's prediction game is free. Shippers already do this free in Discord and Reddit, and the workaround costs them an evening, not money.

**Narrowest version worth paying for:** the full platform isn't it. Today the loop can't show its value, because it needs spectators and a second creator. The narrowest paid thing is "your OC goes on a date and you get the episode". That means one creator, one house character and one shareable episode. After a free first date, I'd sell 5 more dates for **$4 once**.

## Price
$4 once. It is below the $9.99/mo anchor. It is also small enough to be an impulse buy, but not so small that Stripe fees (about 30¢ + 2.9%) eat it. I'm not recommending a subscription: there is no recurring value yet and no evidence for one. Revisit the price only after real sales. The built M3 SKUs are $3–8, so $4 fits inside that range.

## Shortest path
1. **Agent, now:**
   - Add the privacy and terms pages, sitemap, robots.txt and og:image.
   - Confirm the live flow at https://botchelor.vercel.app works for a stranger.
   - Add the free first date and a "5 more dates, $4" button.
2. **David (about 15 minutes):** create a Stripe payment link for $4 and map it in RepoHQ. Keep fulfilment manual: the buyer enters an email and David adds 5 credits. Don't build the webhook before 5 or more sales.
3. **David:** post the hand-run mini-season (see "First ten users" below).
4. **Observe:** do creators edit and rerun, wanting to steer? Do they share unprompted? Do spectators predict before the reveal and come back?
5. **Offer the $4 pack** to every creator whose episode got a reaction.

## First ten users
The review's own recommendation was a hand-run season, and I agree. Post in r/CharacterAI, r/SillyTavernAI and the Shapes Inc Discord: *"Send me your 18+ OC and I'll put it on a blind date. Episode in 3 days; guess the ending first."* Read each community's self-promo rules first and ask the mods in Discord. Take 10 to 20 submissions, post each episode with a prediction poll, then send each creator their episode link and the $4 offer. Ask every creator to forward their episode to one friend; this tests the spectator loop.

David has no OC community of his own (per the review), so this is cold outreach and may be slow or get removed. Plan for that.

## Must-haves before charging
- Checkout.
- Privacy and terms pages. Both are missing today, and launch checks are at 4/9.
- 18+ gate, AI disclosure, crisis link and report button (M2).
- A decision on SB 243. The best case is that counsel says a watch-only show is out of scope. Without paid counsel, ship the disclosure and crisis link and restrict to US adults.
- Paid items must never change points or rank (this keeps gambling and contest exposure low).
- A refund path in the terms.
- A commercial-use host once the webhook exists; Vercel Hobby isn't allowed for that.

## Risks and what I'm unsure of
- **Demand is assumed.** Premise 1 (creators want to watch, not steer) and premise 3 (they'll pay) are both unsupported.
- **Pro-AI OC audience is narrow** and may skew young or NSFW. Moderation against an hour a week is a real tension.
- **Legal:** SB 243 scope is unsettled. A $1,000-per-violation private right of action is expensive if it applies.
- **M4 is unfinished** (the builder stopped), so packs can't be self-serve yet. Hence manual fulfilment.
- **The community and Reddit URLs are plausible, not verified.** The search returned bot listings and no communities with counts. Check that each community exists and allows posts before relying on it.

## Kill criteria
After 3 weeks of the mini-season, stop if any of these hold:
- fewer than 20 OC submissions;
- under 25% of spectators predicting a second episode;
- nobody asking for the next episode unprompted;
- fewer than 1 in 20 offered creators buying the $4 pack (at least 20 offered);
- counsel saying SB 243 applies with costly obligations;
- moderation taking over an hour a week.

**Next action for David:** make the $4 Stripe payment link and post the mini-season in the three places above.
