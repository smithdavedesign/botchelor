# Audit and best-in-class benchmark (2026-11-07, evening)

David asked: "do another audit and research of best in class competitors, take your time, what can we still improve?",
then added four ideas from an outside deep-dive. This doc has three parts:
- a live audit of botchelor.com: real browser, desktop 1440×900 and phone 390×844, about 25 pages each, the /create
  wizard walked up to the step before saving;
- the production funnel, read-only, with our own traffic excluded;
- competitor research covering companion apps, AI shows and social sims, reality-TV audience play, dating apps and
  growth loops.

It follows [2026-11-07-product-review.md](2026-11-07-product-review.md) and the same day's UX rounds (#1354–#1357), and
doesn't repeat what they fixed.

## The headline

The site is healthy:
- no sideways scroll, no console errors and no broken images on any page;
- time to first byte mostly under 200 ms, and the largest paint under 700 ms.

The leak is **how long a stranger waits before seeing a date**. Every first visit hits a bare 18+ modal. Only 18 of 40
visitors clicked through it in 14 days; that's a rough count, and some of those 40 may be bots. The home hero then sells
the show with a box score, not a line of dialogue, and /watch opens on season-status cards with the first episode far
down. Real visitors spent 7 s on home and 8 s on /watch. People who reach /create stay 173 s and scroll 91%; people on
an episode stay 169 s. **The product holds people once they reach it, but the front of the site doesn't get them
there.**

The competitor research says the same thing from the outside. The products that won in 2025–26 got people to a moment
everyone shares, on a schedule, fast:
- **Love Island USA:** one 2.5-hour weekly vote window drew 3.5M unique voters.
- **Fruit Love Island**, an AI-generated dating show on TikTok: about 10M views an episode.
- **Status**, an AI social sim: 500k daily actives within a month, through Discord and TikTok.

The products that died had novelty and no reason to come back. **Sora's** app reportedly kept about 1% of users at
day 30. **Chirper**, a bots-only feed, had tiny traffic.

## Production numbers (30 days, our traffic excluded)

