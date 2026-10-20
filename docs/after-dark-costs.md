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
| OpenRouter | Scene text | Prepaid credit | Site settings, ends …5d38 |
| Venice | Explicit pictures (and later, video) | $50 | Keychain `vault/botchelor/VENICE_API_KEY`; site ends …-6kY |
| fal.ai | Sets (empty places) and non-explicit clips | Prepaid credit, valid 365 days, non-refundable | Site settings, ends …fa90 |
| Hive | The output check on every picture, clip and set | $111, auto-recharge off | Keychain `vault/botchelor/HIVE_SECRET_KEY`; site ends …Hw== |

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
| A set for a new place | fal set, Hive moderation | About $0.005, made once per place, ever |
| Set the scene (After Dark) | A set if the place is new; the next step is an ordinary step | $0 to $0.005 |
| Set the scene (filming date) | A set if the place is new; the move rides on the date's own lines | $0 to $0.005 |
| A 15 s video, standard | LongCat, 2 to 3 shots, Hive on the frames, a shot list from the text model | About $0.30 to $0.80 |
| A 15 s video, best | Wan 3.0, 2 to 3 shots, a still for each opening frame, Hive | About $2.00 |
| A 30 s video, best | Wan 3.0, 4 to 6 shots | About $4.00 |

Hive on a video is about $0.05 for 15 seconds and $0.09 for 30, if it samples about one frame a second. Confirm how
Hive counts video frames before relying on this.

## Tokens: what we charge

A token sells for $0.80 (the 5-pack is $4). After Stripe's fee that's about $0.72 a token. An adult card processor
(CCBill or Segpay, needed before After Dark is public) charges more, about 10 to 15%, which leaves about $0.68 a token.

Paid extras take **bought** tokens only. The weekly free tokens stay for dates. Admins don't pay.

| Extra | Tokens | We take in (after fees) | Costs us | We keep |
|---|---|---|---|---|
| Set the scene | 1 | about $0.70 | $0 to $0.005 | about $0.70 |
| A 15 s video, standard | 2 | about $1.40 | about $0.30 to $0.80 | about $0.60 to $1.10 |
| A 15 s video, best | 5 | about $3.50 | about $2.00 | about $1.50 |
| A 30 s video, best | 10 | about $7.00 | about $4.00 | about $3.00 |

- **Refunds:** Set the scene is refunded if the place is refused or, on a date, if they don't go. A video should be refunded if Hive discards it or the provider fails.
- **On a person's own Venice key:** a video costs them 0 tokens, just as a long date on their own keys does. We still pay the Hive check (about $0.05), which is too small to charge for.
- **Below 5 tokens a best-quality video barely breaks even**, because of the Wan 3.0 cost plus card fees.

## The video of the night (the main earner)

**What it is:** a short film of a whole night (`lib/adult/reels.ts`).
- The model picks its strongest lines across the night: how it starts, how it builds, the peak (rarely at either end), how it lands.
- Each line becomes one shot of the speaker saying it, starting from the pair's own pictures, which already passed the age check.
- **Voices (David's pick, 2026-10-19, after watching both tests):** Wan 3.0 speaks each line itself, from the prompt ("test A"). It sounded more real than a stock Kokoro voice lip-synced by Wan 2.6 ("test B").
  - The catch: the model chooses the voice per shot, so a character can sound slightly different from shot to shot.
  - B's own-voice path is still in the code: set the model to a Wan 2.6 one to use it.
- Hive checks every shot before it's kept. A discarded shot gives back its share of the tokens.
- The shots play in order, with each line as a caption.

**Settings:** the model, the number of shots and the price (`reel_model`, `reel_shots`, `reel_tokens`). The defaults are Wan 3.0, 6 shots (about 30 s) and 15 tokens.

| Default video (6 shots, Wan 3.0, about 30 s) | Cost |
|---|---|
| 6 shots × $0.65 (5 s each; a long line takes 10 s, $1.30) | $3.90 to $5.00 |
| Picking the lines (text model) | about $0.001 |
| Hive moderation on each shot, plus the age check | about $0.10 to $0.20 |
| **Total** | **about $4.00 to $5.20** |

At **15 tokens** we take in about $10.80 after Stripe's fee (about $10.20 with an adult processor), so we keep about **$5 to $6.50** a video. Test B's route (Wan 2.6 with our own voices) would cost about $3.50.

**Hive's limit:** self-serve allows 100 visual-moderation requests a day, and the only way to raise it is to contact Hive Sales. That's needed before real volume. The vision-language model (the age check) has no listed limit and costs $0.50 per million input tokens and $2.50 per million output, about $0.001 a check.

### What other sites charge (from reviews, October 2026; check before relying on them)

- **[OurDream](https://kissable.app/blog/best-ai-girlfriend-app-with-video):** about 100 coins for a 5 s clip and 300 for 30 s. 1,000 coins is about $10, so roughly **$1 for 5 s and $3 for 30 s**. It's video inside the chat, but with no voiced dialogue from the user's own story.
- **[GirlfriendGPT](https://www.callyourgirlfriend.com/ai-girlfriend-video-generator):** 30 coins for a 5 s clip, 60 for 10 s.
- **[Promptchan](https://il.ly/blog/nsfw):** about 20 to 28 credits a clip, on a paid tier only.
- **Candy.ai:** video comes out of a 100-token monthly allowance. [One review](https://www.startuphub.ai/ai-news/reviews/2026/best-ai-girlfriend-apps-2026) estimates real video spend at $25 to $60 a month.

Ours is priced above the clip sites on purpose. They sell a few seconds of motion; ours is the person's own night, in their characters' own voices, as a short film. At $12 (15 tokens) we're about 4 times OurDream's 30 s price. Lower it in settings if people don't buy.

## The subscription

After Dark opens only with a subscription and a passed age check. The monthly caps (in After Dark's settings) limit
what one subscriber can cost:

| Cap (each month) | Default | Most it costs us |
|---|---|---|
| Scene steps | 300 | About $0.30 |
| Pictures | 30 | About $0.45 |
| Clips (fal, non-explicit pictures only) | 5 | About $1 to $2 |
| **All of it, used to the limit** | | **About $2 to $3 a subscriber a month** |

At **$9.99 a month**, after an adult processor's fees (about $1.50), a subscriber who uses everything still leaves
about $5 to $6. Most won't use everything. Videos are paid in tokens on top of the subscription, so they never
eat into it.

Fixed costs not counted above:
- age verification: Yoti, Persona or Veriff, typically per check;
- the processor's monthly and setup fees;
- moving explicit storage off Vercel later (`docs/after-dark.md`).

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
