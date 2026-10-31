# After Dark: what everything costs

This is what each part of After Dark (the adult tier) costs to run, what we charge for it, and what we keep. Prices
were checked on 2026-10-19 from each provider's own pricing pages and APIs; they change, so re-check before setting a
public price. All amounts are in US dollars.

Related: the spec is `docs/after-dark.md` and the PRD is `docs/PRDs/after-dark.md`. The code is in `lib/adult/*`,
`lib/sets.ts` and `lib/scene-suggestions.ts`.

## Accounts and balances

Every provider is prepaid. Nothing recharges automatically, so the balance is the most any key can spend.

| Provider | Used for | Balance (2026-10-19) | Key |
|---|---|---|---|
| OpenRouter | Scene text (and the After Dark eval runs) | Prepaid credit: $50 loaded 2026-10-21 | Site settings, ends …5d38 |
| Venice | Explicit pictures (and later, video) | $50 | Keychain `vault/botchelor/VENICE_API_KEY`; site ends …-6kY |
| fal.ai | Sets (empty places) and non-explicit clips | Prepaid credit, valid 365 days, non-refundable | Site settings, ends …fa90 |
| Hive | The output check on every picture, clip and set | $111, auto-recharge off | Keychain `vault/botchelor/HIVE_SECRET_KEY`; site ends …Hw== |
| Replicate | The backup for After Dark's media (2026-10-22): pictures, keyframes, videos, voices | Prepaid credit (account smithdavedesign); keep auto-reload off, so the balance is the most it can spend | Keychain `vault/botchelor/REPLICATE_API_TOKEN`; production `REPLICATE_API_TOKEN` (Vercel until 2026-10-30, now the DigitalOcean apps' environment) |

fal's acceptable use policy bans sexually explicit output, and its request checker refuses it, so fal only makes
things with nobody undressed in them: empty sets, and clips from non-explicit pictures.

## Unit prices

| What | Provider and model | Price |
|---|---|---|
| Scene text | OpenRouter, `cognitivecomputations/dolphin-mistral-24b-venice-edition` | $0.20 per million input tokens, $0.90 per million output |
| Explicit picture | Venice, `lustify-v8`, 832×1104 | $0.01 a picture |
| Set (an empty place) | fal, `fal-ai/flux/schnell`, 16:9 | about $0.003 per megapixel, so about $0.002 a set |
| Picture moderation | Hive, `hive/visual-moderation` | $3 per 1,000 images ($0.003 each) |
| Age check on a picture | Hive, `hive/vision-language-model` | $0.50 per million input tokens and $2.50 per million output; about 1,860 in and 3 out per check, so about $0.001. No daily limit listed. |
| Text moderation (not used yet) | Hive, `hive/text-moderation` | $0.50 per 1,000 requests |
| A line's voice (voiced nights, `lib/adult/voice-lines.ts`) | Venice, `tts-inworld-1-5-max` since 2026-10-29 (David's pick, the settings' `voice_model`); `tts-kokoro` before | Inworld: $12.50 per million characters, about $0.0013 a line, about $0.10 a night. Kokoro: $3.50, about $0.0004 a line. Made once; a replay is free |
| A scene picture's brief (`lib/adult/picture-brief.ts`): what the chapter says at the moment | OpenRouter, `deepseek/deepseek-chat-v3.1:nitro` | about $0.001 a picture (read once per moment, kept) |
| Draw ahead (`lib/adult/draw-ahead.ts`), the viewer's choice | The chapter's pictures, drawn as their moments are written, and up to 4 more | We charge 1 token a chapter (`draw_ahead_tokens`), given back when none was drawn ahead; at most about $0.20 of pictures |

### Video (Venice quotes, 720p, made from a starting picture)

These came from Venice's own quote API. They are the price per generation.

