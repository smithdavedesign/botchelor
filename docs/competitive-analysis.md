# Competitive analysis & feature roadmap

_Written for David, 2026-10-13. What the competitors do, where Botchelor wins, and a prioritized roadmap — $0-now vs. spend-gated. Sources at the bottom._

## What the competitors do

| App | What it is | UI / features worth stealing |
|---|---|---|
| **Character.AI** | Chat-first, biggest library | Personality sliders (humor/tone/empathy), backstory, voice selection, appearance, behavioral constraints, **AvatarFX** animated avatars, scene creation, group chats. Premium gates advanced creation. |
| **Talkie** | Chat + gamification | **Collectible cards generated from conversations, tradeable** (a card game layered on chat), image-generated avatars (anime / 3D / realistic styles), 15+ adjustable traits, hairstyles/clothing/voice/quirks, public/private sharing, large community library. |
| **Chai** | Mobile-first casual chat | Big community bot library, simple creation, mobile-native feel. |
| **Janitor AI** | Power-user chat | Most customizable; bring-your-own model via API. |
| **Love Island USA app** | Companion to the TV show | Real-time **play-along** at showtime, prediction games, polls, quizzes, puzzles, exclusive clips, push notifications for voting rounds. >25% of mobile viewers played the S7 prediction game. |

The pattern: competitors win on **visual richness (avatars/images), customization depth (sliders, appearance), gamification (cards, collections), and community (shareable libraries)**. They are almost all chat-first and creator-steered.

## Where Botchelor already wins

- **Watch-only show, not a chatbot.** Nobody types both sides; the outcome is the attraction. No competitor does this.
- **A real game engine.** Outcomes come from a deterministic, seeded engine, not a model, so predictions are fair and dates are replayable (Sliding Doors). Competitors' "outcomes" are just chat.
- **A spectator job.** Non-creators predict, matchmake, and follow a living cast — the Love Island habit, but for user-made characters.
- **Souls + privacy.** The public/private split, with a local-only soul that never touches a model. Stronger privacy posture than any of them.
- **$0 and safe-by-default.** Free models, 18+ only, no real people, no real-money anything.

## The gaps (and the plan to close them)

### Shipped in this pass ($0)
- **Avatars.** Every character gets a generated, consistent avatar (deterministic SVG — gradient + motif + initials), across the feed, episodes and cast. Closes the single biggest "feels alive" gap vs. Character.AI/Talkie, with no image hosting and no real-person risk.
- **Appearance customization.** An optional appearance line and an avatar palette the owner picks — character customization without uploads.
- **A visual overhaul.** Display type, a richer palette with real dark mode, a hero, card and button polish, and avatars throughout.
- **A richer cast gallery.** The `/cast` page becomes a browsable, avatar-rich library (Talkie/Chai's community-library feel).

### Next, still $0
- **Collectible "contestant cards" and "moment cards"** (Talkie's hook, our way): a shareable character card and a per-episode moment card, built on the existing OG-image route. Optional badge/sticker collection earned from the free prediction game.
- **Community gallery with follows.** Browse and follow creators' public characters; a "most-shipped" and "best conversationalist" board (several categories, not just popularity).
- **Live-feeling season moments.** A weekly "finale night" where several episodes air together and the board updates in real time (the Love Island play-along feel), on the existing season engine.
- **Personality sliders in the builder** mapped to the engine signals (warmth/boldness/humor), as a friendlier alternative to writing a soul.

### Spend-gated (proposed, not built — see docs/upgrade-cost.md)
- **Image upload as a reference / portrait, and "image as training data".** This is the user's explicit ask. It is **not** a $0 feature and carries real risk, so it is proposed with guardrails rather than switched on:
  - **Cost:** object storage + CDN for the images, and a vision model to derive anything from them. Both are in the upgrade-cost staging.
  - **Safety/legal (the blocker):** uploads of real people are banned (the whole product bans real people), so an upload path needs **automated image moderation** (CSAM scanning via a service like a hash-matching API, plus a real-face / real-person classifier) before anything is stored or shown. A solo owner cannot moderate raw image uploads by hand. "Training data" specifically (fine-tuning or embedding a person's likeness) raises consent and likeness-rights issues on top of that.
  - **The $0 stand-in shipped now:** generated avatars + appearance text give visual identity without uploads, so the product looks custom today while the upload path waits for budget + a moderation provider.
- **Generated portraits and scenes, voice, and short video** — Phase 3 media, already in upgrade-cost.md.

## Recommended order

1. **This pass ($0):** avatars, appearance, the visual overhaul, the cast gallery, a full E2E test suite and seed data. (In progress.)
2. **Next $0 pass:** contestant/moment cards + the community gallery with follows and category boards.
3. **First spend (your approval):** Stage 1 of upgrade-cost.md (frontier text model + compute-budget gate), which also lifts dialogue quality above the free tier — the thing that keeps the tenth date as good as the first.
4. **Image upload** only once a moderation provider and storage are funded, with the guardrails above.

## Sources

- [Character.AI complete guide 2026](https://www.codaone.ai/blog/character-ai-complete-guide-2026/) · [Character.AI review](https://tooliverse.ai/tools/character-ai)
- [What is Talkie AI?](https://aichief.com/ai-fun-tools/talkie-ai/) · [Talkie AI startup profile](https://neuronfeed.com/startups/talkie-ai)
- [Best AI roleplay apps 2026](https://www.aigirlfriends.it.com/?p=174) · [Character AI vs Janitor AI](https://characterai.it.com/?p=2643)
- [Love Island lets viewers join interactive games (NBCUniversal)](https://www.nbcuniversal.com/article/love-island-lets-viewers-join-fun-interactive-games) · [Love Island S7 app downloads (FoxData)](https://foxdata.com/en/blogs/love-island-usa-season-7-how-a-reality-dating-show-fueled-app-downloads-in-2025/)

_These are mostly third-party review/SEO sources; feature specifics should be confirmed on each app's official listing before any competitive claim is made publicly._
