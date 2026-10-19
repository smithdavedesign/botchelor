# After Dark — safe, paid NSFW

The adult tier for Botchelor: consensual, fictional, 18+. It reuses the whole date engine (engine-decided
outcome, moves, memory, the repetition critics) and swaps only the **content-policy layer**. The point of this
doc is the parts that are NOT features: the three gates that make it lawful and the one that makes it money.

**Money model (David's call, 2026-10-18): the NSFW switch can only be turned on by an active _subscription_
account.** The subscription is the paywall. Admin-only (#280) stays as the private test mode.

> Status: #280 shipped the admin-only test scaffold (OpenRouter text + fal.ai images/clips, encrypted keys,
> per-scene consent, isolation, `request_after_dark`). This doc is the plan to take it from admin-test to a
> lawful paid product. Nothing here opens a user-facing door until the gates below are real.

## The entitlement gate (the money path) — #2

The NSFW switch is **per account and per character**, and a switch is toggle-able only when **all three** hold:

1. **`subscription.active`** — a current paid subscription (the paywall; billed on an adult processor, not Stripe).
2. **`account.age_verified`** — a real age-verification pass (see #4). Subscription alone is **not** legally enough.
3. **per-character `owner_consent`** — the owner opted this specific character in. A user's own characters and the
   house characters they date only; **never another user's character** (#280 already enforces this — keep it).

Make it a derived check, not a stored flag you trust:

```
canAfterDark(account, character) =
  account.age_verified && subscriptionActive(account) && consented(character, account)
```

Call `canAfterDark` **server-side on every after-dark action** — the page, each MCP tool, and each generation —
not only when the switch is flipped. When a subscription lapses or AV expires, the switch flips off and all
after-dark routes 404 again (the #280 isolation already does the 404; wire it to `canAfterDark`).

Admin test mode (the `x-frontier-key` path) stays as a separate bypass so you can tune quality without a
subscription. Keep the two paths distinct.

## #1 Output moderation — the most urgent hole (do before any image ships)

#280 filters our **prompts** but not the **images fal returns**. For NSFW generation that is the highest-risk
gap: a clean prompt can still return minor-appearing or nonconsensual imagery, which is a felony-and-platform-
death line. No generated image or clip is stored or served until it passes an **output** pass:

- **Age/subject classifier on the output** — reject anything that reads as a minor. (fal can run OpenAI's Omni
  moderation; add a dedicated age-estimation / CSAM classifier on top — e.g. Hive, AWS Rekognition, or Thorn
  Safer hashing against known CSAM.)
- **Nonconsent / illegal classifier** — reject NCII and the other hard lines.
- Pipeline: generate → **moderate output** → pass ⇒ store encrypted + serve; fail ⇒ discard, log a safety event,
  increment a counter; repeated fails ⇒ auto-disable that pair/account and alert the admin.
- **Until this exists, images stay off. Ship text-first.** Text is far lower risk and far cheaper; it is also
  where the "relationship, not raw explicitness" differentiator lives.

The two hard rules (no minors, no nonconsent) already apply to every line, steer and prompt — this extends them
to generated output, which is the one place they currently don't reach.

## #3 Payments — not Stripe (adult rules forbid it)

Visa/MC via Stripe/PayPal prohibit adult content, so the subscription runs on a **high-risk / adult processor**,
fully isolated from the existing Stripe setup (the botchelor Stripe account stays untouched).

- **Recommended primary: CCBill or Segpay.** Both do recurring subscriptions with a webhook/API; CCBill has the
  broadest developer docs (payment forms, API, webhooks, dynamic pricing); Segpay is strong on subscription
  management with a consumer self-service portal. Verotel/Epoch are common backups (a two-processor setup is
  normal in this industry).
- **Integration:** a new, isolated billing module (do not touch `lib/payments.ts`'s Stripe path). The processor's
  webhooks drive subscription state → `subscriptionActive`: `created/renewed` ⇒ active; `cancelled/expired/
  chargeback` ⇒ inactive ⇒ NSFW auto-disables.
- **Economics to expect:** adult merchant accounts take 3–10 business days to approve, need business/legal docs
  (possibly a separate entity), and charge markedly higher fees than Stripe (~10–15% vs ~3%). Price the
  subscription with that in mind.

**David provisions:** open a CCBill (or Segpay) merchant account, set it up, hand the API/webhook credentials to
the keychain (`~/ai-stack/bin/secrets`, never in a file). Propose: start with one processor; add a backup later.

## #4 Age verification — now legally mandatory, not optional

As of mid-2026 roughly **26 US states require age verification for adult content** (post *Free Speech Coalition v.
Paxton*, upheld by the Supreme Court in 2025). A self-attest checkbox is not compliant once a real user can turn
NSFW on for money.

- **Put AV in the subscribe flow**: verify once, re-verify per state rules (e.g. Tennessee requires an on-device
  check with 60-minute re-checks; Florida requires an anonymised check by a US-controlled business). Store only a
  **pass/fail + method + timestamp**, never the ID document itself (privacy, and it reduces your own liability).
- **Providers:** Yoti, Persona (facial age estimation at scale), Veriff (document-based). Trade-offs differ and
  one privacy audit flagged Yoti for collecting more than necessary — weigh privacy. None has been confirmed here
  to satisfy a specific statute.
- **This needs real legal counsel for the state-by-state specifics** — that's beyond what the code can decide.
  Flag it to David as a required step, not an engineering choice.

**David provisions:** choose an AV provider, sign up, keychain the key; get counsel on the state matrix.

## #5 Margin guard — don't let a subscriber cost more than they pay

fal.ai image and especially **clip** (video) generation is expensive; a subscriber cranking out clips can cost
more than their subscription. Protect margin with either:

- a **per-subscription monthly generation budget** (N images, M clips), then BYOK or a top-up to go further; and/or
- **BYOK-first for NSFW text**: run the heavy text generation on the *user's* own OpenRouter key, so you monetise
  **access** (the unlocked UI + character continuity) rather than paying per explicit generation. This also cuts
  your exposure. Images on the platform key stay hard-capped.

Track cost-per-subscriber; alert when a subscriber's generation cost exceeds a set share of their price.

## #6 Hosting & model terms — confirmed risks

- **Vercel is not a confirmed-safe host for explicit content.** Its Acceptable Use Policy bans "obscene" and
  "sexually exploitative" material and CSAM/NCII/deepfakes, and is silent on lawful consensual adult content; a
  Vercel moderator told a similar asker to email `registration@vercel.com`. **Assume explicit content — above all
  stored images — needs separate, adult-permissive infra** (an adult-OK object store, possibly a separate
  deployment/subdomain for the adult tier). Email Vercel to confirm before any user traffic; isolate storage
  regardless.
- **OpenRouter**: its terms defer to each model's provider terms. Pick a text model whose provider permits adult;
  don't assume a blanket allowance.
- **fal.ai**: has its own NSFW policy (bans CSAM/NCII, runs OpenAI Omni moderation on inputs) but hosts
  third-party models with their own rules — **the #280 default `fal-ai/flux/dev` is Stability-based, and Stability
  prohibits explicit output**, so it will refuse or violate its ToS. Choose an explicitly adult-permissive image
  model, and still add output moderation (#1) — fal's input moderation is not enough.
- Set a **spend cap at every provider** when you create the key (`secrets add --cap`), and record it so the
  nightly scan sees it.

## Build order

1. **Output moderation (#1)** — or keep images off and ship **text-first**. Safety, first.
2. **Entitlement gate (#2)** — `canAfterDark` = subscription + AV + consent, checked on every action; auto-disable
   on lapse. Keep admin bypass for testing.
3. **Adult payment processor (#3)** — the dependency that makes #2's "subscription" real. David provisions.
4. **Age verification (#4)** — in the subscribe flow; David provisions + counsel.
5. **Margin guard (#5)** — caps / BYOK text.
6. **Hosting + model ToS (#6)** — isolate explicit storage off Vercel; adult-permissive models; spend caps.

Nothing opens to a paying user until 1–4 are real. Keep the PG product the default and fully separate; After Dark
is opt-in, age-verified, subscriber-only, and isolated.