| Model | 5 s | 10 s | 15 s | 30 s |
|---|---|---|---|---|
| LongCat (distilled) | $0.09 | $0.18 | $0.26 | $0.53 |
| LongCat | $0.25 | $0.51 | $0.76 | $1.52 |
| Wan 2.6 Flash (with sound) | $0.28 | $0.55 | $0.83 | 2 × 15 s, about $1.66 |
| Wan 2.2 Enhanced | $0.40 (5 s or 8 s only) | – | – | – |
| Wan 2.6 / Wan 2.7 | $0.55 | $1.10 | $1.65 | 2 × 15 s, about $3.30 |
| Wan 3.0 (and Wan 3.0 Reference) | $0.65 | $1.30 | $1.95 | $3.90 |
| Seedance 2.0 Fast | $0.76 | $1.51 | $2.27 | about $4.54 |

### Replicate, the backup (read from each model's page, 2026-10-22)

Replicate bills official models by what they make, and community models by GPU time. There's no self-serve monthly
limit any more (retired July 2025): the prepaid balance, with auto-reload off, is the cap.

| What | Model | Price |
|---|---|---|
| Explicit picture | `qwen/qwen-image` (official) | $0.025 a picture |
| A picture on the alternative | `adirik/realvisxl-v4.0` (community, L40S) | $0.000975 a second; Replicate's estimate is about $0.049 a run |
| Keyframe of the two of them | `qwen/qwen-image-edit-2511` (official) | $0.03 a keyframe |
| A shot, 5 to 7.5 s (81 to 121 frames at 16 fps) | `wan-video/wan-2.2-i2v-fast` (official) | $0.11 at 720p (what we send), $0.05 at 480p. With frame interpolation (not used): $0.145 and $0.065 |
| A shot's voice | `jaaari/kokoro-82m` (community, T4) | $0.000225 a second; about $0.0002 a line (about 1 s) |

A default video (6 shots) on Replicate:

| Default video on Replicate (6 shots, Wan 2.2 at 720p) | Cost |
|---|---|
| 6 shots × $0.11 | $0.66 |
| 6 keyframes × $0.03 | $0.18 |
| 6 voices | about $0.001 |
| Picking the lines and writing the shots (text model) | about $0.002 |
| Hive moderation on each shot, and the age check on each keyframe (since 2026-10-23 a keyframe has no moderation of its own: 6 fewer requests, about $0.02) | about $0.08 to $0.23 |
| **Total** | **about $0.95 to $1.10** (Venice: about $4.25 to $5.50) |

At 15 tokens that keeps about $9 to $10 a video, against $5.30 to $6.50 on Venice. The 4-shot bake-off (docs/after-dark.md, "A Replicate backup") costs about $0.56 of Replicate.

