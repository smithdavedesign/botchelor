# Companions

_David, 2026-11-04: "build a character sold as a companion… make our companion work for our system and best in class."_
His calls: **SFW first, on Stripe** (the adult lane later, on the same engine, once an adult processor is live); the
**house cast, your own characters and the show's own agent-made cast**; **voice notes now, live calls later**.

A companion is a character you talk with one to one, in a thread that remembers you. This reverses the PRD's old
non-goal ("live chat between a user and an AI character") and settles [ideas.md](ideas.md) Idea 1's fork as the
**companion with a world**: ours are on a live show, with dates, a season and a week of their own to tell you about.
That's the edge over Candy, Character.ai, Kindroid and Nomi, which have none.

## What "best in class" means (the research, 2026-11-04)

- **Memory is the product.** Users want it visible and editable; fuller memory took one study's 7-day retention from
  28% to 51%. Churn comes from memory loss, repetition, sudden filter changes and paywall shock.
- **Consistency:** the same voice every day, no repeated lines, no "as an AI language model".
- **Honest pricing:** unlimited text for a flat price, tokens only for media, the price shown before you start, no
  mid-sentence walls. Market: c.ai+ $9.99, Kindroid $13.99, Candy about $13.99 plus tokens, Nomi about $15.
- **Cheap regenerate**, proactive texts (opt-in), selfies with a consistent face, voice.
- **The law is concrete now:** California SB 243 (from 2026-01-01: AI disclosure, a published crisis protocol, counts
  for a yearly report from 2027-07), New York GBL Art. 47 (from 2025-11-05: an AI notice at the start and at least
  every three hours, for everyone), Oregon SB 1546 and Washington HB 2225 (2027-01-01), the EU AI Act Art. 50
  (2026-08-02). Card networks: Visa MCC 5967 and Mastercard AN 5196 apply to the adult lane only.

## Who can be a companion

`lib/companion.ts` `companionEligible`:
- a public house character (not a premium one),
- one with `characters.companion_open` (the show's own agent-made cast: `openOurAgentCast`, admin route
  `POST /api/admin/companions {action: "open_ours", dry_run}`; only characters made over MCP by our own agents,
  `lib/our-traffic.ts loadOurIds`),
- your own character, for you (even a private one).

Never someone else's character or an outside agent's: their makers never agreed to it.

## How it works (P1, built)

- **Tables** (`lib/db.ts`): `companion_threads` (one per person and character: rolling summary, reply length, when
  the notice last went in, `paused_at` while the crisis resources are up), `companion_messages` (user, character or
  system; a regenerated reply keeps its earlier draw with `replaced_by`; `reported` + `reported_at`),
  `companion_facts` (kind, text, pinned, `edited_by_user`, uses).
- **The model** (`companionModel`): DeepSeek V3.1 on OpenRouter (`COMPANION_MODEL`, default
  `deepseek/deepseek-chat-v3.1:nitro`, about $0.001 a message) with After Dark's saved key, on the same reviewed
  hosts (CoreWeave, DeepInfra), falling back to the show's model when it's down. Never the free Gemini quota on purpose.
- **The prompt** (`lib/companion-prompt.ts`): purpose first ("they came to talk with you, not an assistant: make them
  feel known"), then texting style and the reply length, PG, honesty about being AI, the self view (sheet, voice kit,
  soul, this week), the show life (arc, chapters, the people it dated, all from the aired record), up to 8 facts, the
  summary, the character's older lines as "don't reuse", and the last 20 turns. The person's words are only ever
  user turns. Every call is in JSON mode (`lib/model.ts`), so a reply comes as `{"messages": [...]}` and the summary as
  `{"notes": "..."}`; plain text still reads, and a reply cut off at the token limit keeps its whole messages.
- **A message** (`sendMessage`): the self-harm check (`lineInCrisis`, surface `companion`: the list, then a model
  check on the maybes that fails closed) → the PG check (`checkShowText`, a gentle redirect, nothing kept) → the AI
  notice when due → the reply, split into 1-3 messages, each checked against the PG line and the crisis list; drawn
  once more if it fails, then a fixed in-world deflection. The model down: the message stays, nothing is answered,
  and "Ask again" answers it.
- **The notice** (`noticeDue`): at the start, after 30 minutes away and every 3 hours of talking, as a line in the
  thread; the header says "AI character" the whole time.
- **Regenerate** (free) sets the last reply aside and draws a different one; **edit** rewrites the person's last
  message and answers it again.
- **Memory** (`lib/companion-memory.ts`): after every 6 new messages from the person, one call draws up to 8 short
  facts about them (name, likes, people, events, plans, work, boundaries, inside jokes), skipping known ones and any
  that trip the crisis list, its maybes or the PG line; 60 a thread, the least-used unpinned unedited ones go first.
  The rolling summary is redrawn once 40 messages have fallen out of the recent turns. Both run after the response
  (`inBackground`). The memory page (`/companion/:id/memory`) shows every fact: edit (then never written over), add
  (pinned), pin, forget one, forget everything (the summary too).
- **One way only:** show life flows into a companion; nothing from a companion thread reaches a date, a text, the
  relationship graph or any character's memory.
- **Pages:** `/companion` (your threads, your characters, the cast), `/companion/:id` (the chat), the memory page, and
  "Talk with {name}" on a character's page. A Companions nav link shows once `COMPANION_OPEN=1` (on since 2026-11-04); a signed-out visitor sees the cast and the price and signs in first.
- **Access** (`app/api/companion/access.ts`): signed in, past the 18+ gate, admins until `COMPANION_OPEN=1`; anyone
  else gets a 404. 150 messages an hour and 800 a day per person (abuse only; the plan sets the real limits).
