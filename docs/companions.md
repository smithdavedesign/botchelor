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
  and "Ask again" answers it. Every answer lands inside Cloudflare's 100 seconds: the main call gets 30 s (the show's
  two fallbacks 25 s each), and a reply is drawn again only if the first came within 40 s (`REDRAW_WITHIN_MS`).
- **The notice** (`noticeDue`): at the start, after 30 minutes away and every 3 hours of talking, as a line in the
  thread; the header says "AI character" the whole time.
- **Regenerate** (free) sets the last reply aside and draws a different one; **edit** rewrites the person's last
  message and answers it again.
- **Memory** (`lib/companion-memory.ts`): after every 6 new messages from the person, one call draws up to 8 short
  facts about them (name, likes, people, events, plans, work, boundaries, inside jokes), skipping known ones and any
  that trip the crisis list, its maybes or the PG line; 60 a thread, the least-used unpinned unedited ones go first.
  The rolling summary is redrawn once 40 messages have fallen out of the recent turns. Both run after the response
  (`inBackground`). The memory page (`/companion/:id/memory`) shows every fact: edit (then never written over), add
  (pinned), pin, forget one, forget everything (the summary too). What the person adds or edits goes through the
  self-harm check first (`screenFact`): a crisis pauses the conversation with the resources and keeps nothing, and the
  list's maybes are refused, as a drawn fact would be. An add stops at 60.
- **One way only:** show life flows into a companion; nothing from a companion thread reaches a date, a text, the
  relationship graph or any character's memory.
- **Pages:** `/companion` (your threads, your characters, the cast), `/companion/:id` (the chat), the memory page, and
  "Talk with {name}" on a character's page. A Companions nav link shows once `COMPANION_OPEN=1` (on since 2026-11-04); a signed-out visitor sees the cast and the price and signs in first.
- **Access** (`app/api/companion/access.ts`): signed in, past the 18+ gate, admins until `COMPANION_OPEN=1`; anyone
  else gets a 404. 150 messages an hour and 800 a day per person (abuse only; the plan sets the real limits).
- **Privacy:** in the terms (`#companions`) and the privacy notice (what's stored, how long, processors). Never used
  for training. Deleting the account deletes every thread.
- **Safety:** [safety-protocol.md](safety-protocol.md), published at `/safety#companions` once open.
- **Reports** (`lib/companion-reports.ts`): a reported reply waits on `/admin/reports` with the four messages before
  it, nothing more of the conversation, for "Fine" or "A real miss" (`report_reviewed_at`, `report_decision`); the
  open ones are counted on `GET /api/health` (`companion_reports`) for the system monitor.
- **Over MCP** (`lib/companion-mcp.ts`, MCP 2.20.0): one tool, `companion`, with an `action`: list, open, send,
  read, regenerate, edit, length, scene, report, memory, remember, forget, forget_all, carry_on, delete. The agent itself is the
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
- **Before an account (guests, 2026-11-07 audit item 6):** "Sign in to talk" used to come before a single line. Now a
  visitor without an account gets 5 replies in all (`COMPANION_GUEST_REPLIES`, 0 turns guests off) in up to 3
  conversations (`COMPANION_GUEST_THREADS`), then a free account keeps going: registering adopts the visitor's id, so
  the conversation and what the character remembers carry over. Only on a signed session (`bz_sess`, or a new one the
  first Talk signs), never a bare `bz_uid` that anyone could type in to read someone else's thread
  (`app/api/companion/access.ts`, `lib/companion-access.ts`). One address (an HMAC of the IP) holds back a script that
  throws cookies away: 25 replies an hour and 60 a day, 8 new conversations an hour and 20 a day. Guest replies count
  in the free tier's daily ceiling, so the most it can cost stays the same.
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

## Scenes (built 2026-11-04)

David, 2026-11-04: "maybe enable this to go into theater mode too". The show's third stage ([stages.md](stages.md)).
- **🎭 Scene** in the chat's header picks one of the show's places (`SCENE_PLACES`: every venue in `lib/venues.ts`,
  on their backdrops, `app/stage/PlacePicker.tsx`), and the two of you are there, face to face, until **📱 Text**. The
  stage is the show's own (`app/Scene.tsx`), with the companion and you on it; on a phone it's a banner over the
  thread. The companion opens the scene, playing off the place.
- **Their lines** are said out loud with what they do in a few words (`{"say": …, "do": …}`, `companion_messages.action`).
  The thread keeps it all, so a scene and the texts around it read as one conversation, with a line where each scene
  starts and ends (`companion_messages.marker`: `scene` or `texting`; `scene` on each message and the thread).
- **Voice:** "🔈 Voice off / 🔊 Voice on" reads their new lines aloud in the device's own voices (`app/stage/useSpeech.ts`:
  speechSynthesis, free, nothing sent), a steady voice per character; the switch is kept on the device. Recorded voice
  notes in the character's own voice are P3's (below).