**The fallback costs more for pictures** (`media_fallback`, on by default; docs/after-dark.md, "Falling back to the other
provider"): when Venice is rate limited, out of credit or down, the job runs on Replicate, and a Replicate picture is
about $0.03 against about $0.015 on Venice (each with its checks), so every picture that falls back onto Replicate costs
about twice as much. A video falling back the other way, from Replicate onto Venice, costs far more ($0.65 a shot
against $0.11).

**Not known yet:** Venice doesn't publish which video models allow explicit output.
- The closed commercial models (Seedance, Kling, Veo, Grok) almost certainly refuse it.
- The open-weight ones (Wan, LongCat) are the likely candidates.
- Two 5-second test clips settle it: LongCat for $0.09, Wan 3.0 for $0.65.

## What each feature costs us

| Feature | What runs | Cost to us |
|---|---|---|
| One scene step (6 lines) | About 3,000 tokens in and up to 1,200 out | About $0.001 |
| One explicit picture | Venice picture, Hive moderation, Hive age check | About $0.015 |
| A character's baseline picture | Same as one picture, made once per character | About $0.015 |
| A chapter's or a new place's picture (automatic, 2026-10-23) | One picture of the two of them (Venice $0.01, or Replicate $0.025), Hive moderation and age check | About $0.015 on Venice ($0.03 on Replicate), one per chapter and per place; a 5-chapter night with 2 moves is about 7 pictures, about $0.10. Off with `auto_scene_pictures` |
| A set for a new place | fal set, Hive moderation | About $0.005, made once per place, ever |
| Set the scene (After Dark) | A set if the place is new; the next step is an ordinary step | $0 to $0.005 |
| Set the scene (filming date) | A set if the place is new; the move rides on the date's own lines | $0 to $0.005 |
| A 15 s video, standard | LongCat, 2 to 3 shots, Hive on the frames, a shot list from the text model | About $0.30 to $0.80 |
| A 15 s video, best | Wan 3.0, 2 to 3 shots, a still for each opening frame, Hive | About $2.00 |
| A 30 s video, best | Wan 3.0, 4 to 6 shots | About $4.00 |
| A clip on demand (one 5 s shot; `lib/adult/clips.ts`) | A keyframe of the two of them, Hive's age check on it, one shot, Hive's moderation on the shot; Clip from here adds a text call to direct it | About $0.70 on Venice ($0.04 keyframe, $0.65 Wan 3.0, about $0.02 Hive; a 10 s line $1.35), about $0.16 on Replicate ($0.03, $0.11, about $0.02) |
| Keep going (the next 5 s of a clip) | The same: a keyframe from the clip's own, a shot | The same as a clip |
| A picture from the shot menu (`lib/adult/pictures-menu.ts`) | One keyframe of the two of them (the act, outfit, framing and place as chosen), Hive on it | About $0.045 on Venice ($0.04, Hive about $0.004), about $0.035 on Replicate ($0.03) |
| A Short (`lib/adult/shorts.ts`, 2026-10-23): a saved night of two house characters, published | Nothing is made: it shows the night's own lines, a picture already made and its video when it has one | $0 to make. Watching it is free to the viewer (in the subscription, no tokens, not counted against the caps) and costs us only the transfer: its lines, and the video's files from the bucket (a presigned link) or Postgres, a few MB a video, kept by each viewer's browser |
| Call it (`lib/adult/predictions.ts`): a call on a Short, settled at play | Read from the night's own record: no model, no media | $0. The points are free and only free: nothing buys them, nothing they buy |
| Two sides of the night (`lib/adult/monologues.ts`): both monologues and both morning texts of a night | One text call: about 4,000 to 6,000 tokens in (two sheets, up to 160 lines, what they remembered), about 1,500 out; a second when the first can't be used | About 0.5¢ on DeepSeek V3.1 (pinned hosts), about 1¢ with the retry. Written once a night and kept: every read after is free |

Hive on a video is about $0.05 for 15 seconds and $0.09 for 30, if it samples about one frame a second. Confirm how
Hive counts video frames before relying on this.

## The subscription's allowance (#1005, 2026-10-30)

David, 2026-10-30: "follow a similar payment methodology [to competitors: a subscription that includes an allowance,
tokens for extras], but since we're brand new just break even overall is the goal until adoption is higher". So the
$12.99 a month (`AD_SUBSCRIPTION_PRICE_USD`; about $11.40 after an adult processor's 10 to 15%) includes:

| Included | Bound | Costs us at the most |
|---|---|---|
| Every chapter (`chapter_tokens` not taken from a subscriber), with its unasked pictures | `cap_writes`: 300 scene steps a month (fair use) | 300 × ~0.5¢ = about $1.50 of text, plus the chapters' pictures (counted in the 60 below) |
| Pictures from the shot menu, Redraw, Draw ahead (`menu_picture_tokens`, `draw_ahead_tokens` not taken) | `cap_pictures`: 60 a month | 60 × ~1.5¢ to 4.5¢ = about $0.90 to $2.70 |
| 3 short clips a month (`included_clips`, counted in `adult_usage.included_clips`, given back when one fails) | then `clip_tokens` each | 3 × about $0.70 on Venice = about $2.10 ($0.50 on Replicate) |

So a subscriber who uses every bit of it costs us about $4.50 to $6.30 against about $11.40 in: the rest pays hosting
and the free trials until adoption is higher. Extras are at about cost: a clip past the 3 is **1 token** (about $0.68 in
against $0.16 to $0.70), the video of the night **7 tokens** (about $4.75 in against $4.25 to $5.50). Code:
`lib/adult/pricing.ts`; labels say "included" (`lib/adult/price-words.ts`).

## Tokens: what we charge

A token sells for $0.80 (the 5-pack is $4). After Stripe's fee that's about $0.72 a token. An adult card processor
(CCBill or Segpay, needed before After Dark is public) charges more, about 10 to 15%, which leaves about $0.68 a token.

Paid extras take **bought** tokens only. The weekly free tokens stay for dates. Admins don't pay.

| Extra | Tokens | We take in (after fees) | Costs us | We keep |
|---|---|---|---|---|
| A chapter of a night (`chapter_tokens`, 2026-10-25): up to 120 lines, with up to `pictures_per_chapter` (3) pictures drawn unasked | included with a subscription since #1005; 1 for a viewer without one, taken when its first lines are written, given back if none come | about $0.72 (about $0.68 on an adult processor) | about $0.05 of text (about 10 steps on GLM-4.6) plus up to 3 pictures: up to about $0.09 on Replicate, $0.045 on Venice | about $0.54 to $0.62 |
| Set the scene | 1 | about $0.70 | $0 to $0.005 | about $0.70 |
| A 15 s video, standard | 2 | about $1.40 | about $0.30 to $0.80 | about $0.60 to $1.10 |
| A 15 s video, best | 5 | about $3.50 | about $2.00 | about $1.50 |
| A 30 s video, best | 10 | about $7.00 | about $4.00 | about $3.00 |
| A clip on demand, or Keep going (`clip_tokens`), past the subscription's 3 a month | 1 (3 before #1005) | about $0.72 (about $0.68 on an adult processor) | about $0.70 on Venice, $0.16 on Replicate | about $0 on Venice, about $0.50 on Replicate |
| A picture from the shot menu (`menu_picture_tokens`; it also counts against the month's 60 pictures) | included with a subscription since #1005; 1 without | about $0.72 (about $0.68 on an adult processor) | about $0.045 on Venice, $0.035 on Replicate | about $0.64 to $0.68 |

- **A chapter's pictures** (lib/adult/chapter-pictures.ts): the chapter's own, each new place's, one its lines ask for, and its moments drawn at the close all come out of the same `pictures_per_chapter` (3), earliest first; the moments that don't fit stay filed, not drawn. A picture the viewer asks for (📸 Picture this, the shot menu) isn't counted. Hive is the tighter limit: 3 pictures a chapter is about 30 chapters a day on the self-serve 100.
- **Refunds:** Set the scene is refunded if the place is refused or, on a date, if they don't go. A video should be refunded if Hive discards it or the provider fails.
- **A clip** (2026-10-22) is refunded in full when its keyframe or its shot is discarded by Hive or the provider fails, as a reel's shots are. A refusal before it starts (not reached yet, somewhere public, past the pair's limits) spends nothing. Its 10 s case (Clip from here on a long line, Venice only) still keeps about $0.70.
- **On a person's own Venice key:** a video costs them 0 tokens, just as a long date on their own keys does. We still pay the Hive check (about $0.05), which is too small to charge for.
- **Below 5 tokens a best-quality video barely breaks even**, because of the Wan 3.0 cost plus card fees.

## The video of the night (the main earner)

**What it is:** a short film of a whole night (`lib/adult/reels.ts`).
- The model picks its strongest lines across the night: how it starts, how it builds, the peak (rarely at either end), how it lands.
- **Each line becomes one shot of the two of them together** (since 2026-10-22; docs/after-dark.md, "Videos with both of them in"):
  - the model writes a still of that moment (where they are, how they're posed, the framing) and what they do next;
  - Venice's multi-image edit (`qwen-edit-uncensored`, $0.04) turns their two portraits, plus the night's drawn set when there is one, into one picture of both;
  - Hive's age check passes that picture (its moderation is the shot's, since 2026-10-23), and Wan 3.0 animates it.
- **Voices (David's pick, 2026-10-19, after watching both tests):** Wan 3.0 speaks each line itself, from the prompt ("test A"). It sounded more real than a stock Kokoro voice lip-synced by Wan 2.6 ("test B").
  - The catch: the model chooses the voice per shot, so a character can sound slightly different from shot to shot. The prompt gives each character the same voice words every shot ("a deep, warm man's voice").
  - B's own-voice path is still in the code (set the model to a Wan 2.5–2.7 one), but with two people in the shot it lip-syncs whichever face is clearest. On 2026-10-22 that put Dex's line on Lexi's mouth.
- Hive checks every shot before it's kept. A discarded shot gives back its share of the tokens.
- The shots play in order, with each line as a caption.

**Settings:** the model, the number of shots and the price (`reel_model`, `reel_shots`, `reel_tokens`). The defaults are Wan 3.0, 6 shots (about 30 s) and 7 tokens (15 before #1005, 2026-10-30).

| Default video (6 shots, Wan 3.0, about 30 s) | Cost |
|---|---|
| 6 shots × $0.65 (5 s each; a long line takes 10 s, $1.30) | $3.90 to $5.00 |
| 6 keyframes of the two of them × $0.04 (`qwen-edit-uncensored`) | $0.24 |
| Picking the lines and writing the shots (text model) | about $0.002 |
| Hive moderation on each shot, and the age check on each keyframe (since 2026-10-23 a keyframe has no moderation of its own: 6 fewer requests, about $0.02) | about $0.08 to $0.23 |
| **Total** | **about $4.25 to $5.50** |

At **7 tokens** (since #1005, 2026-10-30: break even) we take in about $5.05 after Stripe's fee (about $4.75 with an adult processor), so a video about breaks even (from about $0.50 kept to about $0.75 lost on a long one). At the old 15 we kept about $5.30 to $6.50. Test B's route (Wan 2.6 with our own voices) would cost about $3.50, but it lip-syncs the wrong face in a two-person shot.

**Hive's limit:** self-serve allows 100 visual-moderation requests a day, and the only way to raise it is to contact Hive Sales. That's needed before real volume. A video asks for one per shot: **6 for a 6-shot video** (and a clip 1). Until 2026-10-23 it was 12, because each keyframe had its own as well. Now a keyframe gets the age check only, and its moderation is its shot's: Hive's video moderation samples the shot's frames, the first of them the keyframe, and a keyframe is never shown on its own until its shot has passed (docs/after-dark.md, "Hive's daily limit"). So the 100 a day are about 16 six-shot videos, not 8. A picture shown as a still (a baseline, a scene or menu picture) still asks for one moderation request and one age check. The vision-language model (the age check) has no listed limit and costs $0.50 per million input tokens and $2.50 per million output, about $0.001 a check.

What happens when Hive stops answering (2026-10-23, `lib/adult/hive-limit.ts`; docs/after-dark.md "Hive's circuit breaker"): after two checks in a row couldn't run (a 429, a 5xx or no answer, after the check's own retries) a circuit breaker pauses every picture and video, for 5 minutes, doubling with each further failure up to 60 (or as long as Hive's Retry-After says, capped at 60). **Paused means no drawing spend:** a baseline, a scene or menu picture, an automatic chapter picture, a video, a clip, a set, a look tile or portrait, and a season portrait are all refused before Venice, Replicate or fal is called, the page says how long, and no tokens are spent. When the pause ends, one probe goes first, a moderation call on a plain grey picture (about $0.003, one of the day's 100). Down again means a longer pause; an answer closes the breaker. So an outage costs at most one probe per pause (about 1 an hour once it's at 60 minutes) while someone keeps trying, and none while nobody does, instead of a paid picture thrown away on every try (on 2026-10-23: 17 rejections in production, all 429, each drawn and paid for first). What it still costs: the two pictures drawn before the breaker opens (the first failure is treated as a blip), each thrown away with its tokens given back.

### What other sites charge (from reviews, October 2026; check before relying on them)

- **OurDream:** its [help centre](https://help.ourdream.ai/en/articles/10808513) charges 100 coins for 5 s, 20 coins a second for audio and +50% to extend. Plans give 1,000 coins for $9.99 to $19.99 a month, so a silent 5 s clip is about $1 to $2 and a voiced 30 s about 1,200 coins, **$12 to $24**. (A review's "300 coins for 30 s", which this page used before, understated it.) It's one character in a preset action, with no dialogue from the user's own story.
- **[GirlfriendGPT](https://www.callyourgirlfriend.com/ai-girlfriend-video-generator):** 30 coins for a 5 s clip, 60 for 10 s.
- **[Promptchan](https://il.ly/blog/nsfw):** about 20 to 28 credits a clip, on a paid tier only.
- **Candy.ai:** about 12 to 20 tokens for a clip of about 10 s (roughly $1.20 to $2.00 at $9.99 for 100 tokens). It shows one character, to camera, with the viewer as the partner; two people together appear only in its pre-made Shorts.

Ours is priced as a short film, not a clip: the person's own night, with both characters in it, in their own voices. At $12 (15 tokens) for about 30 s, we're level with OurDream's voiced price or below it. Lower it in settings if people don't buy.

### A three-tier image and video generator (pricing page, screenshot 2026-10-24)

An adult image and video generator's pricing page. David shared the screenshot; the site isn't named in it. Every plan
is shown as a daily price and billed monthly. Credits ("S") pay for generations, one credit per image.

| | Pro | Platinum ("Recommended") | Diamond ("Best value") |
|---|---|---|---|
| Price | $1/day, billed $30/month | $2/day, billed $60/month | $5/day, billed $150/month |
| Credits a month | 300 (up to 300 images) | 750 | 2,250 |
| Per credit | $0.10 | $0.08 | $0.067 |
| "Up to N refills" (in credits) | 30 | 75 | 750 |
| Who it's pitched at | images and nudes | videos and "extreme" content; faster queue, more credits | power users and creators: most credits, longest videos, top priority |
| "Extreme" generation | no | yes | yes |
| Videos | no | up to 6 s | up to 18 s |
| Extend a video | no | up to 12 s | infinitely |
| Extensions (add-ons) | up to 2 | up to 4, strength adjustable | up to 8, strength adjustable |
| Priority queue | no | over Pro | over Pro and Platinum |
| Queue size | 15 images | 45 | 100 |
| Upscale videos to 4K | no | yes | yes |
| Saved characters: stable face and body | no | yes | yes |
| Compilations (a cut of several clips) | up to 30 s, standard effects | up to 60 s, premium effects | up to 120 s, premium effects |
| Expand images (outpainting) | no | yes | yes |

**Every plan includes:** private generations, upscaled images, saved and reusable characters, face or pose reference
uploads, training your own model (marked with an asterisk, probably limited), editing a generation, and downloading
images and videos.

Not clear from the page: what a refill is (bought top-ups, or a daily refill), how many credits a video costs, and the
asterisked limits.

**What it means for us:**
- **Pictures are priced far below ours.** They charge $0.07 to $0.10 a picture inside the plan; our shot-menu picture is
  1 bought token, about $0.72. Our cost is about $0.035 to $0.045 a picture. We can't sell pictures at 7–10× their price
  for long; pictures likely belong inside the subscription (more than 30 a month), with tokens for videos.
- **They sell tiers, not tokens, for video.** Video, extending and longer clips are what lift a plan from $30 to $60 or
  $150; there's no per-video price. Ours is $9.99 a month plus 15 tokens (about $12) a 30-second video. A higher tier
  with some videos included would sit closer to how this market pays.
- **What they gate behind higher tiers is cheap for us:** priority, queue size and longer compilations cost little;
  stable face and body is what our baselines already do, for every subscriber.
- **Our edge isn't in their list.** Theirs is a generator: one person or a scene from a prompt. Ours is the person's own
  night between two characters, with both in every shot, in their own voices. That justifies a higher video price than
  a 6-second clip, not a higher picture price.
- **Volume would hit Hive first.** Hive's self-serve plan allows 100 moderation checks a day (see "Hive's limit"
  above), the real cause of the 2026-10-23 refusals. One Pro-style subscriber using 300 pictures a month is about 10 a
  day. Before offering anything like their picture volumes, Hive's limit has to be raised through Hive Sales.
- **Daily framing:** "$1/day" for a $30 month is a common anchor; worth testing on our subscribe page.

## The subscription

After Dark opens only with a subscription and a passed age check. The monthly caps (in After Dark's settings) limit
what one subscriber can cost:

| Cap (each month) | Default | Most it costs us |
|---|---|---|
| Scene steps | 300 | About $0.30 |
| Pictures | 30 | About $0.45 |
| Clips (fal, non-explicit pictures only) | 5 | About $1 to $2 |
| Voiced lines (each line made once; replays free) | 2,000 | About $0.70 on Venice (about 100 characters a line), about $0.40 on Replicate |
| Two sides of the night (each night written once; reads free) | 20 | About $0.10 to $0.20 |
| **All of it, used to the limit** | | **About $2 to $3 a subscriber a month** |

At **$9.99 a month**, after an adult processor's fees (about $1.50), a subscriber who uses everything still leaves
about $5 to $6. Most won't use everything. Videos are paid in tokens on top of the subscription, so they never
eat into it.

Fixed costs not counted above:
- age verification: Yoti, Persona or Veriff, typically per check;
- the processor's monthly and setup fees;
- moving explicit storage off Vercel later (`docs/after-dark.md`). Done 2026-10-30: DigitalOcean + Bunny, about $16 a
  month (`docs/after-dark-hosting.md`, `docs/costs.md`).

## How a video would be made

This is the design. It isn't built yet.

- **Inputs:**
  - each character's baseline picture, so faces and bodies stay the same across shots;
  - the set they're in;
  - for best quality, a still of each shot's opening moment, made with both baselines as references and passed by Hive's age check first.
- **Which part of the night:** never the opening or the closing lines by default. The most intense stretch is usually in the middle.
  - The text model reads the whole night and picks the 2 or 3 strongest moments.
  - Or the person taps a line ("make a clip from here").
  - Each shot is written from those lines' actions, which video models handle well, rather than the dialogue, which they don't.
- **Shots:** 2 or 3 shots of 5 to 7 seconds make up a 15 s video. One long shot drifts and loses the faces.
- **Dialogue:** as captions. Spoken voices would be a separate text-to-speech step at about $0.01 to $0.05.
- **The check:** Hive on every frame before anything is stored. A failure is discarded, never stored, and the tokens are refunded.
- **To help pick the moment:** record the stage of every line from now on, so the stage-5 stretch of a night is easy to find.

## What's still open

1. Which Venice video models allow explicit output. Run the two 5-second tests.
2. The age check's per-token rate on Hive (the vision model), from Hive's Usage page.
3. How Hive counts video frames.
4. Venice's terms hedge on adult content, while its API docs say adult images are open to every API user. Get Venice to confirm in writing before anyone but the admin uses this.
5. The subscription price, the adult card processor and the age-verification provider. These are David's calls.
