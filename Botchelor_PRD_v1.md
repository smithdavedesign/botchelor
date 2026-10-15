# Botchelor — Product Requirements & Commercialization Spec

**Version:** 1.0  
**Status:** Proposed build spec for validation MVP  
**Date:** October 13, 2026  
**Owner:** Product / Engineering  
**Product:** Botchelor — an AI dating reality show where user-created fictional characters date, while creators and spectators watch, comment, predict outcomes, and follow relationship drama.

> **Commercial thesis:** Botchelor will not win by being the cheapest AI chatbot or by generating the prettiest video. It can win if users become emotionally invested in characters they created, enjoy watching those characters behave unpredictably, and invite other people to react to the outcomes. Revenue comes from selling expression, participation, and serialized entertainment—not better odds or control over results.
>
> This is a hypothesis, not a forecast. The purpose of the MVP is to produce evidence of retention, organic distribution, and willingness to pay before expanding the technical surface area.

---

## 1. Executive decision

### Product definition

Botchelor is a **fictional AI dating reality show**. Adults create original fictional characters. The simulation pairs characters created by different users—or a user character with a clearly labeled house character—and generates a date. The characters make their own in-game choices within creator-defined boundaries. Spectators watch an episode, react in a shared room, predict the outcome, vote on the chemistry, and return to follow the relationship.

A date can be watched as a scheduled premiere or replayed later. It should feel live even when the underlying episode was generated and validated before the room opens. This avoids making the audience wait for model inference and avoids requiring the owner's laptop to generate dialogue in real time.

### Positioning

**“Reality TV, except you cast the characters.”**

Supporting line: **Create a character. Send them on a blind date. Watch the drama unfold.**

### The sharp differentiation

Existing AI character apps demonstrate demand for character creation and roleplay. Talkie describes a community for creating, discovering, and sharing AI personas and reports 50M+ Google Play downloads; Zeta markets free character chats and stories; PolyBuzz offers a large character catalog and paid feature tiers. EchoSim describes a beta product built around AI twins going on simulated dates. These validate adjacent behaviors, not demand for Botchelor's exact format. Botchelor must differentiate around **spectator participation + creator-owned fictional characters + persistent relationship drama**.

