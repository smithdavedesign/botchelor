# PRD: Botchelor

## Problem
People who make original characters and follow fictional relationship drama have places to chat with AI characters (Character.AI, Talkie, Chai) but nowhere to watch their character live a story they didn't steer, and nothing for friends who don't make characters to do. Chat apps need constant input from the creator, and a non-creator has no reason to visit. The Love Island USA app shows that watching a dating show and predicting it is a habit people already have (more than a quarter of mobile viewers played the season 7 prediction game), but it only serves a real cast. See RESEARCH.md: Evidence of the problem.

## Target user
- **Creator (pays, if anyone does):** an adult (18+) who has an original character and enjoys roleplay or shipping OCs, and is comfortable with AI-written fiction. The painful moment: "I wrote this character a whole backstory and want to see what happens when they meet someone, without spending an evening typing both sides."
- **Spectator (free, the audience):** an adult friend of a creator, or a fan of dating reality shows, who wants to guess how a date goes and compare with friends.
- Not the art-first OC community: RESEARCH.md shows that many reject AI. Marketing goes to AI-positive roleplay spaces only.

## Competitors & gap
Character.AI ($9.99/mo c.ai+), Talkie, Chai, Janitor AI and Blush are chat-first and creator-steered. EchoSim simulates dates for real people's matchmaking. Love Island USA's app has the prediction habit but no user characters. The gap is a **watch-only episode format** with a **free spectator prediction game**, where the creator can't steer and reveals themselves only by mutual consent. PairWise and Persona AI Dating could not be verified. Gap evidence is "not found in search", not proven absence.

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