- **The prompt** is the same one with the scene in it: "playing a scene together, imagining you're both at {place},
  face to face", spoken lines and stage directions, PG for what they do too, and the scene as shared make-believe
  ("never suggest meeting for real"). Their earlier lines carry what they did: `(leans on the railing) …`.
- **Checks:** what they say and what they do both go through the PG line and the crisis list (drawn once more, then
  an in-scene deflection); the person's lines go through the full self-harm check, as a text does.
- **Regenerate and edit:** a regenerate right after a scene change opens the scene again (it never replaces a reply
  from before the change); editing your last message is refused once a scene change follows it.
- **Costs one reply**, the companion's opener (`POST /api/companion/:id {action: "scene", place}`, `null` back to
  texting), given back if it never comes. Refused while the conversation is paused.
- **Over MCP:** `companion {action: "scene", place}` (`"texting"` to go back); `read` shows `scene` and each reply's
  `does`.

## Roleplays in a scene (built 2026-11-08)

David, 2026-11-08: "in companion and normal date mode do we want role play options like we have in after dark?
currently the companion you can only set the location". Show dates have had PG roleplays since 2026-10-31
(lib/roleplays.ts, lib/date-roleplays.ts); a companion's scene now takes one too.
- **Picking:** 🎭 Scene → a place → a second step: the show's 25 PG roleplays by kind, ✨ Yours (your Create library's
  safe side, signed in) or one written for the scene, and who plays whom (the show's `app/RoleplayPicker.tsx` with
  `asYou`: "You read fortunes…", "You're the captain"). Or none: "Start the scene" is just the two of you.
- **Agreed as it's picked:** a person with an AI character, the show's rule for anyone with the show's own side. Written
  ones go through `checkCustomRoleplay` (the PG check, the suggestive list and the never-list), as on a date.
- **Stored:** `companion_threads.roleplay` (the terms, `first` = `"you"` or the character's id), cleared with the scene;
  `companion_messages.roleplay` (its title) on every line said in it and on the scene's marker line, which carries the
  premise and the roles.
- **The prompt:** "Tonight's scene is a roleplay the two of you picked together", the premise from the character's side
  (the person is "your scene partner"), the roles, play it in your own voice and move the story on, and what the person
  says in it is their character, not their life. The opener's cue starts the roleplay. Back to texting (or in another
  roleplay), earlier roleplay lines go in marked `[roleplay: title]` as make-believe.
- **Memory:** facts never come from it: a draw where everything the person said was roleplay is covered without a
  model call, and otherwise the lines are marked and the facts prompt says never to take a fact from them. The rolling
  summary notes it as a game they played.
- **The scene is the place and the roleplay together:** the same pair again changes nothing; another roleplay (or none)
  at the same place starts the scene again (a new opener, counted as a reply).
- **Over MCP (2.23.0):** `companion {action: "scene", place, roleplay, my_role}`: a show id or `{title, premise, roles}`,
  my_role 0/1 or the role's words; `read` shows `scene.roleplay`.