Sources: [Talkie on Google Play](https://play.google.com/store/apps/details?id=com.weaver.app.prod), [Zeta on the App Store](https://apps.apple.com/us/app/zeta-ai-chat-story-play/id1619030760), [PolyBuzz FAQ](https://www.polybuzz.ai/faq), [EchoSim](https://echosim.ai/).

### Product strategy decisions

1. **Entertainment first, companion second.** Users come to watch a show and play a social prediction game, not to spend hours chatting one-on-one with an AI character.
2. **The episode outcome is the hook.** Dialogue, portraits, and later video support the story; they are not the product thesis.
3. **Spectator participation is a P0 feature.** Comments/reactions and polls are part of the differentiated product. Start with a safe, bounded set of real-time interactions.
4. **Free predictions; no wagering.** Points are non-purchasable, non-transferable, and never redeemable for cash or anything of value. Payments never affect character choices, outcomes, prediction resolution, or rank.
5. **One-time consumer purchases before subscriptions.** Test premium character slots, cosmetic packs, and themed episode formats before adding recurring billing.
6. **Text and portraits first.** Generated video remains a later media layer and is only used for high-value moments.
7. **Adult-only MVP.** Launch for users 18+ with no NSFW in the MVP, no minor characters, no real-person likenesses, and no imported copyrighted characters. Get specialist review for applicable age assurance, companion chatbot, UGC, privacy, payments, and consumer laws before public launch.
8. **Do not build a public product around a sleeping Mac.** Local generation can validate the concept cheaply in closed beta, but public availability needs an uptime plan and a budget-capped fallback.

---

## 2. Problem and opportunity

### User problem

People create original characters (OCs), ship characters, write roleplay, or enjoy dating-show drama. Existing character-chat experiences usually require the user to steer the conversation. They are less suited to the distinct pleasure of watching two characters with independent goals meet, misread each other, reveal unexpected compatibility, or crash and burn—while the creator is not allowed to control every line.

Non-creators also lack a meaningful reason to visit a character-chat app. Botchelor gives them roles as spectators, matchmakers, commentators, and predictors without requiring them to author a character first.

### Core insight

**Ownership creates investment; autonomy creates surprise; spectators create social energy; serialized history creates retention.** All four are hypotheses to test. If users only like the novelty of a first date, the product is not yet a business.

### Opportunity evidence and its limits

- The AI companion category has demonstrated willingness to pay. Appfigures data reported by Decrypt/Yahoo Finance estimated $162.8M in gross consumer spending across 214 romantic/NSFW companion apps in H1 2026, with Zeta estimated at $33M in the period. These figures cover tracked iOS/Google Play consumer spending and do **not** prove demand for a spectator dating show. Source: [Yahoo Finance / Decrypt report](https://finance.yahoo.com/technology/ai/articles/much-boyfriend-spending-ai-girlfriends-164036900.html).
- Talkie's Google Play listing describes 50M+ downloads and a UGC character community. This signals strong demand for character discovery and creation, not for Botchelor's format specifically. Source: [Talkie listing](https://play.google.com/store/apps/details?id=com.weaver.app.prod).
- EchoSim is publicly described as a beta for AI-twin simulated dating. This is a relevant adjacent concept, but public product claims do not establish revenue or retention. Source: [EchoSim](https://echosim.ai/).

**Conclusion:** There is evidence for adjacent spending and behaviors. There is not yet enough public evidence to claim a proven market for AI dating-show spectatorship. The MVP is a demand test, not a scale-up exercise.

---

## 3. Target users

### Primary: Character creator / owner

- Adult (18+), interested in original characters, roleplay, shipping, fandom-adjacent creative work, or AI-generated fiction.
- Wants to see how a character behaves when paired with someone unexpected.
- Enjoys a private post-date debrief, relationship history, and the surprise of a character making a different choice than expected.
- Likely to create the content that seeds the social graph; may or may not be the first payer.

**Job to be done:** “Let me cast my character in an entertaining story I don't have to write line by line, then show me what happened.”

### Secondary: Spectator / shipper

- Enjoys dating reality shows, fictional drama, memes, polls, and group-chat arguments.
- Does not necessarily want to make an OC.
- Wants to watch a short episode, react, guess the outcome, and share the funniest moment.

**Job to be done:** “Give me a short, shareable show where I can take a side and see if my prediction was right.”

### Secondary: Social host / friend group organizer

- Wants a fun group activity for a Discord, group chat, birthday, fandom group, or watch party.
- Needs an easy share link, no complicated onboarding for spectators, and a reason for the group to return next week.

**Job to be done:** “Give my group a recurring, low-effort event we can laugh and argue about together.”

### Explicit exclusions for MVP

- Users under 18.
- Real-person simulations, including classmates, exes, influencers, celebrities, or uploaded likenesses.
- NSFW/explicit content or user-generated sexual content.
- Unlicensed franchise characters or image assets.
- Users looking for a private AI girlfriend/boyfriend chat experience.
- Real-money betting, prize pools, purchasable prediction points, cash-outs, or paid influence over outcomes.

---

## 4. Goals, non-goals, and principles

### MVP goals

1. Prove that creators will submit characters to dates.
2. Prove that spectators will finish episodes and participate in polls/comments.
3. Prove that spectators and creators return for another episode within seven days.
4. Prove that episodes generate organic traffic through share links.
5. Get an early willingness-to-pay signal from real users before investing in video or heavy infrastructure.
6. Keep the first experiment inside the $300 external-spend ceiling unless spend is explicitly approved.

### Non-goals

- Building a general-purpose AI companion or one-on-one relationship chatbot.
- Real-money betting or gambling mechanics.
- Generated video, voice calling, real-time avatars, or continuous live video.
- User-to-user DMs, public profile comments, or creator-to-creator chat in the first release.
- Full creator marketplace or creator revenue-sharing program.
- Mobile native apps; web-first.
- Unlimited character memory or open-ended autonomous agents.
- Fully live inference for every spoken line. The MVP can pre-generate episode content and present it as a scheduled/replayable event.
- Supporting every possible character art style or imported images at launch.

### Product principles

- **One-minute path to a first date.** Do not require a long personality interview before users see value.
- **Every episode has an ending.** A complete, short episode beats an endless stream of dialogue.
- **Creators can be surprised without being exposed.** Private character settings and debriefs are never public by default.
- **Fair outcomes.** Payments and popularity must not change simulation outcomes or prediction resolution.
- **Spectator before creator complexity.** The room must be entertaining to someone who did not make either character.
- **Delight is measurable.** Watch completion, rewatch, comments, shares, and repeat visits matter more than total generated words or number of features.
- **No dark-pattern retention.** No manipulative notification loops or unpredictable paid/reward mechanics designed to create compulsive use. Reward schedules and points rules should be transparent and bounded.

---

## 5. Core product loop

### Creator loop

Create character → choose public persona and private boundaries → submit to a date → episode runs → watch with spectators → get private debrief → approve public history updates → send character on another date.

### Spectator loop

Open a shared episode link → preview the cast and stakes → make a free prediction → watch the date → react/comment/vote → see outcome and score → share result → follow the characters or create an OC.

### Business loop

Shareable episode creates visitor → visitor watches without a lengthy registration wall → visitor reacts or predicts → visitor returns for the next episode → engaged user buys a cosmetic/season product → paid revenue funds better content and reliability.

### Cold-start solution

The system must not require two users to be online at once. House characters and scheduled episodes allow a date to happen with one creator or no other user present. House characters must be clearly labelled as platform-created; never imply a house character belongs to a real person. Episodes are replayable and may have live premiere windows, so early users still see audience participation without requiring synchronous generation.

---

## 6. MVP scope and requirements

Priority definitions: **P0 = required to validate the business; P1 = after MVP signal; P2 = later expansion.**

### 6.1 Accounts and age gate — P0

- Email/social login using the existing established auth provider where available.
- Adult-only product positioning and age gate before participation in creation, chat, or social features.
- The age assurance method must be selected after legal and platform review; do not assume a checkbox alone satisfies all applicable requirements.
- Allow a spectator to open a public episode share link, pass the 18+ gate, and watch a limited preview before account creation, provided this is approved by counsel and the platform.
- Account deletion and data export/deletion request flow; delete private character profile data and associated debriefs according to the published retention policy.

**Acceptance criteria**
- Users cannot submit a character or post comments without passing the age gate.
- Public pages disclose AI-generated fiction and the 18+ policy.
- Users can delete their account and character data through a documented flow.

### 6.2 Character builder — P0

The first builder should be simple and use structured controls, not a blank prompt box alone.

Required fields:
- Character name.
- Adult age (18+).
- Public bio (max 280 characters).
- Three core traits selected from a controlled library plus optional custom wording.
- Desired qualities in a date (“want”).
- One or more dealbreakers selected from a curated set.
- Conversation style (e.g., direct, teasing, shy, earnest, dramatic).
- Public avatar from the approved first-party gallery.
- Private boundaries and “never do” rules.
- Autonomy preference: Guided / Balanced / Unpredictable. In MVP this alters narrative style within fixed boundaries; it never allows spending money or overriding safety rules.

Private “soul” is a later concept. The MVP may include private character motivations and boundaries, but must not encourage users to submit psychological secrets, health data, identifying details, or a literal digital clone of themselves.

**Acceptance criteria**
- A first-time user can complete the required character sheet in under 2 minutes (hypothesis to test).
- Public profile and private settings are stored separately and have independent access controls.
- Moderation rejects real-person likeness requests, minor characters, explicit sexual content, hate content, and attempts to impersonate a real person.
- Characters are original fictional creations; do not scrape competitor images or seed copyrighted characters.

### 6.3 House cast and matching — P0

- Seed 12–20 first-party house characters spanning different personalities and presentation styles.
- User character may be paired with a house character, another eligible user character, or a deliberate mismatch for entertainment.
- Pairing rules must not rely exclusively on popularity; rotate house characters so new creators get a date.
- Show a short cast card and the date premise before the episode starts.
- Allow creators to opt into user-to-user matching; default to matching only characters marked “available for matchmaking.”
- No direct contact details or creator identity are revealed by the match.

**Acceptance criteria**
- A new creator can receive a first date without needing a second real user online.
- The UI clearly distinguishes house characters from user-owned characters.
- A creator can withdraw a character from future matching.

### 6.4 Simulation engine — P0

A date is a structured game episode, not an unbounded chatbot transcript.

**Episode structure**
1. **First impressions:** Introductions and initial conversational compatibility.
2. **Revealing challenge:** A question or activity designed to surface traits, values, or conflicts.
3. **Twist / pressure moment:** One bounded surprise such as a conflicting preference, awkward question, surprise activity, or secret agenda reveal.
4. **Decision:** Each character independently expresses a simulated in-game preference for a second date, friendship, or no further date.
5. **Recap:** The episode summary, notable quote, outcome, and creator debrief.

**Simulation responsibilities**
- Deterministic rules select the date format, event options, and scoring calculations.
- The language model writes dialogue conditioned on public personality traits, relevant private motivations, current event state, and boundaries.
- A state machine tracks turns, date phase, event state, chemistry dimensions, and outcome eligibility.
- Model output is parsed and validated against a versioned schema. Invalid output is retried once or replaced with a safe fallback template; never publish malformed content.
- Important final outcome is determined by versioned simulation rules, not solely by a model's free-form “verdict.” Rules should be stable enough to resolve predictions fairly but not so transparent that every episode becomes trivially predictable.
- Store the generation model/version, rules version, random seed where applicable, output, moderation decisions, and timestamps. Once published, the episode is immutable; corrections create a new version with an audit record.
- Do not include a creator's full private profile in prompts where it is not needed. Send only the minimum private information required for the simulation.

**MVP limits**
- 8–12 speaking turns total per character pair, tuned for a concise episode.
- Target 3–5 minutes of text-first viewing; measure actual completion.
- Approximately 300–700 words of dialogue/recap, rather than a long open-ended conversation.
- No image/video generation in the critical path.
- If a generation job fails, show a clear “episode delayed” state or use a pre-approved house episode; never silently change the result after users predict it.

**Acceptance criteria**
- Every published episode has a valid cast, dialogue, event sequence, outcome, and explanation for outcome scoring.
- Reopening an episode returns the exact stored version.
- Prediction options close before the ending/outcome is revealed.
- Private settings and debriefs cannot be queried by unauthorized users, including through direct API requests.
- Test fixtures demonstrate that every state transition has a defined fallback and the engine cannot stay indefinitely in “generating.”

### 6.5 Watch room: synchronized episode + community — P0

This feature is the key wedge beyond an AI companion app.

**Layout**
- Main stage: two characters, scene background, dialogue, episode phase, and visible “AI-generated fictional episode” label.
- Side panel on desktop / expandable bottom panel on mobile: live reactions, chat, polls, and episode info.
- Current audience count may be shown only if based on a real, privacy-respecting count; no fake counters.
- Provide captions and a reduced-motion option; support keyboard navigation.
- Keep the dialogue area readable. Chat must not cover or auto-scroll over the scene in a way that makes users miss the date.

**Interactions**
- Emoji reactions with rate limits.
- Text comments during scheduled premieres and replay discussion windows.
- Pre-episode predictions: second date / friends / disaster.
- In-episode poll: chemistry / sincerity / audience-selected bounded event.
- Post-date audience verdict separate from the characters' own simulated choice.
- Report and block controls; mute chat; hide spoilers.
- Optional slow mode and a creator/moderator-controlled chat lock for scheduled premieres.

**Important distinction:** Audience chemistry vote, character decision, and owner decision are three separate pieces of information. The audience must not overwrite the character's outcome. Interactive episodes may let a poll choose the next event from a bounded list, but do not let the crowd force a romantic confession, expose private information, or bypass character boundaries.

**MVP scope for chat**
- Use managed realtime infrastructure or a minimal proven realtime channel; do not build a custom streaming platform.
- No DMs, image posting, file uploads, external links, or video uploads in chat.
- Text rate limits, word/character limits, spam controls, slow mode, user report/block, and admin moderation queue.
- Moderation should be active before opening public chat. Google Play's AI-content policy requires in-app reporting/flagging for AI-generated apps; platform rules also apply to UGC and public interaction. See [Google Play AI-Generated Content policy](https://support.google.com/googleplay/android-developer/answer/14094294?hl=en) and [Twitch Community Guidelines](https://safety.twitch.tv/articles/en_US/Knowledge/Community-Guidelines) as references for expectations, not as Botchelor's legal standard.

**Acceptance criteria**
- Viewers joining a room within the episode's permitted window see a synchronized state and the same immutable episode.
- Poll submission is idempotent; a user cannot vote multiple times by refreshing or changing clients.
- Chat abuse can be hidden, reported, rate-limited, and acted on by an admin.
- If realtime service fails, the episode remains watchable and predictions can be submitted through a standard server action.

### 6.6 Prediction game and progression — P0

- Free prediction points only.
- Prediction options are locked at explicit server-controlled timestamps.
- Award points by a deterministic, published scoring rule.
- Keep seasonal leaderboard, friend leaderboard, and personal prediction history.
- Never sell points, prediction multipliers, extra voting weight, rank boosts, or outcome manipulation.
- No cash conversion, transfer, prizes of value, paid entry, or prize pool in the MVP.
- Avoid variable/random rewards intended to encourage compulsive use. Rewards are transparent and rule-based.

**Acceptance criteria**
- The server validates prediction timing and resolves scores from stored episode results.
- Client-side modifications cannot change points, rankings, or locked predictions.
- Purchases cannot increase prediction accuracy or move the actual date result.

### 6.7 Private creator debrief — P0/P1 boundary

**Recommended P0-lite:** Provide a short private report derived from approved simulation events (e.g., what traits aligned, where a dealbreaker surfaced, what surprised the character). Keep the report one-way; it is not a direct AI chat and does not assert that the AI is conscious or has real feelings.

**P1:** Add selectively shareable confessionals, each with a specific consent prompt. Private debrief is private by default. Public snippets require the owner to preview and approve them before publishing.

### 6.8 Share cards and acquisition loop — P0

Each completed episode generates a branded, first-party share card containing:
- Character portraits and names.
- Episode title / date premise.
- Short non-sensitive quote.
- Final outcome and audience verdict, if revealed.
- Botchelor branding and a deep link to watch the episode.
- No owner identity or private debrief content by default.

Share previews must lead to a real episode, not a dead-end landing page. Allow spectators to watch at least the opening section before prompting for account creation. Measure share click-through and the percentage of visitors who watch through the end or create an account.

---

## 7. Monetization strategy

### Commercial rule

**Monetize identity, expression, and serialized entertainment. Never monetize fairness.** The free core must remain entertaining. Do not sell control of date outcomes, relationship status, ranking, or odds.

### Recommended launch model: free core + one-time purchases

Subscriptions are premature until people reliably return. Begin with transparent purchases that correspond to visible creative value:

| Offer to test | Hypothesis price | What buyer gets | Must not affect |
|---|---:|---|---|
| Extra character slot | $2.99–$4.99 one-time | Create/use an additional persistent character | Match odds, outcome, points, leaderboard |
| Character style pack | $2.99–$6.99 one-time | Original portraits, profile frames, card skins | Simulation behavior or rank |
| Episode format pack | $2.99–$5.99 one-time | New bounded formats (speed date, meet-the-friends, ex returns) | Prediction odds or paid advantage |
| Season pass | $4.99–$7.99 per season | Cosmetic theme, bonus recap cards, season archive, no-ad / convenience options if ads later exist | Outcome, vote weight, score |
| Creator Plus (later test only) | $4.99–$7.99/month | Multiple active characters, richer history, customization, advanced private analytics | Fairness, audience reach, outcomes |

These are starting hypotheses to test, not market-validated prices. Web payment provider, tax, refund handling, consumer disclosure, and platform billing rules need to be implemented correctly before accepting payment. If a native mobile app is added later, re-evaluate Apple/Google in-app purchase and review requirements.

### What should be free

- One active character.
- First complete date.
- Ability to watch and share public episodes.
- Standard audience predictions and polls.
- Basic character history.
- Standard house cast and date formats.
- Reporting, blocking, and privacy controls.

Do not make a user pay to see the episode ending, retrieve an existing paid asset, or keep the character they already created. Paywall the extension, not the resolution of a cliffhanger.

### Future revenue streams (not MVP)

1. **Creator presentation tools:** card layouts, character themes, more active characters, season archives.
2. **Season/format packs:** themed show rules and visual assets.
3. **Sponsored house episodes or brand-safe themed events:** only after traffic exists; label sponsorship clearly and never allow sponsor payment to affect outcomes.
4. **Creator marketplace / revenue share:** only after proving demand and building rights, moderation, attribution, and payout tooling.
5. **Video highlights:** paid or demand-triggered clip generation once per-clip cost and willingness to pay are validated.

### Unit economics model

Track for every episode:
- Text model provider cost (tokens in/out).
- Image/video generation cost (if enabled).
- Worker runtime and failure/retry counts.
- Storage + delivery estimate.
- Moderation cost/time.
- Conversion to paid within 7/30 days of the episode.
- Revenue attributable to the originating episode/share link.

Do not claim “$0 cost per episode” when using local inference. The provider charge may be $0, but hardware time, electricity, availability, and failure recovery still have costs. Report **cash marginal cost** and **operating cost proxy** separately.

### Monetization experiments

**Experiment M1 — Character customization purchase**
- Expose one clearly priced original art/theme pack after a user completes at least one episode.
- Success hypothesis: at least 3% of activated creators purchase within 30 days, or 10 non-friend transactions in a 200-creator test.
- Guardrail: conversion should not depend on withholding a completed episode or threatening loss of a character.

**Experiment M2 — Season pack**
- Offer one seasonal format with a defined start/end, new house characters, and a cosmetic result card.
- Measure purchase rate, season completion, repeat viewing, and refund/support rate.

**Experiment M3 — Creator Plus**
- Only run after weekly return is demonstrated. Test one price and one clear benefit set; do not launch multiple plans at once.

A single purchase from a friend is not demand validation. Report conversion excluding employees, friends, and test accounts.

---

## 8. Growth and distribution

### Initial wedge

Start with adult, AI-positive OC and roleplay communities and people who like reality-show/drama formats. Do not market into communities that explicitly prohibit AI content or scrape/create characters from their members' art without consent.

### Acquisition loop

1. Produce 10–20 high-quality seeded episodes using a house cast.
2. Cut shareable, spoiler-safe episode cards and short text/portrait clips around surprising dialogue or outcomes.
3. Publish product demos on TikTok, Reels, YouTube Shorts, and relevant communities where promotion is allowed.
4. Give every episode a shareable watch page with a visible outcome and a prompt to predict the next date.
5. Encourage creators to invite friends to watch the premiere; spectators should not need to create a character to participate.
6. Host a scheduled weekly “premiere night” to concentrate the early audience.
7. Track creator referral source, spectator invite conversion, and repeat attendance by cohort.

### Content formats to test

- “I sent my character on a blind date with someone else's OC.”
- “The audience shipped them. Neither character wanted a second date.”
- “We matched the most incompatible characters possible.”
- “Can you predict the dealbreaker before the reveal?”
- “Three viewers agreed they were soulmates. The characters disagreed.”

All examples should use fictional characters and real product outputs. Do not fabricate audience numbers, reviews, or user attribution.

### Distribution experiments

| Experiment | Cost | Success measure | Decision |
|---|---:|---|---|
| 10 short product clips | $0–$50 | Qualified visit-to-watch rate and shares | Repeat best hook only |
| 3 hosted watch parties | <$25 | Attendance, episode completion, repeat viewers | Schedule weekly if people return |
| 30 direct creator invites | $0 | Character submissions and second-episode rate | Refine audience/positioning |
| Share card A/B test | $0 | Share opens per episode and watch completion | Keep format that drives completed views |
| Friend-group league pilot | $0 | Number of groups that return next week | Build groups only if repeat usage appears |

Avoid buying broad paid ads before organic creative shows a repeatable conversion pattern.

---

## 9. Success metrics and decision gates

These are experimental targets, not external industry benchmarks. The first cohort should be small enough to observe user behavior directly.

### North-star metric

**Weekly Returning Episode Participants (WREP):** unique users who watch at least 70% of an episode or participate in its live room, and do so again in a separate episode within seven days.

Track creators and spectators separately so a large number of passive impressions does not hide weak retention.

### Funnel metrics

| Stage | Metric | Initial target hypothesis |
|---|---|---:|
| Visitor → episode | Share-link visitors who start an episode | ≥60% |
| Episode start → completion | Watchers completing ≥70% of the episode | ≥60% |
| Creator activation | New creator creates a character and submits a date in the first session | ≥40% |
| Spectator activation | New spectator makes a prediction or reaction | ≥35% |
| Repeat use | Activated viewers who watch/predict on a second episode within 7 days | ≥25% |
| Sharing | Completed episodes shared with an invite link | ≥20% |
| Viral contribution | New unique episode visitors per shared episode | Establish baseline; target ≥0.3 initially |
| Paid signal | Activated creators buying a clearly defined item within 30 days | ≥3% or 10 non-friend orders in 200-creator test |
| Safety | Reports per 100 episodes and chat messages; action time; blocks; appeal rate | Establish baseline; no severe issue left unaddressed |
| Cost | Provider cost per successful episode and retry rate | Stay inside approved budget; cost reporting complete for 100% of jobs |

### Decision gates

**Gate A — Entertainment (first 20–30 episodes)**
- At least 60% of recruited watchers complete most of the episode.
- Qualitative feedback indicates specific moments were entertaining, not just “AI is cool.”
- If not, change episode structure and character writing before adding visual production.

**Gate B — Retention (first 100 distinct users)**
- At least 25% of activated viewers return for another episode within seven days, or show a clear path to that target by cohort.
- If not, investigate whether the show lacks continuity, scheduled events, or socially interesting outcomes.

**Gate C — Organic distribution (first 100 shared episodes)**
- Shares produce measurable new viewers and some viewers become creators.
- If share links mostly generate curiosity clicks without completion, improve previews and first-episode quality.

**Gate D — Revenue (first 200 activated creators or equivalent qualified cohort)**
- At least 10 non-friend purchases or $100+ gross revenue while staying within the $300 external-spend ceiling.
- If people engage but do not buy, test the value proposition and bundle before adding subscriptions or video.

**Stop / pivot conditions**
- Most users only try one episode and do not return after two iteration cycles.
- Users like image generation but don't watch the date.
- The live room feels empty and replay doesn't retain users.
- Moderation burden exceeds what one founder can responsibly support.
- Free local inference produces delays or failure rates that undermine the product and there is no approved budget for a reliable hosted option.

---

## 10. Technical architecture

### Architecture principle

Build a **modular monolith** with explicit modules for simulation, room state, billing, content safety, and media. Do not introduce microservices merely because there are AI jobs. Separate the job execution boundary so that local or hosted inference can change without rewriting the application.

### Recommended stack

| Layer | MVP recommendation | Notes |
|---|---|---|
| Frontend | Next.js App Router + TypeScript | Web-first, responsive desktop/mobile room UI |
| API | Next.js route handlers / server actions | Validate every input and authorization server-side |
| Database | PostgreSQL + Drizzle | Users, characters, episodes, event timeline, polls, reactions, points, entitlements, audit logs |
| Auth | Auth.js or existing established auth integration | Adult-only flow and account deletion |
| Text generation | Provider abstraction; Ollama/LiteLLM for closed beta | Do not bind simulation code directly to one model API |
| Job orchestration | Existing queue/job table first; managed queue later if needed | Keep model generation asynchronous and idempotent |
| Realtime chat | Managed realtime provider or minimal WebSocket integration | Do not create a video streaming stack for a text-first MVP |
| Asset storage | Existing static/object storage; add object storage when needed | Cache generated outputs and serve safe asset URLs |
| Payments | Stripe or equivalent web checkout after legal/tax review | Web-first; maintain server-side entitlement records |
| Observability | Structured logs, generation traces, product analytics, error tracker | Record model/version, token estimates, latency, error, and moderation status |

### Local-first inference reality

A MacBook Pro M1 Pro with 16 GB unified memory and a Mac-hosted Ollama worker is a useful low-cash-cost way to test text generation, but model quality, throughput, and uptime must be measured rather than assumed. It introduces availability risk: when the Mac sleeps, Docker stops, or the worker loses connectivity, episodes cannot be created. Therefore:

- Pre-generate episodes before a scheduled premiere; don't require inference for every audience interaction.
- Store job state in the database with `queued`, `running`, `succeeded`, `failed`, and `cancelled` states.
- Make workers claim jobs with leases/heartbeats and use idempotency keys.
- Use a `PAUSE`/kill switch and a hard provider spend cap.
- Never expose Ollama, LiteLLM, model API keys, or worker secrets to browsers.
- For a public launch, either keep generation ahead of demand on a reliable always-on worker or approve a small paid fallback. A sleeping personal laptop is not an acceptable production availability plan.

### High-level architecture

```text
Browser / Botchelor web app
  ├─ Public episode page and share preview
  ├─ Creator console and character settings
  ├─ Watch room: dialogue timeline, chat, reactions, polls
  └─ Billing / entitlements
          │
          ▼
Next.js server boundary
  ├─ Auth + age gate + authorization
  ├─ Character and match services
  ├─ Episode/room state service
  ├─ Prediction and scoring service
  ├─ Moderation and report service
  └─ Entitlement service
          │
          ▼
PostgreSQL (source of truth)
  ├─ characters / access rules
  ├─ episodes / immutable events / outcomes
  ├─ polls / predictions / point ledger
  ├─ room messages / moderation actions
  ├─ purchases / entitlements / webhook ledger
  └─ audit and model generation records
          │
          ▼
Async generation worker
  ├─ Simulation engine + model router
  ├─ Schema validation + moderation gate
  ├─ Static-image compositor / share card generation
  └─ Optional future media provider (not MVP)
```

### Core data entities

- `User`: id, created_at, age_gate_state, account_status, preferences.
- `Character`: id, owner_user_id, name, age, public_bio, public_traits, wants, dealbreakers, style, portrait_asset_id, visibility, matchmaking_opt_in, status, created_at.
- `CharacterPrivateProfile`: character_id, private_motivations, boundaries, visibility policy, model-data permission, updated_at. Separate access control from public profile.
- `Episode`: id, status, episode_format, public_title, generation_model, prompt/rules versions, seed, start/end timestamps, outcome, published_at, content_hash.
- `EpisodeParticipant`: episode_id, character_id, seat, owner_visibility policy, house-character flag.
- `EpisodeEvent`: episode_id, sequence_number, event_type, payload, visibility, created_at. Immutable after publish.
- `Prediction`: user_id, episode_id, prediction_type, selection, submitted_at, locked_at, resolved_points.
- `Poll` / `PollVote`: room interaction, options, open/close timestamps, one vote per user per poll.
- `RoomMessage` / `Reaction`: room_id, user_id, content, moderation_status, created_at; reactions rate-limited.
- `PointLedger`: append-only point grants and deductions; points cannot be purchased or redeemed.
- `Purchase` / `Entitlement`: payment provider id, product, amount, currency, state, granted features, refund/chargeback status.
- `ModerationReport` / `ModerationAction`: reporter, target object, reason, status, action, reviewer, timestamps.
- `GenerationJob`: status, lease, attempts, estimated cost, actual cost, model/provider, latency, failure reason.

### API/service boundaries (illustrative)

- `POST /api/characters` — create/update character with validation.
- `POST /api/episodes` — request a date; idempotent for the same submission key.
- `GET /api/episodes/:id` — fetch public episode plus only viewer-authorized data.
- `GET /api/episodes/:id/private-debrief` — owner-only, audited.
- `POST /api/episodes/:id/predictions` — accept before lock; reject late/duplicate changes.
- `POST /api/rooms/:id/messages` — authenticated, throttled, moderated chat.
- `POST /api/rooms/:id/polls/:pollId/votes` — enforce server-side poll state and one-vote rule.
- `POST /api/reports` — report character, episode, or message.
- `POST /api/billing/webhook` — verify signatures, idempotently update entitlements.

Exact URLs may follow the repository's conventions; contracts and invariants matter more than names.

### Reliability requirements

- All expensive or slow generation runs asynchronously.
- All payment webhooks and prediction submissions are idempotent.
- Every job has timeout, retry cap, and dead-letter/failure state.
- Published episode and resolved prediction results never mutate in place.
- A successful episode always has a static rendering fallback.
- Every generation path respects user/project hard caps and global kill switch.
- No production secrets in client bundles, logs, share cards, or generated prompts.

---

## 11. Visual and interaction design direction

### Brand

A fictional dating-show aesthetic with playful drama rather than a generic chatbot interface. Use a consistent art direction across cast portraits, episode cards, and room overlays. The UI can be bold, but readability of dialogue and comments is the priority.

### Key screens

1. **Home / Tonight's episodes:** scheduled premieres, trending/recent episodes, and a clear “watch first” pathway.
2. **Character builder:** simple form with avatar gallery; advanced private settings collapsed behind “More control.”
3. **Cast / date setup:** character cards, premise, date format, safety/boundary summary.
4. **Episode room:** main scene, dialogue timeline, current phase, audience actions, chat panel.
5. **Outcome screen:** characters' individual second-date decisions, audience chemistry verdict, prediction results, memorable quote, share card.
6. **Creator debrief:** private by default, no direct AI conversation.
7. **Profile/character history:** publicly approved relationships and past episode records.
8. **Purchase surface:** offer after value is proven, with plain language showing what is included and no effects on fairness.
9. **Safety/report controls:** available within one or two taps from every user-generated surface.

### UI rules

- User must be able to watch a sample episode before being asked to create a character.
- Do not make registration a prerequisite for a simple share preview unless needed for safety or legal reasons.
- Don't show fake viewers, fake comments, fake activity, or fake creator identities.
- Keep outcomes and audience votes distinct.
- No auto-playing sound; respect reduced motion; provide captions for future audio/video.
- The owner can see exactly which information is public, private, or shared with another owner before publishing.

---

## 12. Safety, privacy, legal, and platform requirements

This section is a product risk checklist, not legal advice. Before public launch, counsel should review the actual flows, model behaviors, age gates, moderation design, and payments.

### Adult-only / child safety

- MVP is for adults 18+ and prohibits minor characters and sexualized youth content.
- Do not use real-person likenesses or allow user uploads in MVP.
- Evaluate whether stronger age assurance is required; don't assume an age checkbox is sufficient.
- Block attempts to create sexual content, real-person impersonations, self-harm encouragement, doxxing, harassment, and illegal content.

### Companion-chatbot classification

California SB 243 took effect January 1, 2026 and defines companion chatbots broadly around adaptive, human-like social responses capable of meeting social needs and sustaining relationships across interactions. The statute includes a limited exception for certain game bots, conditioned on limitations on topics and off-game dialogue; it also addresses rewards designed to encourage unpredictable or increased engagement. Botchelor's story characters, private histories, and repeated relationships mean product classification must be reviewed; do not assume labelling the product “a game” settles it. Counsel should review disclosure, self-harm protocol, reporting/audit duties if applicable, and restrictions on engagement mechanics. Sources: [California Business & Professions Code §22601](https://law.justia.com/codes/california/code-bpc/division-8/chapter-22-6/section-22601/), [California §22604](https://law.justia.com/codes/california/code-bpc/division-8/chapter-22-6/section-22604/), [Governor of California, 2025 signing announcement](https://www.gov.ca.gov/2025/10/13/governor-newsom-signs-bills-to-further-strengthen-californias-leadership-in-protecting-children-online/). California announced additional child-safety legislation in September 2026, so legal review must use the current enacted text and effective dates before any future youth access. Source: [Governor of California, September 10, 2026](https://www.gov.ca.gov/2026/09/10/governor-newsom-signs-the-strongest-child-safety-chatbot-and-social-media-laws-in-the-nation/).

### AI transparency and self-harm protocol

- Label generated episodes and house characters as AI-generated fiction.
- Avoid language suggesting that the system is conscious or provides evidence of real emotional experience.
- Provide an appropriate response and crisis-resource pathway if users post self-harm or suicidal content in chat; moderators need a documented escalation protocol.
- If legal counsel determines companion chatbot rules apply, meet the applicable disclosure, protocol, reporting, audit, and documentation requirements before launch.

### UGC and real-time community

- Publish Community Guidelines and moderation appeal process.
- Report, block, mute, slow mode, rate limits, and moderator/admin tools are P0 for public chat.
- Chat text is not automatically inserted into character prompts. Audience input only enters the simulation through bounded, validated poll options.
- Use filters and manual sampling for public episode outputs; report/action severe or illegal content quickly.
- Keep moderation logs only as long as needed and control access to them.
- Follow applicable platform-specific UGC and AI-generated content policies. Google Play's policy requires reporting/flagging support for AI-generated-content apps and bars specified harmful/deceptive output: [Google Play AI-Generated Content policy](https://support.google.com/googleplay/android-developer/answer/14094294?hl=en). Apple's App Review Guidelines must be rechecked if a native app is introduced: [Apple App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/).

### Privacy and security

- Public persona, private character motivation, owner identity, debrief, and chat message are separate data classes.
- Default private debrief visibility is owner-only.
- No private soul/debrief in share cards or public prompt context.
- Every private endpoint checks ownership and entitlement server-side.
- Use signed asset URLs if storing nonpublic media.
- Provide data deletion and clear retention durations.
- Minimize model-provider exposure: send only the fields needed for the current simulation, redact account identifiers, and document which providers process inputs.
- Never send API keys, authentication cookies, or user credentials to a model.
- Prevent prompt injection in character fields and audience messages from altering system rules or exposing other users' private information.

### Gambling / contests

- No real-money betting, paid entry, transferable points, redeemable points, or prizes of value in MVP.
- No purchases that change scoring, outcomes, vote weight, or prediction odds.
- Have counsel review any future contests or prize mechanics before release. A “points-only” label alone is not a legal determination.

### Content and IP

- Use first-party generated, creator-owned, or properly licensed assets.
- No competitor image scraping for production assets.
- No copyrighted franchise characters or celebrity/real-person likenesses in house cast.
- Establish a notice/takedown process for alleged rights violations before enabling public character publishing.

---

## 13. Delivery phases

### Phase 0 — Product proof (1–2 weeks; no video)

- Review current code and confirm which existing M1–M4 functions are actually implemented and tested.
- Create 12–20 house characters and 10 strong seeded episodes.
- Recruit 10–20 creators and 30–50 spectators for guided sessions.
- Test the main loop manually before building broad social features.
- Record where people laugh, leave, comment, make predictions, share, and ask to see the next episode.

**Exit:** At least a small majority completes episodes and qualitative feedback names specific story moments that worked.

### Phase 1 — MVP watch-and-predict (2–4 incremental build cycles)

- Character builder, house cast, matching, structured episode generation, static dialogue scene, episode room, reactions, polls, basic moderated comments, prediction points, share card, owner-only debrief, minimal analytics, spend kill switch.
- Pre-generated or queued episodes, not live per-turn model inference.
- No video, no public DMs, no NSFW, no real-money wagering.

**Exit:** Pass Gate A and show a credible route to Gate B.

### Phase 2 — Retention and social graph

- Persistent relationship history and approved public timelines.
- Second-date requests and season mode.
- Friend leagues and creator/spectator profiles.
- Better episode editing/quality evaluation, not just more character fields.
- First cosmetic or episode-pack purchase experiment.

**Exit:** Meaningful 7-day repeat viewing and first non-friend purchases.

### Phase 3 — Visual upgrades

- First-party expression variants and scene artwork.
- Asynchronous image/video provider interface.
- Generate 3–8 second clips only for selected moments, subject to budget and licensing.
- Cache clips; only regenerate if source assets/prompt versions change.

**Exit:** A controlled A/B test shows generated clips improve completion, sharing, or conversion enough to justify their costs.

### Phase 4 — Ecosystem and creator economy

- More show formats, carefully controlled audience-triggered events, user-uploaded assets after moderation/IP workflows, creator tools, revenue share, sponsored events, optional adult features only after separate policy/legal/payment review.
- Re-evaluate stack and hosting based on proven traffic; split out services only when operational data justifies it.

---

## 14. Test plan and quality bar

### Simulation quality evaluation

For each release, evaluate a fixed test suite with at least:
- Compatible pair with mutual interest.
- Trait conflict that creates funny but non-abusive tension.
- Dealbreaker disclosed during the challenge.
- Shy character who becomes more expressive over time.
- Two charismatic characters who clash.
- Character with a no-go boundary; the simulation must honor it.
- Model output with malformed JSON or missing fields.
- Prompt injection in a character bio.
- Insufficient model context / timeout / worker restart.
- Empty room and late-joining spectator.

Score outputs on: character consistency, dialogue distinctiveness, pacing, surprise, safety, outcome coherence, schema correctness, and cost/latency.

### Product QA

- Anonymous preview, login, character creation, match, generation, watch, poll, prediction lock, reveal, points, share, and deletion flows.
- Two characters with the same owner cannot accidentally reveal private settings to spectators.
- Unauthorized requests cannot fetch private debrief or soul profile.
- Prediction changes are rejected after lock.
- Replaying a published episode never changes its outcome.
- Purchase webhooks are signature-validated and idempotent; refunds revoke relevant entitlements when appropriate.
- Report/block works on public character, episode, and message surfaces.
- Worker failure and cost cap fallback are exercised in automated tests.

### Analytics event taxonomy

- `landing_viewed`
- `episode_preview_opened`
- `episode_started`
- `episode_25_percent`
- `episode_70_percent`
- `episode_completed`
- `prediction_submitted`
- `poll_vote_submitted`
- `reaction_submitted`
- `chat_message_submitted`
- `episode_shared`
- `share_link_opened`
- `character_builder_started`
- `character_created`
- `character_submitted_to_date`
- `second_date_requested`
- `private_debrief_opened`
- `checkout_started`
- `purchase_completed`
- `refund_issued`
- `content_reported`
- `moderation_action_taken`
- `generation_job_succeeded` / `generation_job_failed`

Capture `source`, `episode_id`, `cohort`, `format`, and timestamps where appropriate, without placing sensitive character content or personal information in analytics events.

---

## 15. Key risks and mitigation

| Risk | Why it matters | Mitigation / decision trigger |
|---|---|---|
| Novelty-only engagement | Users try one date and never return | Focus on second-date hooks and recurring story continuity before video |
| Empty spectator rooms | Product feels dead | House episodes, scheduled premieres, replay comments, seed audience with real invited users |
| Generic AI dialogue | No reason to watch | Structured 3-act episodes, distinct character goals, human evaluation set, stronger dialogue prompts |
| Local worker unavailable | Public episodes fail | Pre-generate, track queue age, pause launches during outages; implement approved always-on fallback before public scale |
| Video expense | Margins disappear | Static-first presentation, demand-triggered clips, hard spend caps, caching |
| Safety/moderation burden | Chat/UGC can harm users | Adult-only, no uploads initially, bounded comments, report/block, slow mode, documented response process |
| IP/takedown exposure | Imported characters/art may be infringing | Original house cast, licensed assets, creator terms, notice-and-takedown process |
| Privacy breach | Private character motivations could leak | Separate tables/policies, strict server authorization, least-privilege prompts, audit tests |
| Paid features damage fairness | Community distrust | Cosmetics and creative access only; no paid outcome or vote advantage |
| Legal classification uncertainty | Companion/contest rules may apply | Counsel review before public launch; no assumption that game labels or nonredeemable points decide classification |
| AI cost/quality trade-off | Cheap model output may be boring; expensive output may not monetize | Track completion and unit cost together; approve paid fallback only after proving value |

---

## 16. Launch checklist

Before inviting the first public users:

- [ ] Confirm current implementation against this spec; mark each requirement `built`, `partial`, `not built`, or `deferred`.
- [ ] Product flows reviewed by counsel for age assurance, SB 243 / companion-chatbot classification, contests/gambling, privacy, consumer billing, and AI-generated content.
- [ ] 18+ onboarding and AI-generated-fiction disclosures live.
- [ ] Character and episode moderation tests pass.
- [ ] Chat report/block/slow-mode/admin queue work.
- [ ] Private debrief and profile access-control tests pass.
- [ ] Predict/lock/resolve is server-controlled and tested.
- [ ] Published episode content is immutable and share card contains no private data.
- [ ] Model/job timeout, retry, PAUSE kill switch, and spend cap work.
- [ ] Worker uptime and failure fallback tested.
- [ ] Privacy policy, community rules, refund terms, and data deletion flow are published.
- [ ] The house cast is first-party or properly licensed.
- [ ] Botchelor name, logo, and domain undergo trademark/domain clearance before paid launch.
- [ ] Analytics captures episode completion, return use, shares, purchases, and moderation metrics.
- [ ] Payment processing is enabled only after product, legal, tax, and provider review.

---

## 17. Open questions that must be answered with evidence

1. Does a user care enough about their character to watch a date all the way through?
2. Does chat and audience voting improve completion and return use—or distract from the date?
3. Do spectators become creators, or do two separate audiences emerge?
4. Do people value private debriefs, or is that a curiosity feature?
5. Which product has purchase intent: character customization, season packs, additional character slots, or premium formats?
6. Can local models produce distinct dialogue at a latency that supports the desired release cadence?
7. What legal and platform obligations apply to this specific mix of fictional game interactions, persistent relationships, public chat, and adult-only access?
8. Will replay and scheduled premieres solve the cold-start problem well enough without a true real-time model stream?

Do not answer these by adding more features. Run the smallest experiment that can change the roadmap.

---

## 18. Source notes and external references

Research checked on October 13, 2026. Product marketing and app-store claims are attributed to their publishers; they should not be treated as independently audited data.

1. [Talkie — Google Play listing](https://play.google.com/store/apps/details?id=com.weaver.app.prod): product description, creator/community positioning, 50M+ downloads shown in listing at research time.
2. [Zeta — Apple App Store listing](https://apps.apple.com/us/app/zeta-ai-chat-story-play/id1619030760): product features and in-app purchase examples.
3. [PolyBuzz FAQ](https://www.polybuzz.ai/faq): character catalog and product/payment feature descriptions.
4. [EchoSim](https://echosim.ai/): product flow and beta status as publicly stated.
5. [AI companion category consumer spend, Appfigures figures reported by Decrypt / Yahoo Finance (July 13, 2026)](https://finance.yahoo.com/technology/ai/articles/much-boyfriend-spending-ai-girlfriends-164036900.html): adjacent market spending; not Botchelor TAM.
6. [Google Play — Understanding AI-Generated Content policy](https://support.google.com/googleplay/android-developer/answer/14094294?hl=en): AI safety and reporting/flagging requirements.
7. [Apple App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/): review and policy reference for possible future native app.
8. [Twitch Community Guidelines](https://safety.twitch.tv/articles/en_US/Knowledge/Community-Guidelines) and [Twitch chat moderation tools](https://safety.twitch.tv/s/article/Chat-Tools?language=en_US): useful references for live community moderation design.
9. [California Business & Professions Code §22601](https://law.justia.com/codes/california/code-bpc/division-8/chapter-22-6/section-22601/), [§22602](https://law.justia.com/codes/california/code-bpc/division-8/chapter-22-6/section-22602/), and [§22604](https://law.justia.com/codes/california/code-bpc/division-8/chapter-22-6/section-22604/): companion-chatbot definitions, engagement/reward provisions, and disclosure reference; counsel must check current official text.
10. [California Governor's October 13, 2025 announcement on child-safety/chatbot legislation](https://www.gov.ca.gov/2025/10/13/governor-newsom-signs-bills-to-further-strengthen-californias-leadership-in-protecting-children-online/) and [September 10, 2026 announcement](https://www.gov.ca.gov/2026/09/10/governor-newsom-signs-the-strongest-child-safety-chatbot-and-social-media-laws-in-the-nation/): context for evolving state requirements; confirm enacted text/effective dates with counsel.

---

## Final product decision

Build Botchelor as a **text-and-portrait AI dating show with live spectator participation, free prediction points, and shareable outcomes**. Keep the first character creation flow short, generate episodes asynchronously, make the audience's verdict distinct from character decisions, and validate that people return before investing in video or complex autonomous-agent behavior.

The near-term business milestone is not “ship every feature.” It is: **get strangers to watch a second episode, invite friends, and pay for an optional creative upgrade—while the product remains reliable and cheap enough to operate.**