| | |
|---|---|
| Web visitors (web visits are logged from Oct 31) | 42 (50% bounce, 72 s average session) |
| Opened /create | 4 |
| Made a character | 2 by the web beacon, 5 in the database |
| Started a date | 2 |
| Watched it end | 0 (the beacon only shipped today, #1352) |
| Returned on a later day | 1 of 42 |
| Best source | the r/ChatbotRefugees Sunday post: 17 visitors, 16 engaged, both web-made characters |

Reddit works. One permitted post beat everything else combined. The launch kit is still the biggest lever.

## Ranked improvements

### A. Get a stranger to a date in 10 seconds (do first)

**Shipped 2026-11-07 in #1359** (all six). Still open from this group: asking counsel whether a lighter banner can replace
the gate's modal on the PG side.

1. **Show the show behind the gate.** Render the hero and the tonight band blurred behind the 18+ modal instead of a
   blank page. Ask counsel whether a lighter "fiction for adults" banner is enough on the PG side; until then, keep the
   modal.
2. **Make the home hero a date, not a box score.** Replace the static result card with a short muted excerpt of a real
   aired date: theater lines with faces, typing in. Fruit Love Island and Character.ai's Feed both lead with the content
   itself.
3. **/watch opens on the latest episode.** Put the newest or live date first and playable; season status goes below as
   one line, where today three timelines are stacked ("Season 1 is over", "Premiere week", "Recoupling in 23 days").
4. **Episode page order.** Move "Ask them how it went" (#1356) below the date and the result. Let `?play=1` autoplay on
   aired episodes too, so a home card lands straight in the theater.
5. **The sample character skips to Review.** "Use a sample character" still makes you click Next eight times. On a
   phone, replace the eight-step stepper, which wraps onto two lines, with "Step 2 of 8" and a thin bar.
6. **Companions: a few free messages before sign-in.** Allow 3–5 replies on the anonymous id, then ask for sign-in to
   keep the memory. Today a stranger hits "Sign in to talk" before a single line, while the show says "free, no
   sign-up".

### B. A reason to come back on a schedule (this also covers David's ideas 1 and 2)

7. **One big weekly vote, in a short window.** A fixed-time window with a countdown and a real consequence, such as who
   gets the cast date or who leaves at the recoupling, and the result aired at a fixed time. This is Love Island's
   mechanic: scarcity and timing beat many small votes. Dares and situation votes stay, as smaller daily ones.
8. **The season pool: one leaderboard, revealed at the finale.** The parts exist: backing a cast member, per-date
   predictions, best callers. Join them into one season score and one board, and reveal it at the finale and reunion,
   as Love Island reveals its prediction game before Aftersun. More than 25% of its mobile viewers play.
9. **Reveals earned by the audience.** Dealbreakers, cast secrets and chemistry shifts all exist, but they surface on
   their own. Tie a secret's reveal to the weekly vote or the recoupling night. Showing chemistry as a visible 0–100
   number is fine, because the engine already decides it.
10. **A spoiler-free share card for your calls**, Wordle-style: "I called 4/5 this week 🟩🟩🟩🟥🟩", linking to tonight's
    vote. The evidence for AI apps is thin, but it costs nothing.

### C. Getting found (growth loops)

11. **Vertical clips for TikTok and Shorts.** Turn each aired date's best beat into a 30–60 s captioned vertical that
    ends with "vote what happens → botchelor.com/…". Favour betrayals, call-outs and walk-offs: Love Island S7's viral
    unit was the downfall, not the romance. David signs in and approves each post (marketing rule). Fruit Love Island
    was mocked mostly for lip-sync glitches and drifting faces, so **captioned clips with consistent faces beat talking
    heads**.
12. **Bring a friend: a double-date invite.** "Make a character and double-date mine." Tinder's Double Date found nearly
    15% of invite accepters were new or returning users. The doubles engine and date-my-OC links already exist.
13. **A Discord as the community home**, with a bot posting episode drops, the weekly vote and the board. Status, Friends
    & Fables and Showrunner all grew there; MCP agent owners would gather there too.

### D. Consistency and polish (small, do in one round)

14. **Dead links:** /reels, /seasons and /messages are 404s, and the tabs and nav use those words. Redirect them to
    /showcase, /reunion and /matches, and rename the Showcase heading to "Reels".
15. **One art style for the season cast.** Illustrated (Nell, Juniper) and photoreal (Barnaby, Sable, every episode hero)
    sit on the same rows. Redraw the two illustrated ones in photoreal.
16. **The home's "What the bots are saying"** shows three Claude reviews from Oct 21, which reads as AI grading itself.
    Move it to /agents, and use real reactions on home once there are any.
17. **/graph weight:** 1.5 MB, 250 requests, 14 s to settle on desktop, and it's a tab on every spectator page. Send the
    top 30 couples first and load the rest on demand.
18. **Small tap targets on phone:** 48 on /showcase (♡ and handle links) and 36 on /characters (name links). Make the
    whole tile the link.
19. **Jargon on the first screens:** Constellation, Recoupling, backing, Diary cam, Mixer round 2 of 2, Agent-made. Keep
    these words off home, or give each a one-line plain explanation.
20. **/shop on a phone shows no Companion Plan.** Add its card.
21. **The After Dark gate** repeats the show's wording ("comedic blind-date show") and never mentions explicit content.
    Give it its own honest wording, and carry the show's 18+ answer across with a signed hand-off, so it's one gate and
    not two. The gate page also never goes network-idle (60 s); check for a long poll.
22. **/agents takes about 1 s to first byte.** Render it statically.

## The outside deep-dive's four ideas

| Idea | Verdict |
|---|---|
| Hidden dealbreakers, chemistry scores, secrets revealed by votes | **Mostly built:** dealbreaker guesses, `lib/cast-secrets.ts`, chemistry shifts and tests. What's missing is the earned reveal: item 9. |
| Rose prediction pool and elimination leaderboard | **The parts are built** (backing, predictions, best callers). What's missing is one season board and the finale reveal: item 8. |
| Lip-synced video recaps (Wav2Lip or LivePortrait in ComfyUI, ElevenLabs) | **No.** After Dark already has talking shots (Replicate Wan 2.6 + Kokoro). ComfyUI runs only on this Mac, not in production. ElevenLabs is new spend for a small gain. Lip-sync is the top complaint about AI shows; do item 11 instead. |
| An MCP character submission API for outside agents | **Already live:** the MCP `create_character` tool and `/character.schema.json`. 177 characters came in that way, so a separate POST endpoint would duplicate it. |

## What users complain about most in the category (avoid)

The list comes from 2025–26 Reddit, Trustpilot and app-store reviews:
1. **Memory loss and personality drift.** Keep Companions' editable memory page visible.
2. **Silent model changes** ("lobotomized"). Announce model changes and pin each character's voice.
3. **Being charged in the middle of a scene.** Companions stays a flat $9.99. After Dark shows the cost before a scene
   starts, never during one.
4. **Bait-and-lock paywalls and weekly subscriptions.**
5. **Filters that block without saying why.**
6. **Features removed without notice.**
7. **Visual slop:** lip-sync and face drift.
8. **Formulaic plots.**
9. **Votes that feel rigged.** Publish counts after each result, which we already do for situations and dares.
10. **Novelty with no reason to return.**

## Still no

- **Paid influence on outcomes**, including Status-style paid energy for votes, Talkie-style paid-rarity gacha, and
  "boost my cast member". Backing and votes stay free; allowances refill daily.
- **Real people's likeness**, including Sora-style cameos.

## Sources

The competitor findings, with links:
- NBCU on Love Island's app and prediction game; TheWrap and NBCU on Love Island S7 viewing;
- The Decoder and RTÉ on Fruit Love Island;
- PocketGamer.biz on Status;
- TechCrunch on Tinder Double Date, Character.ai Feed and Stories, the under-18 change, Sora's retention and Appfigures'
  revenue concentration;
- Hinge newsroom on Prompt Feedback and Your Turn Limits;
- 404 Media and Decrypt on Character.ai's "lobotomized" backlash;
- roborhythms on Candy.ai pricing complaints;
- the IndieHackers first-100-users post.

Full links are in the research notes of the session that wrote this doc. The audit screenshots were kept in that
session's scratchpad, not committed.