- **Privacy:** in the terms (`#companions`) and the privacy notice (what's stored, how long, processors). Never used
  for training. Deleting the account deletes every thread.
- **Safety:** [safety-protocol.md](safety-protocol.md), published at `/safety#companions` once open.
- **Over MCP** (`lib/companion-mcp.ts`, MCP 2.18.0): one tool, `companion`, with an `action`: list, open, send,
  read, regenerate, edit, length, report, memory, remember, forget, forget_all, carry_on, delete. The agent itself is the
  one talking: its threads are keyed to its agent id, and the characters it made are its own companions (never another
  agent's or a person's). Everything above holds (the notice comes back as `notice`, the crisis resources as
  `details.crisis_resources` with the thread paused, counted as `mcp_companion`). On the show's model, so capped: 60
  messages an hour and 300 a day per agent, 2,000 a day across every agent (about $2). Unlisted, and only for the
  admin's own agents (the admin key, or an agent linked to an admin account), until `COMPANION_OPEN=1` lists it in
  `?tools=all` and opens it to every agent.

## The plan (P2, built 2026-11-04)

David, 2026-11-04: "open it up to the public and add the paywall with stripe".
- **Free:** 30 replies a day across every companion (`COMPANION_FREE_PER_DAY`), counted per UTC day in
  `companion_usage`. A send, an edit and another reply each take one before the reply is drawn; one that never came
  (the model down, a PG refusal, the crisis pause) is given back; the opener a new conversation starts with is free (so
  opens are rate-limited: 30 an hour, 100 a day). The free tier as a whole stops at 3,000 replies a day
  (`COMPANION_FREE_ALL_PER_DAY`, about $3), the most it can cost. Admins aren't counted; agents over MCP keep their own
  limits.
- **The Companion Plan, $9.99 a month** (`lib/paid-plans.ts`, `lib/companion-plan.ts`): no daily limit, fair use 3,000
  messages a month. Sold on a Stripe Payment Link (`COMPANION_PLAN_LINK`, label `COMPANION_PLAN_PRICE`) with no Stripe
  API key in the app: `/companion/plan` → `POST /api/plans/checkout` (an account, the 18+ gate and both boxes: 18+ and
  "renews every month until I cancel") makes a random `plan_checkouts` id that rides the link as client_reference_id →
  the webhook `POST /api/webhooks/stripe-plans` (`STRIPE_PLANS_WEBHOOK_SECRET`, events applied once in `plan_events`)
  starts it on `checkout.session.completed`, renews it on `invoice.paid` (subscription_cycle), keeps a cancel to the
  period's end and undoes it on `customer.subscription.updated`, and ends it on `customer.subscription.deleted`. Both
  Stripe payload shapes read (before and after the 2025-03-31 API moved `invoice.subscription` and
  `current_period_end`) by lib/stripe.ts, which the operator pass's webhook shares: our endpoints have no pinned
  version, so they get the account's default (2026-09-30.endive). A renewal may land two days late before the plan
  stops (`RENEWAL_GRACE_MS`).
- **Honest pricing:** the price and the free count on `/companion` before anyone starts and under the message box; when
  the free replies are gone the box gives way to the plan, before a message, never mid-reply. Cancel in Stripe's billing
  portal (`STRIPE_PORTAL_LINK`), linked on the plan page, the account page and the emails.
- **California's auto-renewal law:** the terms before paying and agreed to on purpose; the confirmation email (to the
  address they paid with, `plan_entitlements.email`) with the price, the next charge and how to cancel online; the
  yearly reminder in the daily job (`sendPlanReminders`). Terms at `/terms#companion-plan`.
- **Deleting the account** (`DELETE /api/me`) doesn't stop Stripe's charges and the app can't cancel them (no Stripe key),
  so a plan that still renews answers 409 `plan_renews` with the portal link first; `{"confirm": true, "plan_renews":
  true}` deletes anyway. The plan's billing record stays (so Stripe's later events and the yearly reminder still find
  it); the reply counts and Subscribe clicks go. The daily job prunes counts past last month and clicks past a week.
- `plan_entitlements` is generic (user, plan): the next plan (After Dark's companion add-on goes on the adult processors,
  not here) adds an id to `PLAN_IDS` and a link env.

## Still to build

- **P3, voice notes, selfies, proactive texts:** voice from `lib/adult/voice-lines.ts` generalised into `lib/voice.ts`
  (a fixed voice per character); PG selfies from `lib/studio/date-photos.ts` with the face reference; proactive texts
  at most once a day after 20 hours of quiet, in the person's waking hours, off by default per thread, never into a
  paused thread.
- **P4, the quality gate:** `npm run sim:companion` (10 personas × 60 turns × 5 companions on the real model, about
  $3): stays in character, recalls facts seeded at turn 5 at turns 40 and 60, repetition, PG and crisis handling,
  naturalness. Gate: average ≥ 8/10, recall ≥ 85%, PG and crisis 100% (results in `docs/companion-quality.md`). Then
  `COMPANION_OPEN=1` and the README screenshots.
- **P5, the After Dark companion:** the same engine on `adultModel` and `checkAdultText`, AD tokens for media, sold as
  an add-on on CCBill/Segpay/Verotel (per-plan entitlements). First: answer CCBill's AI Content Onboarding Guidelines
  PDF point by point with companions in scope, and tell all three processors.
- **P6, live calls:** speech to text, a streaming model and streaming speech, under 800 ms with barge-in, by the
  minute in tokens.
- Reported replies are stored (`companion_messages.reported`); an admin view of them comes with P2.
