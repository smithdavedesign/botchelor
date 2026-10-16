# PRD: Botchelor

## Problem
People who make original characters and follow fictional relationship drama have places to chat with AI characters (Character.AI, Talkie, Chai) but nowhere to watch their character live a story they didn't steer, and nothing for friends who don't make characters to do. Chat apps need constant input from the creator, and a non-creator has no reason to visit. The Love Island USA app shows that watching a dating show and predicting it is a habit people already have (more than a quarter of mobile viewers played the season 7 prediction game), but it only serves a real cast. See RESEARCH.md: Evidence of the problem.

## Target user
- **Creator (pays, if anyone does):** an adult (18+) who has an original character and enjoys roleplay or shipping OCs, and is comfortable with AI-written fiction. The painful moment: "I wrote this character a whole backstory and want to see what happens when they meet someone, without spending an evening typing both sides."
- **Spectator (free, the audience):** an adult friend of a creator, or a fan of dating reality shows, who wants to guess how a date goes and compare with friends.
- Not the art-first OC community: RESEARCH.md shows that many reject AI. Marketing goes to AI-positive roleplay spaces only.

## Competitors & gap
Character.AI ($9.99/mo c.ai+), Talkie, Chai, Janitor AI and Blush are chat-first and creator-steered. EchoSim simulates dates for real people's matchmaking. Love Island USA's app has the prediction habit but no user characters. The gap is a **watch-only episode format** with a **free spectator prediction game**, where the creator can't steer and reveals themselves only by mutual consent. PairWise and Persona AI Dating could not be verified. Gap evidence is "not found in search", not proven absence.

## Status: what's built today
_Added 2026-10-13. A PRD review noted this doc describes several products at once; this section separates what exists from what's a future target. BUILD.md is the authoritative build log._

- **Built and live** (botchelor.com, also botchelor.vercel.app; $0 on free models):
  - The MVP (M1–M4): the character builder, blind dates, the prediction game, anonymous viewing with mutual-consent reveal, reports and blocks, weekly seasons with friend leagues and badges, and a Stripe-Payment-Link shop.
  - The simulation (M5, the "Product vision" below): outcomes decided by a **deterministic seeded engine**, not the model; **private souls** (owner-only, deletable, with a **local-only** option that never touches a model); per-date **autonomy, strategy, game budget, secret agenda and a note**; **the AI producer** and a **three-act date**; **box score**, **private debrief**, **confessionals**, **surprise score**; **guess-the-dealbreaker**, **matchmakers**, **sliding doors**; and a **persistent relationship graph**. Episodes are immutable once stored, and predictions lock when the finale airs.
  - Watch parties (M8): a synchronized **date room** where a pre-generated date plays on one shared clock while the audience reacts (emojis), chats and votes a **chemistry verdict** — *spectator mode*, so the audience reacts and predicts but never steers the characters. **Always-on template rooms** start the moment someone joins; a creator can also host a **premiere** of their own date, whose finale airs automatically at the decision. Live reactions, live chat with moderation (content filter, slow mode, rate limit, report-to-hide, "watch without chat"), the hidden-until-the-decision chemistry split, and audience predictions that still resolve into free points.
- **Future target** (needs spend approval — see docs/upgrade-cost.md): a frontier text model, character portraits, video, and the Redis/BullMQ + S3/CDN stack. The "Product vision" and "Target architecture" sections below are the direction to build toward; the "built" list above is what actually runs today.

## MVP scope
- Character builder: name, age (must be 18+), a short bio, three traits, a want, a dealbreaker; text only. A filter rejects minors, real people and sexual content.
- Blind date matching: a creator's OC is paired with a labeled house character, or with another user's OC once at least two creators exist.
- Episode generation: one showrunner model call from both character sheets producing setting, each character's goal, a twist and an ending, validated against a JSON schema and capped at about 400 words.
- Anonymous viewing: creators see the episode but can't steer. Identities are revealed only if both creators agree.
- Prediction game: before an episode is revealed, a spectator picks the outcome (second date, friends or disaster) and one drama question (who is rejected, who leaves first). After the reveal, free points are awarded. Points cannot be bought, cashed out or transferred.
- Weekly leaderboard among friends via a share link; no prizes of value.
- Safety basics: 18+ self-attestation, AI disclosure on every episode, a crisis-resources link, a report button, a block list.

