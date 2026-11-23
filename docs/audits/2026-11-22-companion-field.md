# Candy.ai and the field: what the top companion sites do

Research date: 2026-11-22. David: "for after dark it be something like Candy.ai or a similar site, do the research what
are other top sites doing? I want the dates, live chat, and nsfw to be best in class for text, sub copy, videos, live
chat, etc."

Looked at from public sources only: each site's own pages, help centers, docs and app-store listings where they load,
and recent reviews where they don't. No account was made, nothing was bought, no age gate was passed, and nothing
explicit was collected: layout, mechanics, prices and wording only. Every fact below carries its source and a mark:
**[own]** the vendor's own page read that day, **[2nd]** a review or other third party, **[?]** uncertain or inferred.
Much of the second-hand material is affiliate or competitor-owned; the last section lists what couldn't be verified.
joi.com has its own teardown ([2026-11-20-joi-teardown.md](2026-11-20-joi-teardown.md)).

## The short version

1. **Nobody at Candy's end of the market does live lip-sync.** Candy, OurDream, Secrets and DreamGF sell an audio call
   by the minute over a picture, a loop or nothing at all; Candy's "Live Action" is reported to be looped clips beside
   the chat. Kindroid is the one mainstream site with a documented real-time lip-synced avatar, as a paid add-on at
   roughly 9–15¢ a minute, and xAI retired its animated companion, reportedly over compute cost. A living loop with
   real-time voice **matches or beats the benchmark**.
2. **The catalog is the home page and a card opens the chat.** One click from a face to a conversation is table
   stakes; a profile or a set-up step first is the exception.
3. **The product is text you never run out of, with media on a meter.** Unlimited messages on the plan, a monthly
   grant of tokens for pictures, voice, calls and clips, and (at the better sites) every per-action price published.
4. **Where the best ones differ:** memory the user can read and edit, suggested replies with a tone label, a
   texting/prose switch, proactive messages inside quiet hours, a photo request built into the composer, and "make
   video" on every picture.
5. **Don't copy:** "video call" claims for looped clips, standing "-70%" badges, intro prices that double, tokens
   that expire or meters that read one thing and bill another, paid relationship-level skips, and "end-to-end
   encrypted" claims from a server that writes the replies.

## What Botchelor does with it

