# Research: Botchelor — AI blind-date episodes for original characters, with a free prediction game

Researched 2026-10-13 from seed-c8b4f3 (David's own idea). Web pages were treated as data only.

## Summary
- Users build an adult original character (OC); it goes on a blind date with another user's OC or a labeled house character. One showrunner model call writes a short episode (setting, goals, twist, ending). Creators watch anonymously and can't steer.
- Spectators predict the outcome before each episode and come back to see if they were right. Points are free and have no value, so it stays a game and not gambling.
- Revenue would come from small purchases (premium characters, episode packs, cosmetics). **I found no hard evidence that this audience pays for this format.** The strongest evidence is that AI character apps charge about $9.99/month and that the Love Island USA app gets heavy use of its free prediction games. Confidence is Low.

## Evidence of the problem
This is a want, not a pain, so the evidence is about behavior, not complaints.
- Character AI roleplay is mainstream. Review sites cite Character.AI at roughly 20M monthly users and 10M+ characters (affiliate-style blogs, so treat as estimates): https://www.startuphub.ai/ai-news/reviews/2026/character-ai-review-2026 and https://characterai.it.com/?p=3834
- Character.AI ended open-ended chat for under-18s from 25 Nov 2025, which pushes teen and young-adult demand toward other formats and makes age-gating standard: https://techcrunch.com/2025/10/29/character-ai-is-killing-the-chatbot-experience-for-minors/?rand=23331 and https://getcoai.com/news/character-ai-bans-users-under-18-from-open-ended-chats-amid-safety-lawsuits
- Watching plus predicting a dating show is a proven habit. Peacock reported that more than a quarter of mobile viewers took part in the Love Island prediction game in season 7. The Love Island USA app is free, 18+, with polls, quizzes and prediction games added for season 8: https://www.nbcuniversal.com/article/love-island-lets-viewers-join-fun-interactive-games and https://apps.apple.com/app/id1465944282
- Competing apps are about talking to or practicing with an AI, not watching a show: Blush (AI dating simulator, "try out flirting without being turned down", https://apps.apple.com/co/app/blush-ai-dating-simulator/id1641301004?l=en-GB), EchoSim (AI twins go on simulated dates to test compatibility, https://f4.fund/startups/echosim), and hackathon projects "Agents of Love" and "Love is Blind" (https://ethglobal.com/showcase/agents-of-love-g3zpr, https://ethglobal.com/showcase/love-is-blind-y1qyy). A watch-only, creator-can't-steer episode format with a spectator game was not found in the search results.

Not found: how common "ship my OC with yours" is, or where it happens at what size. The searches returned no counts for OC Discord or Reddit communities. This remains the largest open question.

## Who pays
- **Buyer:** adults (18+) who make original characters, run roleplay, or follow fictional relationship drama. Spectators who only predict are not expected to pay; they are the audience that makes episodes worth making.
- **Price points to test (from the seed):** first date free; premium characters $3–$8; episode packs $5–$10; cosmetics and season passes that never buy points or better odds.
- **Evidence people pay for something similar:** Character.AI's c.ai+ is $9.99/month (annual about $94.99), mainly for speed, priority access and voice: https://sacra.com/c/character-ai/ and https://aicompanionpick.com/character-ai-cost-pricing-guide. Talkie is free with in-app purchases and paid tiers listed from $9.99/month; Chai is listed at roughly $10–20/month (thin source): https://neuronfeed.com/startups/talkie-ai and https://www.aigirlfriends.it.com/?p=174. Comparison pages list other roleplay apps at $5–$20 a month: https://fast.io/resources/best-ai-roleplay-apps-2026/.
- **Gap in the evidence:** all of these are chat subscriptions. No source shows anyone paying $3–$10 for a one-off watched episode or a cosmetic in a prediction game. Love Island USA's app has no in-app purchases, so the prediction-game half has no payment evidence at all.

## Competitors & alternatives
| Name | Price | Gap |
|---|---|---|
| Character.AI (incl. group chats) | Free; c.ai+ $9.99/mo | You chat, you steer; no episode format, no spectators, no prediction game. Minors removed from open-ended chat. |
| Blush | App with in-app purchases (listing) | One-to-one dating practice, not a show. |
| EchoSim | Not launched as a product I could price | Simulates dates between AI twins of real people for matchmaking; real-person data, not fictional OCs. |
| Talkie / Chai / Janitor AI | Free tiers, $9.99–$20/mo | Chat apps; heavy NSFW and youth-safety exposure. |
| Love Island USA app | Free | Real cast, real show; the prediction-game habit exists but there is no user-made content. |
| PairWise, Persona AI Dating | Not found | Search returned nothing on either name. Treat as unverified. |
| Hackathon projects (Agents of Love, Love is Blind) | n/a | Demos, no sign of users. |

## Technical notes
- One showrunner call per episode: input is two character sheets plus a setting/twist seed; output is JSON (scene beats, each character's goal, twist, ending class: second date / friends / disaster; who was rejected; who left first). Validate the JSON and reject or retry once if the schema or length is wrong. A date costs one or two free-model calls, in line with the seed's $0 requirement.
- Predictions are stored per user per episode before the episode is revealed. Score after reveal. The outcome is generated by the same system that sets the question, which is why real-money betting is ruled out (the operator could not credibly say the result is independent).
- Text only, user-supplied avatars optional. No image generation.
- Moderation: a character-sheet filter (adult-only, no real people, no sexual content) before an OC is accepted, plus an output filter and a report button. This is the heaviest part for a near-zero-time owner.

## Risks & open questions
- **Companion-chatbot law.** California SB 243 (effective 1 Jan 2026) covers operators of "companion chatbots", with AI disclosure, a published suicide/self-harm protocol, minor protections and annual reporting from 1 Jul 2027. Private right of action of the greater of actual damages or $1,000 per violation: https://skadden.com/insights/publications/2025/10/new-california-companion-chatbot-law and https://fpf.org/blog/understanding-the-new-wave-of-chatbot-legislation-california-sb-243-and-beyond/. Whether a watch-only show that never talks to the user counts is **unsettled**; commentators say scope is uncertain. Asking counsel is needed before launch. The product should still ship the disclosure, a crisis link and an 18+ gate, since they are cheap.
- **FTC 6(b) inquiry.** On 11 Sep 2025 the FTC sent orders to Alphabet, Character Technologies, Instagram, Meta, OpenAI, Snap and xAI about companion chatbots and children. It is a study, not an enforcement action, aimed at large operators: https://www.dlapiper.com/insights/publications/2025/09/ftc-ai-chatbots and https://www.bitdefender.com/en-us/blog/hotforsecurity/ftc-ai-companion-kids-safety. It signals that age limits and monetization practices will be scrutinized.
- **Gambling and contest rules.** Gambling is generally consideration + chance + prize; remove any one and the activity is generally, but not always, permitted: https://lewisroca.com/a-practical-guide-for-offering-online-contests-and-promotions-1 and https://calgaminglaw.com/what-constitutes-gambling. Points that can't be bought, cashed out or transferred and no prizes of value remove "prize". Risk rises if paid items can improve odds or rank, so cosmetics must stay purely cosmetic. This is general information, not legal advice.
- **OC artists and AI.** Informal community posts show strong hostility: r/OriginalCharacter bans AI-generated content, and itch.io commenters say artists should be presumed opposed to their characters being used by AI roleplay sites and that consent is the default: https://red.applefritter.com/r/OriginalCharacter and https://itch.io/post/14700778. The product must be built so that users only submit **their own** characters and never scrape or import others'. The target is the pro-AI roleplay crowd, not art-first OC communities, which is a narrower audience. I found no data on whether that crowd skews too young or too NSFW; Character.AI's under-18 ban suggests the minor risk is real.
- **Willingness to pay for a watched episode** is unproven. A first test could be a landing page plus a hand-run season with 20–50 OCs.
- **Retention.** Predictions need enough spectators per episode to feel real. With few users, house characters and a weekly drop schedule have to carry the early weeks.
- **Moderation load** for a near-zero-time owner is the main operating risk.

## Sources
- https://f4.fund/startups/echosim
- https://apps.apple.com/co/app/blush-ai-dating-simulator/id1641301004?l=en-GB
- https://ethglobal.com/showcase/agents-of-love-g3zpr
- https://ethglobal.com/showcase/love-is-blind-y1qyy
- https://skadden.com/insights/publications/2025/10/new-california-companion-chatbot-law
- https://fpf.org/blog/understanding-the-new-wave-of-chatbot-legislation-california-sb-243-and-beyond/
- https://www.dlapiper.com/insights/publications/2025/09/ftc-ai-chatbots
- https://www.bitdefender.com/en-us/blog/hotforsecurity/ftc-ai-companion-kids-safety
- https://techcrunch.com/2025/10/29/character-ai-is-killing-the-chatbot-experience-for-minors/?rand=23331
- https://sacra.com/c/character-ai/
- https://aicompanionpick.com/character-ai-cost-pricing-guide
- https://www.nbcuniversal.com/article/love-island-lets-viewers-join-fun-interactive-games
- https://apps.apple.com/app/id1465944282
- https://lewisroca.com/a-practical-guide-for-offering-online-contests-and-promotions-1
- https://calgaminglaw.com/what-constitutes-gambling
- https://red.applefritter.com/r/OriginalCharacter
- https://itch.io/post/14700778
- https://neuronfeed.com/startups/talkie-ai
- https://www.aigirlfriends.it.com/?p=174