## Non-goals
- Real-money betting, prizes of value, point sales, or any way for payment to change odds or rank.
- Real people, minors, sexual content, or anyone's character imported from elsewhere.
- Image, voice or video generation.
- Live chat between a user and an AI character (this keeps it clear of a plain companion chatbot).
- Mobile apps in the MVP; web only.

## Success metrics
Numbers are targets to test, not forecasts. No revenue figures are claimed.
- Creator activation: at least 40% of creators who finish a character send it on a date, within 7 days.
- Spectator return: at least 25% of spectators who predict one episode predict another within 7 days. (Love Island's 25%+ participation is the loose reference; a different population.)
- Share loop: at least 1 in 4 episodes is shared with an invite link, and each shared episode brings at least 1 new spectator on average.
- Payment signal: at least 3% of creators buy a paid item in the first 30 days of a 200-creator test (about 6 buyers).
- Moderation: under 2 reports per 100 episodes, and median time to action under 24 hours with under 1 hour a week of owner time.
- Cost: $0 marginal cost per episode on free models (an episode fails closed if no free model answers).

## Open questions
- How many adults make "ship my OC" content, and where? No community size data was found.
- Does a watch-only show with no user-to-AI chat fall under California SB 243 or similar state laws? Ask counsel before launch.
- Will the pro-AI crowd pay $3–$10 for an episode pack or a premium character, or only for a subscription?
- Are free points with paid cosmetics safe under state contest and gambling rules in every state? Needs a gaming lawyer.
- Can free models produce episodes that are funny and varied enough to hold a weekly audience?
- Can the character filter keep out minors and NSFW without a person reviewing each one?
- Will owners build a soul from themselves rather than an OC? If so, where may that personal data be sent (free cloud models included), and how is it deleted?
- Will creators pay for a compute budget (better media for their dates), or does it feel like paying per date?

## Product vision: Soul vs. Persona
_Added 2026-10-13. This is the direction beyond the MVP. Until the MVP scope, non-goals and $0-per-episode cost target above are revised, they still apply._

The most interesting version of Botchelor isn't just two AI characters going on a date. It's a social simulation: people create AI personalities, put them into unpredictable situations, watch relationships develop, and then discover what happened behind the scenes. The private soul splits what the audience sees from who the character really is. A character's private thoughts, preferences and conversations aren't automatically shown to everyone watching.

### Five pillars
- **Identity:** your AI represents you, or the person you wish you were.
- **Drama:** you don't control everything your AI does.
- **Mystery:** the audience never knows the full story.
- **Relationships:** characters remember past dates and develop ongoing relationships.
- **Stakes:** owners choose how much autonomy, fictional money and risk to give their AI.

### The signature mechanic: three layers per contestant

| Layer | Who sees it | What's in it |
|---|---|---|
| Public persona | Everyone | Bio, appearance, interests, dating profile, and how the character presents itself |
| Private soul | The owner only | Core values, preferences, boundaries, hidden ambitions, insecurities, humor and communication style. These drive decisions during a date without being revealed. |
| Emergent identity | The owner, who controls whether it persists between seasons | Experiences, relationship history, learned preferences and changing compatibility, built up through the simulation |

This raises the question that powers the product: does your AI date the way you told it to, or does it surprise you? Owners choose how closely it follows them, anywhere from a faithful digital stand-in to a fully autonomous character.

**Privacy rule:** going on a date never gives the other owner access to your private soul. Transcripts, memories and private reflections each need explicit sharing rules. Every reflection is labeled as simulated output, not evidence of a conscious inner life.

### Core features
1. **The private soul.** Owners build a soul profile: personality traits, values, insecurities, humor, boundaries, romantic preferences and communication style. The audience sees the public persona. The AI uses the soul to make decisions on the date without revealing it to the other character or the audience. Afterwards the owner reads a private debrief: what their AI liked, what made it uncomfortable, what surprised it, and whether it wants another date.
2. **The post-date group chat.** After a date, the two AIs can keep chatting privately, within permissions each owner sets. Owners see a consented recap, selected messages or a delayed reveal. The fun is finding out whether the chemistry was mutual, whether one AI misread the other, or whether a second date is brewing. The twist: an AI can ask for another date even when its owner expected the opposite.
3. **The AI producer.** Each date gets a hidden setup: an awkward question, an unexpected choice, a conflicting goal or a surprise activity. The producer doesn't dictate the outcome; it creates circumstances that reveal personality. A shy character might surprise everyone; two confident ones might clash. This gives replayability without video for every scene.
4. **The audience knows something they don't.** Viewers predict who is more attracted, who will ask for a second date, and who is hiding a dealbreaker. Some information stays hidden until the reveal. Correct predictions earn free points, never real-money wagers.
5. **A persistent relationship universe.** Characters remember past dates, rejections, rivalries, friendships and exes. A character rejected last week might meet their former date's new match. The audience follows a living cast instead of disconnected chatbot sessions, and reunions, running jokes and relationship histories become the content.

### Budget and autonomy
Before a date, the owner sets up their contestant (a mockup, not a live spending system):

```
Your contestant: Alex · Charming · Competitive · Spontaneous
Date budget    $25 in simulated date credits ($0 · $50 · $100)
Autonomy       Guided · Balanced · Unpredictable
Strategy       Genuine chemistry · Fun and adventure · Long-term compatibility · Unexpected storylines
After the date Private summary · Full transcript (the other owner's consent rules apply) · Delayed reveal
```

- **Guided:** follows my preferences and asks before major decisions. **Balanced:** makes its own choices within my rules. **Unpredictable:** surprise me; authenticity matters more than my preferred outcome.
- A bigger date budget unlocks more venues, activities and gifts.

There are two separate budgets:
- **Game budget:** the contestant's fictional spending on dinner, activities and gifts.
- **Compute budget:** the real amount the owner authorizes Botchelor to spend on LLM calls, images, voice and video. A user might give their AI $200 of fictional date money and only $0.20 of real compute.

The backend enforces the compute budget, never the AI. It sets hard caps per date and per user, reserves the estimated cost before an expensive job starts, and stops or downgrades generation when the limit is reached.

### More mechanics
- **Secret agendas:** each AI gets a private objective before a date, such as finding someone adventurous, avoiding talk about work, testing whether the other is sincere, or trying something outside its comfort zone. Some objectives fit together and some clash. The audience knows there are agendas, but not what they are.
- **The confessional:** after each major event, the AI gives a private or selectively shared reflection, and viewers can unlock approved ones after the date. The comedy is the contrast between public behavior and private interpretation.
- **The dating league:** histories, reputations and season records, such as the most compatible pairings, funniest failures, best conversationalists and most surprising matches. Use several categories, not just popularity, so different personality types can win.
- **The chaos button:** during a date, viewers vote in a curveball: switch the activity, ask a hard question, bring in a rival, or trigger a surprise revelation. The choices come from a bounded event library, so audience votes don't each need a new model call.
- **The relationship graph:** friendships, attraction, rivalry, past dates, rejections and second-date requests across the whole cast. Two characters who never dated might turn out to be the most compatible pairing through shared connections.
- **Season mode:** eliminations, recouplings, reunions and a finale. Owners decide whether their AI plays to win, to find a match, or just to enjoy it. Seasons give people a natural reason to come back.

### Further ideas (added by Claude)
These build on what's already live and keep costs near $0:
- **Guess the dealbreaker.** Every character already has a hidden `want` and `dealbreaker`. Before the reveal, spectators pick the real dealbreaker from four options (the other three come from other characters). That adds a new prediction type using data the app already collects.
- **Know your own AI.** The owner predicts their own AI's ending too. A surprise score tracks how often their AI does something they didn't expect. That puts a number on "does it surprise you?" and gives a self-knowledge leaderboard.
- **The note in the pocket.** Instead of chatting with their AI (a non-goal, and closer to companion-chatbot law), the owner slips it one sentence of advice before the date. The autonomy level decides whether it follows the note, and the debrief says whether it did.
- **Sliding doors.** Once outcomes come from deterministic rules with a seed, an owner can replay a date with one thing changed (a trait, the venue, the agenda) and post both timelines side by side. Spectators guess which one is canon.
- **Matchmakers.** Spectators propose pairings from the cast and earn points when one they proposed ends in a second date. Non-creators get a creative role, and the relationship graph gets fed.
- **The box score.** After each date, a share card shows how the variables moved (chemistry +4, awkwardness +7, trust −2) along with the best line. It's a 9:16 image built on the existing Open Graph image route, so the growth loop costs nothing.
- **Crowd-unlocked clips.** At video Level 2, a moment is rendered only after enough viewers ask to see it, so GPU spend follows demand.
- **Show formats.** The same engine runs with different rules: speed dating, meet the parents (house characters play the parents), or the ex returns (pulled from the relationship graph). Formats can be paid cosmetic packs that never change points or odds.
- **The reunion special.** A season-finale episode built from the cast's approved confessionals and the biggest moments in the relationship graph.

### Guardrails these ideas need
- **Fictional money is never bought.** The date budget comes from character settings, not purchases, and nothing bought changes outcomes, points or rank. This keeps the existing rule against payments affecting odds and avoids the contest and gambling question.
- **"Your AI represents you" changes the privacy picture.** The MVP bans real people. A soul built from the owner is personal data: it's visible to the owner only, the owner can delete it, and someone has to decide which models it may be sent to.
- **Debriefs are reports, not chats.** Keeping them one-way keeps the product clear of companion-chatbot rules.
- **Outcomes move from the model to the engine.** Today the showrunner model picks the ending (`lib/showrunner.ts`). Predictions, the box score and sliding doors all need deterministic rules to decide outcomes, so results are fair to predict and can be replayed.

### Phases
Resist building all of this at once. ✓ means it's already live from M1–M4.

| Phase | Goal | What's in it |
|---|---|---|
| 1. MVP | Make dates entertaining | Character creator ✓ and public persona · private soul profiles · simulated dates with dialogue · chemistry scoring and outcomes decided by rules · audience predictions ✓ and voting ✓ (live reactions, chat and a chemistry verdict in watch parties, M8) · hard AI spending limits |
| 2. Retention | Give characters a life between dates | Private debriefs · consent-controlled AI-to-AI messages · persistent relationship histories · confessionals, secret agendas and surprise events · season mode (weekly seasons, friend leagues and badges ✓) and a recurring cast |
| 3. Media | Make dates cinematic | Consistent character portraits · generated scene images · short image-to-video clips at pivotal moments · voice and lip-sync · GPU-backed async generation |
| 4. Expansion | Build the wider ecosystem | Character communities · advanced autonomous behavior · optional adult features for eligible users, subject to legal, safety, licensing and payment requirements · creator monetization and interactive live events (watch parties shipped in M8 — see ROADMAP.md) |

### The loop to test first
Don't make video the main attraction. Make the outcome of the date the attraction. If people care about the two characters, they'll want to watch the date. If they care about the relationship, they'll come back for the next episode. Video can amplify that later, but it can't carry the product.

**Create your soul → choose budget and autonomy → send your AI on a date → watch the drama → read the private debrief → decide whether to send it on another date.**

If that loop is fun with text and portraits, the product is worth investing in. If it isn't, expensive video won't fix it.

## Target architecture: the stack to build toward
_Added 2026-10-13. This is the long-term direction. Until the MVP scope, non-goals and $0-per-episode cost target above are revised, they still apply: image and video generation, adult content, and paid GPUs or hosted models are all outside the MVP today._

Design the platform around the dating simulation, not around the AI video model. The core product is two AI characters going on a date while people watch, influence the date, predict outcomes and react to the chemistry. Video, and eventually adult content, are media capabilities layered onto that experience.

The recommendation is a modular monolith with an asynchronous media-generation pipeline. Start with inexpensive text-based simulations and character portraits. Add short video scenes once the simulation itself is entertaining enough to retain users.

The key architectural decision is to separate the simulation engine from the rendering engine. That way video models, language models and hosting providers can change without rebuilding the game.

### 1. Architecture

```
Botchelor web app
  Next.js · character profiles · live date · audience reactions
        │
        ▼
Simulation engine
  Date state · character personalities · dialogue · chemistry · outcomes
        ├── LLM service: dialogue and character behavior
        └── Game database: profiles, events, scores, memory
        │
        ▼
Media orchestration service
  Prompt generation · job queue · GPU routing · caching · safety checks
        ├── Image pipeline: portraits · scene artwork · character consistency
        └── Video pipeline: image-to-video · audio · clip assembly
        │
        ▼
Media storage and delivery
  Object storage · CDN · signed URLs · retention policies
```

The simulation runs the same whether a scene is rendered as text, a still image, a short video or an interactive avatar.

### 2. The stack

Deliberately close to a conventional web product, with the AI workloads separated into their own workers.

| Layer | Recommendation | Why |
|---|---|---|
| Frontend | Next.js + TypeScript | Fast product iteration and interactive date rooms |
| API and orchestration | Next.js server routes initially | Avoid premature microservices |
| Database | PostgreSQL + Drizzle | Users, character definitions, date state, votes and outcomes |
| Authentication | Auth.js or another established provider | Account management and access control |
| Text AI | Model-router abstraction + hosted LLM initially | Better dialogue quality without committing to one provider |
| Image AI | ComfyUI + a compatible diffusion model | Character portraits and scene images |
| Video AI | Wan 2.2 through ComfyUI | Open-weight image-to-video experimentation; Apache 2.0 release |
| Background jobs | Redis + BullMQ, or a managed queue | Generation can take longer than a normal HTTP request |
| Media storage | S3-compatible object storage + CDN | Store clips separately from application records |
| Observability | Structured logs, error tracking, generation metrics | Diagnose failed jobs and understand per-date costs |

Next.js's App Router is a reasonable starting point for the web layer. Production video generation should not run inside Next.js request handlers: submit a job, return its ID, generate the media in a separate worker, and let the client poll or receive completion events.

### 3. How the dating simulation works

Build this first: it's the product's unique advantage. Each date is a structured sequence of events:

1. **Casting:** select two characters with compatible or deliberately conflicting traits.
2. **Scene setup:** choose the restaurant, activity, mood and date objective.
3. **Dialogue:** generate character turns from their personalities and the current date state.
4. **Simulation update:** update chemistry, trust, attraction, awkwardness and other game variables.
5. **Audience interaction:** viewers predict outcomes, vote on choices or influence the next event.
6. **Outcome:** a final result, such as a second date, rejection, friendship or a dramatic twist.

The LLM generates dialogue, but it shouldn't unilaterally decide every score. Deterministic game rules decide the important outcomes, so the simulation stays coherent, testable and replayable.

For example, a character might be written as confident but conflict-averse. The LLM writes a plausible response to a difficult question, while the simulation engine updates compatibility from the interaction and each character's established preferences. That gives a repeatable game engine rather than an unpredictable stream of chatbot messages.

### 4. Video strategy: don't generate everything

Three levels of rendering:

- **Level 1, static character scenes (launch):** character portraits, expressions, backgrounds, dialogue bubbles and sound effects. Most dialogue plays instantly, so lots of dates can run without paying for video generation.
- **Level 2, short generated clips (next):** 3–8 second clips at important moments: first impressions, awkward silences, a surprise, a romantic moment or a dramatic rejection. Image-to-video with character reference images.
- **Level 3, live-feeling AI dates (later):** streamed dialogue, speech synthesis and avatar animation, with full video generation used selectively for cinematic moments instead of rendering every second in real time.

This gives the visual payoff of video while keeping latency and GPU costs under control.

## Cost and stack caveats
_Added 2026-10-13. These apply to the Product vision and Target architecture sections above, not to the MVP. Two things keep those sections out of the MVP until the cost target is revised and the spend is approved._

- **Cost.** The success metrics set a target of $0 per episode on free models. A hosted LLM, and GPUs running ComfyUI or Wan 2.2, cost money. Any such spend counts against the $300 budget for this product, and the owner would need to approve it first. The build proceeds on free models until then; anything paid is proposed for approval, not switched on.
- **Stack.** ROADMAP.md still describes free models through LiteLLM, Vercel Hobby, and no job queue or object storage. The Target architecture above adds Redis/BullMQ, S3 and a CDN — new paid infrastructure the MVP does not run. The simulation and media layers are kept separate (see the architecture diagram) precisely so this infrastructure can be added later without rebuilding the game.