| # | What the field does | After Dark / the show today | Call |
| --- | --- | --- | --- |
| 1 | A card opens the chat in one click | **Built 2026-11-22 (#2078):** Step in on every After Dark character card and page, Continue where a scene is running ([after-dark.md](../after-dark.md), "One click"). The show's cards already had "Text {name}". | Done |
| 2 | A call is real-time voice over a still or a loop | **Built 2026-11-22 (#2077, #2080, #2082):** the loop is the face on a companion call, with a ring that swells with the voice; the swapped mouth stills are gone ([PRDs/digital-human.md](../PRDs/digital-human.md), "The loop is the face"). Live calls already had barge-in and a transcript. After Dark's call uses the same face. | Done |
| 3 | Voice playback on a reply; a call billed by the minute | **Built 2026-11-22 in Step in (#2079):** 🔊 Hear it on every reply, replies read aloud, and 📞 a call (the same scene said out loud, taking turns), on After Dark's own voice ([after-dark.md](../after-dark.md), "Voice and calls"). The show already had voice notes and live calls. | Done. **Talking over them, 2026-11-23:** in desktop Chrome the viewer starts talking and the character stops (the browser's own recognition on an echo-cancelled track, no speech-to-text provider); phones and other browsers take turns ([after-dark.md](../after-dark.md), "Talking over them") |
| 4 | The greeting is a one-line hook ending in a question, with two tappable starters | **Built 2026-11-22:** three starter lines under a new scene's opening, until the viewer has written something (`STEP_IN_STARTERS`: a tap fills the box, nothing is sent). The opening itself is still two to four paragraphs of prose. | Done; a shorter hook of an opening is a prompt change worth an eval |
| 5 | Three suggested replies with a tone label; a "write it for me" wand | **Built 2026-11-23:** up to three ideas under the newest reply (warm, playful, bold), each held to a written line's checks, a tap fills the box ([after-dark.md](../after-dark.md), "Ideas for what to say"). | Done |
| 6 | A texting/prose switch and a reply length | The show's companion has both. Step in writes prose, and since 2026-11-22 has a spoken form (a call's replies). | **Built 2026-11-23:** 💬 Talk in the composer: a written line answered in a line or two out loud, not prose ([after-dark.md](../after-dark.md), "Talk"). A reply length for prose is still open |
| 7 | A photo on request, from the composer; the character may send one unprompted | **Built 2026-11-23:** 🖼 Picture this under every reply in a Step in scene: the character alone at that moment, as the viewer sees them (the viewer is never drawn), on the night's own picture pipeline and checks, its price on the button before it's made, one of the month's pictures, kept under the reply ([after-dark.md](../after-dark.md), "A picture of this moment"). | Done; a picture sent unasked is still open |
| 8 | "Make video" on every picture, 5 s by default, price on the button | Animate exists on a night's pictures, and the Studio's Animate takes a Step in picture like any picture of one (an admin's of anyone, a person's of their own character). | **Next:** an Animate button on the picture in the scene, for everyone |
| 9 | Memory the user can read and edit, named on the plan page | **Built 2026-11-23 in Step in** (David: "I am fine storing that data"): 🧠 What {name} remembers, off until the viewer turns it on with its own consent, every fact theirs to change, pin or forget, deleted when it's turned off ([after-dark.md](../after-dark.md), "What they remember about you"). The show already had a memory page per companion. | Done; naming it on the plan page comes with the copy pass (#14) |
| 10 | Unlimited text on the plan; tokens for media; every price published | After Dark: a monthly count of scene steps, pictures, clips and voiced lines, tokens for extras, prices shown before anything is made, costs published at /costs. | **Built 2026-11-23:** a scene and a call say how many steps are left only once 25 or fewer remain ([after-dark.md](../after-dark.md), "The month's count is quiet"). **David's call:** a separate, much higher fair-use number for Step in replies (today 300 a month covers night steps and replies alike) |
| 11 | Proactive messages, inside quiet hours | The show: opt-in texts from your own character. After Dark: none. | Later, and only discreetly worded |
| 12 | A visible relationship that progresses, earned | The show's graph and dates. After Dark: nights and pictures counted per character. | Later; never sold as a level skip |
| 13 | Short videos as a door into chat | After Dark's Episodes and Shorts. **Built 2026-11-23:** "Step in with {name}" for each of the two under an episode's night ([after-dark.md](../after-dark.md), "One click": from an episode). | Done |
| 14 | A paywall that names the character and lists four or five concrete perks | The locked preview and the subscribe page. | Copy pass when a processor is live |
| 15 | A trust block by the pay button: statement name, cancel path, renewal price | Partly. | With #14 |

What already puts Botchelor ahead of the field, and is worth saying on the door: the characters have a life (a show,
dates, a season), a will of their own in a scene, limits the viewer sets per scene, real age verification, no real
people, and a published cost page. None of the sites above has more than one of those.

---

## Bottom line

- **Calls:** Kindroid is the only mainstream site with a documented real-time lip-synced call. Candy, OurDream, Secrets and DreamGF sell an audio call billed per minute. Candy's "Live Action" is reported to be looped clips beside the chat, not live video.
- **Common shape:** the home page is the catalog, one click opens the chat, and the greeting is a text hook. Photos come on request, replies can be played as voice, a picture becomes a 5 to 10 second clip for about $1 to $2, and the plan is unlimited text plus a monthly token grant.
- **Where the best differ:** memory you can see and edit, suggested replies with a tone label, a texting/prose switch, proactive messages with quiet hours, and published per-action prices.

**Marks:**
- **[own]** = text of the vendor's own page or docs, fetched today. I saw page text only, not rendered layout or motion.
- **[2nd]** = a review or other third party.
- **[?]** = uncertain, conflicting, or my inference.

Dollar-per-action figures are my arithmetic from the quoted pack prices.

## 1. The six priority sites

### Candy.ai (EverAI Limited, Malta)

- **Catalog:**
  - The home page is the catalog: H1 "Explore Featured Characters", tabs Girls / Anime / Guys, and "Premium -70%" in the nav [own](https://candy.ai/).
  - A character URL is the chat itself, with no profile step [own](https://candy.ai/ai-girlfriend/kenzie-whitaker).
  - Rows for a video builder, Shorts, "live" cam rooms and Live Action sit under the grid [2nd, OurDream-affiliated site](https://www.our-dream-ai.com/candy-ai-review/).
- **Chat:**
  - The first message is text only, a one-line hook ending in a question ("so tell me, are you here to be good or a little bad?").
  - The composer has an "Ask" button with starters "Show me…", "Send me…", "Can I see…", plus chips "a picture of you" and "Hi! Nice to meet you :)".
  - A "How to Prompt for Images" tutorial teaches the phrasing [own](https://candy.ai/ai-girlfriend/tru-kait).
  - "Realistic" characters send photos, voice notes and videos unprompted, which spends tokens; a toggle turns it off [2nd](https://www.roborhythms.com/candy-ai-pricing/).
  - The Auto Memory panel reads "Memories will start after sending 20 messages", and there is no model picker [2nd](https://companionhunt.com/apps/candy-ai/).
  - Premium has 3 memory slots; Premium Plus has 20, plus personas and chat clones [2nd](https://www.thecompanionindex.com/articles/01-candy-ai).
- **Pictures:** 2 tokens, or 4 for 18+ [2nd](https://www.thecompanionindex.com/articles/01-candy-ai). Other reviews say 4 flat [?].
- **Voice and calls:**
  - The paywall sells "AI Live Phone Call" [own](https://candy.ai/ai-girlfriend/kenzie-whitaker).
  - The call button shows 3 tokens a minute, "beta price", about $0.30 [2nd](https://www.our-dream-ai.com/candy-ai-review/).
  - The voice-note price is unpublished [2nd](https://www.roborhythms.com/candy-ai-pricing/).
  - No source describes the call screen. The public chat page carries the call as a header state: avatar, "Connecting...", mic/mute/end icons [?].
- **"Live Action" and "Cams":**
  - Live Action is a looping character video beside the chat. Actions unlock through XP levels or are bought (20/40/59 coins for levels 3 to 5).
  - It had 21 characters in October and is not generated live [2nd](https://www.aigirlfriendbase.com/en/news/candy-ai-live-action).
  - Reviewers quote the home page as "Video chat with her, live and unscripted" and the help center as a token-priced action menu [2nd, OurDream-affiliated](https://www.ourdream-ai.net/candy-ai-review/).
  - Candy Cams imitates a cam room. Tips start at 5 tokens and a "private live call" costs 24 tokens a minute [2nd](https://www.aigirlfriendbase.com/en/news/candy-ai-live-action).
- **Video:**
  - An in-chat "Scene Video" generator is priced at 12 tokens, with a "Switch to Video Mode" prompt [own](https://candy.ai/ai-girlfriend/kenzie-whitaker).
  - 5 seconds costs 12 tokens and 10 seconds costs 20, about $1.20 and $2.00 [2nd](https://www.thecompanionindex.com/articles/01-candy-ai).
- **Pricing** [own](https://candy.ai/subscriptions):
  - 12 months: $3.99/month, billed $47.88, "70% OFF", "BEST VALUE".
  - 3 months: $8.99/month, billed $26.97.
  - 1 month: $9.99 first month, "Then $13.99/month".
  - Free: 5 messages in total, one custom character, one image [2nd, citing help center and Terms](https://www.roborhythms.com/is-candy-ai-free/).
  - Token packs: $9.99 for 100, up to $299.99 for 3,750. Premium Plus (330 tokens) shows its price only inside an account [2nd](https://www.thecompanionindex.com/articles/01-candy-ai).
- **Retention:**
  - Romance Mode stages run Acquaintance, Friends, Flirting, Girlfriend, Soulmate; "Skip to Friends" costs 35 tokens [2nd](https://companionhunt.com/apps/candy-ai/).
  - Shorts give two free episodes, then 12 tokens each. Referrals pay 200 tokens to each side [2nd](https://www.roborhythms.com/candy-ai-pricing/).
- **Billing and safety:**
  - "Charge shown as 'EverAI' on your bank statement" [own](https://candy.ai/subscriptions).
  - Sign-up uses a click-through "I am over 18" gate [2nd](https://companionhunt.com/apps/candy-ai/).
  - Refunds only within 24 hours and with 20 or fewer tokens used [2nd](https://www.roborhythms.com/candy-ai-pricing/).
  - Real-person likeness is banned, except licensed "digital twins" with a disclaimer [own](https://candy.ai/community-guidelines).

### OurDream.ai (Dream Studio USA, Inc.)

- **Catalog:**
  - The home page is the grid. Cards show image, name, age, short description, view count, chat/like count and creator handle.
  - Cards link to `/chat/<name>-<id>`.
  - Filters: "Popular · Month", gender, "Any Style", "Any Age", and tag chips (Packs, Comics, Group Chats, RPG) [own](https://ourdream.ai/).
  - One reviewer says a card opens a character page first [?](https://nofilterreview.com/apps/ourdream-ai/).
- **Chat:**
  - The chat opens inside a scenario, with a suggested-reply bar above the composer and a wand that expands a rough line.
  - A side panel sets model, creativity, response length, writing style, voice, memory and persona.
  - "Auto Memory" shows a progress bar [2nd](https://nofilterreview.com/apps/ourdream-ai/).
  - There are seven models. Standard ones are free to subscribers; "Genius" costs 1 coin a reply [2nd](https://www.roborhythms.com/ourdream-ai-review/).
- **Media** (all [2nd, citing OurDream's coin guide](https://www.roborhythms.com/ourdream-ai-review/)):
  - In-chat image: 5 coins.
  - Video from an image: 100 coins per 5 seconds, up to 60 seconds.
  - Voice call: 50 coins a minute, about $0.50.
- **Call screen:** the character, the chosen voice, and a live coin meter that reads "1 per second" while billing 50 a minute [2nd](https://nofilterreview.com/apps/ourdream-ai/). There is no video call.
- **Pricing:**
  - $19.99/month, or $9.99/month yearly ($119.88); both include 1,000 dreamcoins [own](https://ourdream.ai/).
  - "5 free chats, no signup, no email" [own](https://ourdream.ai/comparison).
  - Deluxe is $59.99 with 5,000 coins [2nd](https://nofilterreview.com/apps/ourdream-ai/).
  - Free accounts get 5 messages per character and 55 coins once. Coin packs need an active subscription [2nd](https://www.roborhythms.com/ourdream-ai-review/).
- **Retention:** referrals pay 1,000 coins each, and there are creator leaderboards and paid community packs [2nd](https://nofilterreview.com/apps/ourdream-ai/).

### Nomi.ai

- **No catalog:** you build one companion. H1 "An AI Companion with Memory and a Soul" [own](https://nomi.ai/).
- **Memory:** short, medium and long term. Mind Map 2.0 is visible and editable; the Identity Core is not [2nd, citing Nomi's wiki](https://companionrank.com/review/nomi-ai).
- **Selfies:**
  - A camera button by the chat field. Selfies use the conversation, not a prompt [own](https://wiki.nomi.ai/How_do_Nomi_selfies_work%3F).
  - 40 requests a day on paid plans; no nude images [2nd](https://companionrank.com/review/nomi-ai).
- **Calls:**
  - Included with paid plans and unlimited on Nomi's own voices.
  - "replies are not instantaneous": it answers after you stop speaking [own](https://wiki.nomi.ai/Can_I_call_my_Nomi_and_how_do_hands-free_calls_work%3F).
  - No video call. The call screen is not documented.
- **Video:**
  - "Turn This Image Into A Video" makes a clip of about 5 seconds, SD or HD [own](https://wiki.nomi.ai/Video_Generator_Best_Practices).
  - It costs 6 or 10 credits once the daily allowance is spent [own](https://wiki.nomi.ai/What_are_credit_values%3F).
- **Pricing:** $15.99/month, $39.99/quarter, $99.99/year. Free is 50 messages a day [2nd](https://companionrank.com/review/nomi-ai).
- **Retention:** proactive messages, never between 10pm and 8am [2nd](https://aicompanionguides.com/blog/nomi-ai-late-to-party-worth-it/). I found no streaks or levels.

### Kindroid

- **No catalog.** H1 "Meet Your Kindroid"; "Quick text at lunch. Long call at midnight." [own](https://kindroid.ai/).
- **Chat tools** [own](https://kindroid.ai/v2/docs/chat-features-and-tools/):
  - Regenerate with a version counter, Suggest, Continue, Rewind.
  - A Wand that writes your message for you.
  - Proactive messages, voice notes, selfies or calls, with quiet hours.
- **Memory:** recalled memories are viewable per reply. Journal entries fire on key phrases, and "Learned Context" is editable [own](https://kindroid.ai/v2/docs/memory/).
- **Calls** [own](https://kindroid.ai/v2/docs/voice-calls-and-video-calls/):
  - Real-time; interruptions are "detected on an audio and word level".
  - Pause threshold 0.5 to 5 seconds, a transcript, and a text box on the call screen.
  - 400 credits a minute plus the voice's own credits.
  - The call image is the avatar, the chat background or a custom image.
- **Live Avatar** [own](https://kindroid.ai/v2/docs/voice-calls-and-video-calls/):
  - Made from one uploaded 2:3 photo; it can "lip sync and gesture naturally in real time".
  - "about 2,500" (Standard) or "about 4,500" (Premium) credits a minute on top of the call fee.
  - That is roughly $0.09 or $0.15 a minute at the in-app top-up price.
  - Your camera or screen can be shared so it sees you.
- **Pictures and video** [own](https://kindroid.ai/v2/docs/selfies-video-selfies-avatars/):
  - Autoselfie from the latest message.
  - Standard selfie credits refill every 30 minutes, up to 25.
  - Video selfies run 8 or 15 seconds for 2 to 10 credits.
- **Pricing:**
  - In app: $15.99/month, $42.99 for 3 months, $159.99/year. 500k audio credits cost $14.99 [own, App Store](https://apps.apple.com/us/app/kindroid-your-personal-ai/id6451038161).
  - Web: $13.99/month [2nd, competitor blog](https://beauties.ai/blog/ai-girlfriend-video-call).
- **Age check:** Yoti. The selfie estimate must read 21 or older, otherwise ID is required [own](https://kindroid.ai/v2/docs/age-verification/).

### SpicyChat.ai (NextDay AI)

- **Catalog:** selecting a character opens your latest conversation with it, not a profile [own](https://docs.spicychat.ai/product-guides/character-chats.md). The home page needs JavaScript, so I could not read the cards.
- **Chat:**
  - The creator writes the greeting. Regenerate (with arrows between versions), Continue, Edit and personas are available [own](https://docs.spicychat.ai/product-guides/character-chats.md).
  - "Rulebooks" put a meter such as Trust 0 to 100 at the top of the chat [own](https://docs.spicychat.ai/product-guides/rulebooks.md).
- **Memory Manager:** "search, add, pin, edit and delete", with entries labelled Auto or Yours, on all paid tiers [own](https://docs.spicychat.ai/product-guides/premium-features/memory-manager.md).
- **Pictures:** an icon draws the last reply. The face can drift because it uses one reference picture [own](https://docs.spicychat.ai/product-guides/premium-features/conversation-images.md).
- **Voice:** a Play button under each message, unlimited, top tier only. No calls and no video [own](https://docs.spicychat.ai/product-guides/premium-features/text-to-speech.md).
- **Pricing:** $5.95, $19.95 and $29.95 a month since 2026-09-08; existing subscribers keep their old price [own](https://docs.spicychat.ai/september-2026-pricing-update-faq.md). There are no tokens.
- **Age check:** video selfie or ID in the UK, France, Italy, Australia and 26 US states. NSFW is blocked until it is done [own](https://docs.spicychat.ai/advanced/age-verification.md).

### GirlfriendGPT (NextDay AI)

- **Catalog:** the home page is the catalog, with "For you / Explore", "Trending Now" and tag chips. Cards link to `/character/<slug>/chat` [own](https://www.gptgirlfriend.online/).
- **Pricing** (the plan page is behind login):
  - Premium $15 (5,000 messages, 400 coins), Deluxe $35 (20,000 messages, 1,200 coins), Elite $50 ("Unlimited", 2,000 coins).
  - Yearly billing is about 20 to 30% less [2nd](https://www.roborhythms.com/girlfriendgpt-review/).
  - Other reviews give other figures [?].
- **Media** [2nd](https://www.aigirlfriendbase.com/en/comparisons/candy-ai-vs-gpt-girlfriend):
  - Images about 6 coins.
  - Voice messages about 2 coins per 10 seconds.
  - Video up to 10 seconds, about 40 coins.
  - Voice calls need Deluxe and were "buggy during testing".
- **Other:** quests and rewards pay coins [2nd](https://beauties.ai/blog/girlfriendgpt-review). Processors are CCBill and TrustPay [2nd](https://www.roborhythms.com/girlfriendgpt-review/).

## 2. Lighter coverage

- **Secrets.ai** (the best-documented Candy-style site, all [own](https://wiki.secrets.ai/get-started/subscription-tiers-and-limits.md)):
  - Plans: free 20 messages a day; Premium $19.99 with 8,000 "Moments"; Ultimate $39.99 with 15,000.
  - [Calls](https://wiki.secrets.ai/create/audio-calls.md): 50 Moments a minute. The call is transcribed live and the audio is deleted.
  - [Chat](https://wiki.secrets.ai/get-started/chat-features.md): "SMS mode" or "Paragraph mode"; three suggested replies under "Your next move"; proactive messages on Ultimate only.
  - [Video](https://wiki.secrets.ai/create/video-generation.md): 4 to 15 seconds with lip-synced audio; 320 to 1,200 Moments per 5 seconds.
  - [Reels](https://wiki.secrets.ai/get-started/scenarios-and-reels.md): a vertical feed of scenario openers that end in "What do you say?" and open the chat.
  - [Billing](https://wiki.secrets.ai/extra/moments-and-payments.md): statement name "S LABS INC".
- **DreamGF** [own](https://dreamgf.ai/pricing):
  - $12.99 first month, then $25.98/month, with 150 tokens.
  - Voice call 6 tokens a minute, voice message 1 token, image 2 tokens; packs $9.99 for 100.
  - "100% Privacy (No adult transactions on bank statements)".
- **Kupid.ai** [own](https://www.kupid.ai/subscriptions):
  - Free: 15 messages. Pro "$3.44/week", Ultra "$5.75/week".
  - Weekly quotas for photos, videos and voice minutes instead of tokens.
  - A plan row reads "She Remembers: last 30 msg / last 100 msg".
  - No calls found.
- **Nectar.ai:**
  - Home page: "New: video calls are now live." [own](https://nectar.ai/).
  - The voice call supports interruption and has a transcript and a 1 to 5 star rating; how the video call renders is undocumented [own](https://docs.nectar.ai/media-generation/voice-chat-and-voice-messages).
  - Plans $9.99 / $19.99 / $34.99; calls only on the top plan [2nd](https://companionrank.com/review/nectar-ai).
- **FantasyGF:** its title tag copies Candy's word for word, with a "-75% OFF" badge and "Uncensored AI Live Phone Call" [own](https://fantasygf.com/).
- **Joi (new only):**
  - No public price page. US checkout in October: $13.99/month, $47.99/year.
  - "Live video calls" cost about 3,500 Neurons per five minutes, up from about 2,000 in July; packs start at $9.99 for 500.
  - That works out to several dollars a minute [2nd, ?](https://aicompanionguides.com/blog/joi-ai-review-2026/). How the face is rendered is undocumented.
- **Replika:** a 3D avatar. Calls: "Show what you're seeing and talk it through in the moment" [own, App Store](https://apps.apple.com/us/app/replika-ai-friend/id1158555867).
- **Character.AI:**
  - Calls are voice only, with tap to interrupt and a daily cap for free users [2nd, search summary](https://arcanumrpgs.com/blog/character-ai-voice/).
  - It filed for Chapter 11 on 2026-10-12 and is still running [TechCrunch](https://techcrunch.com/2026/10/13/just-5-years-in-interactive-chatbot-platform-character-ai-files-for-bankruptcy/).
- **Grok / Ani:**
  - The 3D avatar with real-time voice and lip sync was retired around 2026-09-01; xAI reportedly cited compute cost [2nd](https://www.roborhythms.com/grok-companions-discontinued/).
  - The studio behind it now sells "Animates" at $7.99 to $39.99 a month [2nd](https://aicompanionguides.com/blog/animates-app-first-look-2026/).
- **Janitor AI:** free unlimited text; paid perks are context and speed; payments by Stripe [own](https://help.janitorai.com/en/article/faq-subscriptions-1o8ccf2/).
- **CrushOn:** text-first, sold in message credits ($5.99 for 2,000) [2nd, weak source](https://crushon-ai-nsfw.pages.dev/pricing/).
- **Muah.ai:** real-time phone calls, US only, glitchy in testing [2nd, partly stale](https://aicompanionguides.com/blog/muah-ai-nsfw-platform-review/).

## 3. Comparison table

No site was confirmed to open with a picture: Candy and SpicyChat greet in text, Secrets can open from a reel video, and the rest are unverified.

| Site | Card opens chat in one click | Voice notes | Calls, and what is on screen | Video generation | Visible memory | Plan price | Tokens |
|---|---|---|---|---|---|---|---|
| Candy | Yes [own] | Yes, price unpublished [2nd] | Audio, 3 tokens/min [2nd]; screen unverified [?]; "Live Action" is looped clips [2nd] | 5 s for 12 tokens, 10 s for 20 [own/2nd] | Auto Memory panel, 3 slots [2nd] | $13.99/mo, $3.99/mo yearly [own] | 100/mo, about $0.10 each [2nd] |
| OurDream | Yes, by link pattern [own] | Narration, price unpublished [2nd] | Audio, 50 coins/min; character plus coin meter [2nd] | 100 coins per 5 s [2nd] | "Auto Memory" bar [2nd] | $19.99, $9.99 yearly [own] | 1,000/mo, about $0.01 each [2nd] |
| Nomi | No catalog | Unlimited [own] | Audio, flat price, turn-taking [own]; screen undocumented | About 5 s, 6 or 10 credits [own] | Mind Map, editable [2nd] | $15.99, $8.33 yearly [2nd] | Credits for overflow only [own] |
| Kindroid | No catalog | Yes; proactive notes free [own] | Real-time with interruption; still image, or lip-synced Live Avatar [own] | 8 or 15 s, 2 to 10 credits [own] | Journal, Learned Context [own] | $15.99 in app [own], $13.99 web [2nd] | Audio and selfie credits [own] |
| SpicyChat | Yes [own] | Play button, top tier [own] | None [own] | None | Memory Manager, full edit [own] | $5.95 / $19.95 / $29.95 [own] | None |
| GirlfriendGPT | Yes, by link pattern [own] | From Premium [2nd] | Audio on Deluxe; screen unknown [2nd] | 5 or 10 s, about 40 coins [2nd, ?] | Not found | $15 / $35 / $50 [2nd, ?] | 400 to 2,000 coins/mo [2nd] |
| Secrets | Reel or card [own] | 10 Moments per 100 characters [own] | Audio, 50 Moments/min; indicators and timer only [own] | 4 to 15 s, 320 to 1,200 Moments per 5 s [own] | Panel with importance levels [own] | $19.99, $9.17 yearly [own] | 8,000/mo [own] |
| DreamGF | Not checked | 1 token [own] | Audio, 6 tokens/min [own]; screen unknown | Not checked | Not found | $25.98 ($12.99 first month) [own] | 150/mo [own] |

## 4. Table stakes and differentiators

**Table stakes** (nearly every top site):
- The catalog is the home page, and a card opens the chat directly.
- A text greeting written as a hook.
- Unlimited text on the paid plan, with media metered in tokens.
- A photo on request and voice playback per message.
- Picture-to-video clips of 5 to 10 seconds.
- An audio call billed per minute.
- A yearly price shown as a low monthly figure beside a discount badge.
- A line promising a neutral statement name.

**Differentiators** (one or two sites each):
- Real-time lip-synced avatar calls (Kindroid).
- Memory the user can read and edit (SpicyChat, Secrets, Nomi, Kindroid).
- Proactive calls and voice notes with quiet hours (Kindroid).
- Suggested replies with tone labels, and a texting/prose switch (Secrets).
- Short-video feeds that open into chat (Secrets Reels; Shorts on Candy and Secrets).
- Visible relationship meters (SpicyChat Rulebooks; Candy Romance Mode).
- Calls with no per-minute charge (Nomi).
- Published per-action prices (Secrets, DreamGF).

## 5. Calls: what is on screen, and does anyone do real-time lip sync?

**What is on screen:**
- **Kindroid:** a still "call image" by default. With Live Avatar on, a face animated from one photo that lip-syncs and gestures in real time [own](https://kindroid.ai/v2/docs/voice-calls-and-video-calls/).
- **Secrets:** no picture at all. A microphone indicator, a processing indicator, the call duration and "End Call" [own](https://wiki.secrets.ai/create/audio-calls.md).
- **Nectar:** a round profile photo with a "Listening" status [own](https://docs.nectar.ai/media-generation/voice-chat-and-voice-messages).
- **OurDream:** the character and a running coin meter [2nd](https://nofilterreview.com/apps/ourdream-ai/).
- **Candy, Nomi, GirlfriendGPT, DreamGF:** not documented anywhere I could reach.

**Real-time lip sync:**
- **Yes, at Kindroid.** Its docs and App Store listing both say so. I am highly confident it ships; I have not seen its quality.
- **3D rigs, a different technique:** Replika and Animates (ex-Grok) use game-style 3D avatars, not a photoreal face.
- **Not at the Candy-style sites.** Candy's "Live Action" is looped clips with chat. Confidence is medium: two second-hand sources, one citing Candy's help center. OurDream and Secrets sell generated clips, not calls.
- **Unknown:** Joi and Nectar advertise "video calls" without saying how they render. My confidence is low either way.
- **Field reports:** a competitor blog states "no mainstream AI girlfriend app offers a true live video call" [2nd](https://kissable.app/blog/best-ai-girlfriend-app-with-video). An affiliate tester found "a static image with a call timer running over it" and "looping stock clips" [2nd](https://nuder.ai/blog/ai-girlfriend-live-video).

**Build choice (my judgment):** a looping clip with listening, thinking and speaking states, plus real-time voice with interruption, matches or beats the benchmark. Lip sync would be a differentiator against Candy. Only one mainstream competitor ships it, as an add-on at about $0.09 to $0.15 a minute, and xAI dropped its avatar companion, reportedly over compute cost.

## 6. Takeaways, ranked by likely impact

The ranking is my judgment; no site publishes conversion data.

1. **Open the chat in one click, with a one-line greeting that ends in a question and two tappable starters.** Candy's character URL is the chat, and its chips read "a picture of you" and "Hi! Nice to meet you :)" [own].
2. **Put the photo request in the composer.** Candy uses an "Ask" button with three sentence starters and a tutorial [own]; Secrets shows a photo offer under the reply to accept [own].
3. **Name the character in the paywall and list four or five concrete perks.** Candy's reads "Upgrade to Unlock Tru Kait", "With subscription you get access to:" [own]; free allowances are tiny everywhere (5 messages, 5 chats, 15 messages).
4. **Sell unlimited text plus one monthly grant, and publish every per-action price.** OurDream reportedly says 67% of subscribers use under their 1,000 coins [2nd]; unpublished token prices are the main complaint about Candy [2nd].
5. **Make the call real-time with interruption, a visible cost meter, a saved transcript and a rating at the end.** Kindroid, Nectar and Secrets each document parts of this [own].
6. **Use a looping clip with clear states on the call screen and call it a voice call.** See section 5.
7. **Show memory, let the user edit it, and state it on the plan page.** SpicyChat labels memories Auto or Yours [own]; Kupid sells "She Remembers: last 100 msg" [own].
8. **Put "make video" on every picture, default to 5 seconds, and show the price on the button.** Candy prices its in-chat Scene Video at 12 tokens [own]; Secrets delivers the clip as a message from the character [own].
9. **Offer a texting/prose switch and a reply-length setting.** Secrets has "SMS mode" and "Paragraph mode" [own]; OurDream has response length and writing style [2nd].
10. **Offer three suggested replies with a tone label, and a "write it for me" wand.** Secrets labels them Mild, Flirty or Spicy [own]; Kindroid and OurDream have the wand [own/2nd].
11. **Send proactive messages inside quiet hours, including a free voice note.** Kindroid's proactive voice notes cost no credits [own]; Nomi never sends between 10pm and 8am [2nd].
12. **Let the relationship progress visibly and unlock content, earned rather than bought.** Candy has five Romance stages and SpicyChat a Trust meter [2nd/own]; Candy also sells level skips, which I would not copy.
13. **Send unprompted pictures or voice notes, with an off switch and no surprise charge.** Candy's Realistic mode does this but spends the user's tokens [2nd]; Kindroid has a "Proactive selfies" toggle [own].
14. **Use short videos as a front door into chat.** Secrets Reels end in "What do you say?" and open the chat with that reply [own]; Candy gives two free Shorts episodes [2nd].
15. **Put a trust block by the pay button: statement name, cancel path, renewal price.** Candy and DreamGF both do [own].

## 7. Copy patterns

| Use | Line | Site |
|---|---|---|
| Headline | "An AI Companion with Memory and a Soul" | [Nomi](https://nomi.ai/) |
| Headline and subhead | "Your AI Girlfriend. Your Kind of Connection." / "Find an AI girlfriend to share your day, explore a story, or enjoy a little romance." | [OurDream](https://ourdream.ai/ai-girlfriend) |
| Feature line | "Quick text at lunch. Long call at midnight." | [Kindroid](https://kindroid.ai/) |
| Headline | "Your ride-or-die is waiting" | [FantasyGF](https://fantasygf.com/) |
| Paywall | "Upgrade to Unlock Tru Kait" / "With subscription you get access to:" | [Candy](https://candy.ai/ai-girlfriend/tru-kait) |
| Plan bullets | "Unlimited text messages" · "100 tokens per month" · "Create your own AI Girlfriend(s)" | [Candy](https://candy.ai/subscriptions) |
| Memory as a plan row | "She Remembers: last 30 msg / last 100 msg" | [Kupid](https://www.kupid.ai/subscriptions) |
| Billing | "Charge shown as 'EverAI' on your bank statement" · "Cancel subscription at any time in settings" | [Candy](https://candy.ai/subscriptions) |
| Pricing FAQ | "Why is ourdream more expensive than others?" | [OurDream](https://ourdream.ai/) |
| Buttons | "Talk to Her" · "Say Hi" · "Start Chatting" · "Join Free" · "Upgrade to Premium" | Kupid · Joi · Nomi · Candy · Candy |
| Reply prompts | "What do you say?" · "Your next move" | [Secrets](https://wiki.secrets.ai/get-started/scenarios-and-reels.md) |
| AI disclosure | "Images, chats, and other content here are AI-generated." · "Interactions here are fictional, consenting, and must comply with our Community Guidelines." | [Candy](https://candy.ai/ai-girlfriend/tru-kait) |

**What to avoid:**
- **"Video" claims for clips.** Candy reportedly calls looped clips "Video chat with her, live and unscripted" and runs cam rooms with simulated viewer chat [2nd].
- **Standing discount badges.** Candy shows "-70%" on every page against a $13.99 anchor [own]; Kupid shows "Autumn Discount 75% Off" with weekly prices and struck-through figures [own].
- **Intro prices that double.** DreamGF goes from $12.99 to $25.98 [own].
- **Hidden or mismatched meters.** Candy's token prices are unpublished; OurDream's meter says "1 per second" while billing 50 a minute [2nd].
- **Token traps.** Candy's tokens expire on cancellation while its help text says otherwise [2nd]; Joi reportedly charges the full call block when you hang up early [2nd].
- **Paid level skips.** Candy sells them [2nd].
- **"End-to-end encryption" claims.** OurDream, Secrets and FantasyGF make them [own]; a server that generates the replies has to read the messages, so I would not make that claim.

## 8. What I could not verify

- **Candy's help center** returns 403. Every help-center fact is second-hand: the call rate, Live Action rules, the free limit, Premium Plus.
- **Candy's call screen**, voice-note price, hover previews on cards, and whether the "-70%" badge is ever absent.
- **OurDream's help center** would not load. Coin costs and the Deluxe price are second-hand, and reviews disagree on the free limit.
- **GirlfriendGPT's plan page** is behind login. Its prices conflict across reviews, and its call screen is unknown.
- **SpicyChat's home page** needs JavaScript, so I could not read what its cards show.
- **Joi's call mechanics and Neuron prices**, and how Nectar's "video call" renders.
- **Nomi:** its call screen, and whether videos are about 5 seconds (wiki) or 5/10/15 seconds (one review).
- **Kindroid:** its web prices and monthly audio-credit allowance (prices are "shown at checkout").
- **Reddit:** no threads came back from search, so there is no first-hand user sentiment here.
- **Review-site bias:** much of the second-hand material is affiliate or competitor-owned. The `ourdream-ai` / `our-dream-ai` review domains promote OurDream, and beauties.ai, kissable.app, prelulu.ai and mel.us sell rival products.
- **Visuals:** I read page text only. Anything about layout, animation or picture quality is untested.