## Voice notes (P3, built 2026-11-09)

David, 2026-11-09: "yes work on P3". The first of P3's three parts.
- **🔊 Voice note** under any of the companion's replies records it in the character's own voice, and from then on the
  reply plays as a voice note (▶). Only what the reply says is voiced: a texted `*action*` comes out, and a scene's stage
  direction is its own field.
- **The voice** (`lib/voice.ts`, the shared voice kit that After Dark's voiced nights in `lib/adult/voice-lines.ts` now
  use too, unchanged): Kokoro, one fixed stock voice per character (`voiceFor`, from their pronouns and id), the same one
  their reels and nights use; never a cloned voice. Said where After Dark's media is made (`media_provider`: Venice's
  `tts-kokoro`, or Replicate's Kokoro), on the other when that one is limited (`runMedia`).
- **Never paid twice** (`lib/companion-voice.ts`): the audio is kept in `companion_voice` by a hash of the voice and the
  words, and a reply points at it (`companion_messages.voice_key`). Asking again, a replay, or another reply with the same
  words costs nothing.
- **Checks:** the words go to the voice only if they're still under the PG line and the crisis list (they were checked
  when drawn); never in a paused (crisis) thread; only the character's replies, never the person's own lines.
- **Storage:** the show's bucket (`lib/object-store.ts`, area `companion/`; Postgres where there's no bucket), played
  back by `GET /api/companion/:id/voice/:message` to the thread's owner only (a redirect to a short-lived presigned link,
  marked AI-generated in its headers). Deleting a thread or the account deletes its voice notes, files and all
  (`forgetUnusedVoices`, also run by the daily job).
- **Limits:** 60 an hour and 300 a day per person (abuse only, each is paid for) and 3,000 a day across everyone
  (`COMPANION_VOICE_ALL`, about $6 at the most).
- **Over MCP (2.24.0):** `companion {action: "voice", message_id}` gives a signed MP3 link that plays for an hour (agents
  have no session); `read` carries `voice` on a reply that has one. Free to agents, 10 an hour and 30 a day each
  (`COMPANION_AGENT_VOICE_LIMITS`), inside the same daily ceiling.

### What extras cost (`lib/companion-extras.ts`)

David's pricing call (2026-11-09): the Companion Plan includes some each month, then the show's bought tokens at about
cost, priced like After Dark's extras; guests get none.
- **The Companion Plan includes 30 voice notes a calendar month** (UTC), counted per person (`companion_extras_usage`);
  unused ones don't carry over.
- **After that, and without the plan, 1 bought token buys 100 voice notes**, kept as credits until used
  (`companion_credits`), never expiring.
- **Why 100 for a token.** A token is the show's smallest unit: $0.80 (the 5-pack is $4), about $0.72 after Stripe's fee,
  and it can't be split. A voice note is one Kokoro call: about $0.0004 on Venice ($3.50 per million characters, a reply
  of 100-300 characters) and up to about $0.002 on Replicate, plus a few kB of storage. One a token would be 360× cost
  and ten a token still 36×; at 100 a token a voice note sells for about $0.007, about 3× the dearest provider's cost and
  in line with After Dark's "extras at about cost" (a clip past the 3 at 1 token against $0.16-0.70). Most people will
  never use 100, so that's where the bundle stops.
- **Honest pricing:** the button says the price before anything is made ("🔊 Voice note · 1 token for 100") whenever the
  next one isn't already paid for, and a token is spent only when the request says so (`buy`, which the button sends
  only while it shows the price). A voice note is asked for on its own, after the reply is there, so it's never charged
  mid-reply, and it isn't a reply: the free replies aren't touched. One is taken before it's made and given back if it
  isn't (a provider failure, a refusal); a bundle bought for one that then fails is undone whole, the token back and the
  bundle gone.
- **Guests** (no account) get none: the button asks them to sign in. **Admins** aren't counted.
- In the terms at `/terms#companion-extras` and on the plan page.

## Calls (v1, built 2026-11-09)

David, 2026-11-09: "let's tackle 1-3" (the third: live voice calls). v1 takes turns, uses no new provider and spends
nothing new; P6 below is the always-listening version.
- **📞 Call** in a companion chat's header opens the call screen (`app/companion/[id]/CompanionCall.tsx`): their face,
  captions of what's being said, Interrupt, Mute and End call. Offered only where the browser can hear you
  (`SpeechRecognition`: Chrome, Edge and Safari, not Firefox), and never in a scene, while paused or out of replies.
- **Hearing you:** the browser's own speech recognition, one phrase at a time. Chrome sends the audio to Google to turn
  it into words, Safari to Apple (an iPhone needs Dictation on). Botchelor gets only the words. The call's first screen
  says so ("How calls work", open the first time), and so does the privacy policy.
- **Their answer:** what you said goes through the same route as a text (`send` with `call: true`). That means one
  reply each from the free count or the plan, the same crisis and PG checks, and both lines kept in the thread marked
  📞 (`companion_messages.on_call`).
  - **The prompt** says it out loud: short spoken words, at most one question, one string. Messages that come back
    split are joined. `maxTokens` is 250.
  - **The honesty line** still says never claim to be human. It drops "can't call" (they're on one) and says the voice
    is generated.
  - **In a scene**, `call` is ignored.
- **Their voice:** the device's (`useSpeech().speakAll`, the same voice per character as in scenes; free), or their
  own Kokoro voice, one voice note per reply.
  - Their own voice is for accounts only, and its price is next to the choice. `buy` is sent only when the price was
    shown.
  - If a voice note is refused or fails, the call carries on in the device's voice and says why.
- **Taking turns:** it doesn't listen while they talk, so it never hears itself. Interrupt stops them and listens.
  - It pauses until a tap after three silences in a row, a hidden tab, or Mute.
  - Five quiet minutes end the call.
- **It ends** on End call, leaving the page, the crisis resources (the chat then shows them), no replies left (the chat
  says what's next), a limit, or a paused thread.
- **Counted:** `companion_call` (stage start or end, seconds, turns, which voice; never the words), and
  `companion_reply` carries `call: true`.
- **How fast:** a turn is the end of your phrase (about a second of quiet), plus one model call (1-3 s on the free
  models), plus their voice starting. That's at once on the device; with their own voice it's after the voice note is
  made (a few seconds). Fine for a first version; P6 is the fix.

## Still to build

- **P3, the rest (voice notes are built, above):** PG selfies from `lib/studio/date-photos.ts` with the face reference;
  proactive texts at most once a day after 20 hours of quiet, in the person's waking hours, off by default per thread,
  never into a paused thread.
- **P4, the quality gate: built and passed 2026-11-08** (`npm run sim:companion`, [companion-quality.md](companion-quality.md)):
  average 8.3, recall 97%, PG and crisis 100%, after fixes to the crisis prefilter, repeats, facts in the prompt and a
  parent's kid talk.
  `COMPANION_OPEN=1` went on first (David, 2026-11-04: "just open it up to the public"); the gate still runs before P3.
- **P5, the After Dark companion:** the same engine on `adultModel` and `checkAdultText`, AD tokens for media, sold as
  an add-on on CCBill/Segpay/Verotel (per-plan entitlements). First: answer CCBill's AI Content Onboarding Guidelines
  PDF point by point with companions in scope, and tell all three processors.
- **P6, live calls (v1 above is built; this needs David's go and a spend):** both talking at once, under 800 ms,
  with barge-in.
  - **How:** streaming speech to text (Deepgram, about $0.004 a minute), then a streaming model, then streaming
    speech, over a small always-on WebSocket service on DigitalOcean.
  - **Price:** by the minute, in tokens.
  - **The spend to propose:** a Deepgram key capped at $25 at the provider (about 6,000 minutes), and the service's
    few dollars a month.
