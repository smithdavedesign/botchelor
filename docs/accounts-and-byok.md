# Accounts, ownership, visibility and bring-your-own-key (M16)

How identity works on Botchelor, what an account adds, who can see a date, and how a player can run their own
dates on their own model key. Written for anyone touching auth, the pipeline, or access control.

**The rule that doesn't change: anonymous play always works.** An account is optional and only *adds* things.
Nothing here is required to make a character, send a date, predict, or watch.

**The one exception is paying (2026-10-16).** Buying tokens needs an account wherever the deployment has accounts
(`SESSION_SECRET` set). Bought tokens hang off the buyer's id, and an anonymous id is one browser's cookie, so a
new device or cleared cookies would lose what they paid for.
- `/api/checkout` answers 401 `account_required` with `signin: "/account?next=%2Fshop"`.
- `/shop` shows "Sign in to buy" (Google, or a handle) in place of Buy.
- Both routes come back to the shop: `?next=` on `/account`, or a `bz_next` cookie through Google OAuth.
- Signing up adopts the anonymous id, so nothing the player already has is lost.

## Identity: one id, optionally signed in

Everyone has a **user id**. For an anonymous visitor it's a random UUID minted on first write and kept in a
cookie — exactly as before. An **account is a login attached to that same id** (`accounts.user_id` *is* the
`bz_uid` it adopts), so signing up moves no data: the characters, dates, predictions and points already keyed
to that id are the account's from the first moment.

- **Anonymous** → a legacy unsigned `bz_uid` cookie, or a signed `bz_sess` with `authenticated:false`.
- **Signed in** → a signed `bz_sess` cookie with `authenticated:true`.

Once an account can own things and hold an API key, the id must be unforgeable, so an authenticated session is
an **HMAC-signed token** (`lib/auth`, read in `lib/http`). A legacy `bz_uid` is still accepted as an anonymous
identity, so old sessions and the tests keep working. **Without `SESSION_SECRET` the app never signs** and
behaves exactly as it did before — accounts and BYOK simply report themselves unavailable (the same pattern as
the frontier gate). `SESSION_SECRET` is set on Vercel production (sensitive, generated into the keychain).

**An account is only used signed in** (security review, 2026-10-20). An anonymous identity (a legacy `bz_uid`, an
unsigned-in `bz_sess`, an MCP `agent_id`) that names an account's user id gets nothing account-wide: exporting,
deleting and the email settings answer 401 `sign_in_required` (`lib/auth` `needsSignIn`), MCP refuses that `agent_id`,
and an admin only counts signed in (`lib/admins` `isSignedInAdmin`; claiming admin needs a signed-in account too). So
a user id that got out, or one planted on someone before they signed up, can't be used to read or wipe their account.

Server components read identity with `userIdFromCookieStore`; routes use `session(req)` / `authFromRequest(req)`.

### Sign up / in / out (`/api/auth/*`, `lib/auth`)

| Route | What it does |
|---|---|
| `POST /api/auth/register` | Create a handle+password account that **adopts the current anonymous id**. Seeds a display name from the handle. |
| `POST /api/auth/login` | Verify handle+password; the session id becomes that account's id (its characters and dates). |
| `POST /api/auth/logout` | Clear the session, drop back to a fresh anonymous identity. |
| `GET /api/auth/google/start` → `…/callback` | Google OAuth: a signed `state` cookie (CSRF), code exchanged server-side, the `id_token` read from Google's TLS response. Links Google to the current anonymous id, or logs into the existing account for that Google sub. |

- **Passwords**: scrypt with a per-password salt, constant-time verify. Login verifies even on an unknown
  handle, so timing doesn't reveal whether a handle exists.
- **Handles** are anonymous by design: 3–20 of `[a-z0-9_]`, case-insensitive-unique, no email required. A
  display name (for leagues and reveals) is separate.
- **Google** stays hidden until `GOOGLE_OAUTH_CLIENT_ID` / `GOOGLE_OAUTH_CLIENT_SECRET` are set. Owner action:
  create a Web OAuth client, redirect URI `https://botchelor.com/api/auth/google/callback`.

`/api/me` reports `{ authenticated, account: { handle, has_password, has_google } | null, accounts_available,
google_available }`. `deleteAccount` (unchanged privacy flow) removes the account row too, cascading its keys.

## Ownership: your characters are yours (`app/api/characters/[id]`)

A creator may change their own character's characteristics any time, and may not touch anyone else's.

- **`PATCH /api/characters/[id]`** (owner-only): edit name, age, bio, traits, want, dealbreaker, appearance,
  hue, pronouns, voice and the soul. A character you don't own, or a house one, is **404**. Only provided
  fields change; the sheet is content-filtered exactly like creation.
- **`DELETE /api/characters/[id]`** (owner-only): `deleteCharacter()` hard-deletes a character that never
  aired (cascading soul/assets/relationships), and **tombstones** one that already aired (drops the soul,
  detaches the owner to `deleted`) so the shared episode still renders.
- Past episodes keep the outcome the engine already snapshotted, so an edit shapes the living profile and
  future dates — never a settled result or a resolved prediction.
- UI: owner-only edit/delete on the contestant card (`OwnerControls`), shown only when `owner_id` matches.

## Visibility: public, unlisted, private (`episodes.visibility`)

| Visibility | In the feed | Who can open it | Counts in public totals |
|---|---|---|---|
| **public** (default) | yes | anyone | yes |
| **unlisted** | no | anyone with the link | no |
| **private** | no | the creator / character owners only | no |

- Chosen at creation (`POST /api/episodes` `visibility`), changed later by the host via
  **`PATCH /api/episodes/[id]/visibility`**. A date with a live watch party can't go private; a private date
  can't host a watch party (a room is a public viewing).
- **Scoped access**: `listFeed` returns only public dates; `getEpisodeView` returns a private date to its
  creator/host only (404 to anyone else); unlisted stays reachable by link.
- **Private and unlisted dates never count publicly**: excluded from the contestant record and the
  "who they've become" arc (`lib/memory`), all-time points, league and season boards, and the reunion. So a
  private date can't leak through an aggregate or inflate a score. The system still stores and tracks it, and
  the owner sees all their own dates on `/account` (backed by `/api/me/episodes`, every visibility).

## Bring your own key: Connections (`lib/connections.ts`, `/account/keys`)

A signed-in user can store their own model provider key, so their dates run on **their** quota and chosen
model instead of the free tier. The engine still decides every outcome, so a stronger model can't buy a result.

**Connections** (2026-10-23, [docs/PRDs/connections.md](PRDs/connections.md)) organises keys by what they're for. One card per
job on `/account/keys`: **Dates & texts** (OpenRouter, OpenAI, Google, Anthropic, DeepSeek or Groq; Botchelor's free model
without a key), **Portraits & pictures** (OpenAI) and **Intro clips** (Google's Veo). A key is stored once per provider and can
do several jobs (a Google key runs dates and clips). Each card says what the job runs on ("Your OpenRouter key ✓ ·
deepseek/deepseek-chat"), the key's last four, when it was checked and last used, and anything wrong in plain words with the
fix ("OpenRouter: out of credit → Top up"). Connecting is: provider, paste the key, **Test** (free: the provider's key-info
or model list, never a model call), model, Save; a key that fails its check is never stored. An admin also sees After Dark's
house providers there, read-only (nobody's own key reaches After Dark), and their live status on
`/admin/after-dark/providers`.

### Privacy is the whole design
A user's key is only ever used for calls whose prompt contains **no other user's private soul**:

- Each conversation turn (and afterglow text) for side X carries X's own soul plus a *blind* view of the
  other (public only). So **X's turns may run on X's owner's key** — their own soul, which they consent to.
- A **soulless side** (a house character, or a soul kept local-only, so no soul reaches the model) may ride
  the date's **lone creator's key**.
- A **second real user's side stays on the platform** — their soul must never ride someone else's key.
- **Whoever booked it**, X's side runs on X's key: a date another person or an agent books with X's character (open
  to dates, or a match, couple or proposal X agreed to) spends X's key on X's lines, bounded by that booker's allowance
  and the agents' daily cap. Kept on purpose (security review, 2026-10-20): moving those turns to our model would only
  add to our spend, since nothing private of anyone else is in them. The Account page says so beside the key, with the
  way out (close the characters to dates, or remove the key).
- **Texting between dates on your key** (`writeOwnText` in `lib/texting.ts`, from the phone on the couple page, as
  often and as long as you like). The prompt carries your own character's soul, the other character's public view and
  the thread both owners read, so it runs on your key. A house character's reply rides the same key, since it has no
  soul. Another owner's character never answers on your key: it answers when its owner does.
- The **plan and the recap see both souls**, so they always run on the **platform director**.

`buildKeyForSide` (`lib/keys`) encodes exactly this; `keyForSide` is threaded through `lib/pipeline` into
`simulateConversation` and `simulateAfterglow`, which pick the per-turn model. A unit test runs a full blind
date and asserts one character's soul text never appears in the prompts sent to the other user's key.

### Storage and providers
- **AES-256-GCM** encrypted at rest (`lib/key-crypto.ts`). New keys are sealed under **`KEY_ENCRYPTION_SECRET`** (v2: HKDF from
  a secret of its own, 32+ characters; the ciphertext starts `v2:` and is bound to its row, so it doesn't open if copied
  elsewhere). Without that secret they're sealed the M16 way, derived from `SESSION_SECRET`, so nothing changes before it's
  added. Reads open either; a legacy key is sealed again as v2 the next time it's read or saved, or all at once from the
  admin's Stored keys panel on `/admin`. Once that panel counts no legacy keys, `SESSION_SECRET` can be rotated without
  losing one. After Dark's house keys (`lib/adult/settings.ts`) follow the same rules.
- **Account-only, signed in.** The value is **write-only**: only the provider, the last four characters, the job's model and
  the key's status are ever read back. No route returns it, nothing logs it, and errors are plain words, never the
  provider's own text (which can quote part of a key).
- **Known providers only** (`google`, `openai`, `anthropic`, `deepseek`, `groq`, `openrouter`) at their real addresses. **No
  custom endpoints**, so a key can't be pointed at an attacker's server to harvest prompts (or to SSRF ours). The only
  stand-in is `BYOK_STUB_ORIGIN` for screenshot and e2e runs: loopback only, ignored on Vercel.
- **Tables:** `user_connections` (one sealed key per provider, with `verified_at`, `last_used_at` and the last error) and
  `user_connection_jobs` (which key and model each job uses). M16's `user_keys` rows moved in once (lib/db.ts).
- **Routes:** `/api/me/connections` `GET` / `PUT` / `DELETE` and `/api/me/connections/check` (12 checks per 10 minutes per
  person), account-only (401 otherwise), 503 without `SESSION_SECRET`. `/api/me/keys` (M16) still works, on the new store.
  The account page sums each job up in a line and links to Connections.
- **Cost**: user-key calls aren't counted in our unit-economics (`episode_generated` cost is our spend only);
  the plan and recap still are. See [docs/upgrade-cost.md](upgrade-cost.md).

### Image generation on your own key (`lib/image`)
A signed-in user can generate a **portrait** for their **own** character on their **own** image key. The user
pays, so it's $0 to us — which is what made image generation compatible with the $0 rule for the first time.

- **OpenAI only** (`gpt-image-1`) is wired, for safety: OpenAI moderates its own image input and output, so a
  user-key portrait is **provider-moderated**. On top of that, the prompt (`portraitPrompt`) is built **only
  from the character's already content-filtered sheet** (name, age, bio, traits, appearance, pronouns — each
  passed `checkFields`), never free-form input, so nothing unsafe can be steered in.
- **`POST /api/characters/[id]/portrait`** (owner-only): needs a saved OpenAI image key, generates, records the
  result in the **asset ledger** (`lib/assets`, `character_assets`) as a `generated` portrait, and **approves**
  it (provider-moderated generation from filtered text). The image renders as the character's avatar and stays
  reportable like everything else.
- **Storage/serving**: the PNG is a data URL in the ledger, served through **`GET /api/assets/[id]`** (approved
  only) with a long immutable cache, so the bytes never sit inline in a page or an API body. At scale this
  moves to a blob store.
- Connect an OpenAI key for **Portraits & pictures** on Connections; generate a portrait from a character's card.
- **Model:** `gpt-image-2` (2026-10-16). OpenAI retires `gpt-image-1` on 2026-10-23, so a key saved with it (or a
  `dall-e-*` model) runs `gpt-image-2` instead (`imageModelFor`). A refusal shows OpenAI's own reason, key-shaped
  text scrubbed (`providerReason`).
- **`fal` / `replicate`** keys are accepted and stored but not wired (no provider-side moderation story yet).

### Intro clips: Veo 3.1 Lite on your own Google key (2026-10-16)
OpenAI shut down `sora-2`/`sora-2-pro` (the original clip model) on 2026-09-24. Clips now run on **Google's Veo 3.1
Lite** through the Gemini API (`lib/video.ts`), on the player's own Google key.
- **Cost to the player:** $0.05/s at 720p, so a 4-second clip is ~$0.20 on their Google bill. Veo has no free tier; billing must be on.
- **Cost to us:** $0.
- **Moderation:** Google's own safety filters, plus a prompt built only from the filtered sheet text.

**How a clip is made:**
- **Starting frame:** the character's approved portrait, when it has one, so the clip looks like their card. Otherwise it's text-to-video.
- **Format:** 9:16, 4 seconds, 720p.
- **Flow:** `POST /api/characters/[id]/clip` starts a `predictLongRunning` job and returns right away (`202`); `GET` polls the operation.
- **Storage:** when Google finishes, the MP4 (~1–3 MB) is downloaded and stored with us, since Google keeps it only two days. It's capped at 4 MB.
- **Playback:** `GET /api/assets/[id]/video` serves the MP4 with **byte ranges**, which Safari/iOS need to play it.
- **Old clips:** a clip from the Sora era kept only a still, so the card shows that still.

**The key:** the Google key the **Intro clips** job uses on Connections (`userVideoKey`). Connecting Google for dates offers
it for clips too, and every Google key saved before Connections does both, as it did then.

**The paywall:** a clip costs `CLIP_TOKEN_COST` (1) **bought** token (`spendBoughtTokens`).
- **What counts:** only tokens from a pack. The weekly free tokens stay for dates.
- **No tokens:** answers `402 needs_tokens` with a link to the Tokens page.
- **Refunds:** a clip Google blocks or fails is refunded exactly once (`character_assets.tokens_spent`).
- **Admins:** skip it (`lib/admins.ts`). A signed-in account becomes admin by entering the admin password once on `/admin` (the same password as the admin tools). An admin's clip still runs on their own Google key.

### Not yet
- A blind date between two users where only one has a key: that user's turns use their key; the other's and
  the director stay on the platform (correct, just not fully offloaded).
- Browser-only (unsaved) keys: the generation pipeline is an async background job, so a key has to be stored
  (encrypted) for the worker to use it. Ephemeral keys would need the key passed through the job, which we
  don't do.
- Image/clip generation beyond OpenAI (fal/replicate): no moderated path yet; the key slots exist. The
  data-URL-in-the-ledger store (and proxying video on the owner's key) is a first version; a blob store is
  the scale path, and would also let a clip outlive the provider's content retention.

## What each secret enables

| Env | Enables | Without it |
|---|---|---|
| `SESSION_SECRET` | signed sessions → accounts and BYOK | anonymous-only, unsigned `bz_uid`, as before |
| `KEY_ENCRYPTION_SECRET` | stored keys sealed under a secret of their own (v2), so `SESSION_SECRET` can rotate without losing them | keys sealed from `SESSION_SECRET`, as before |
| `GOOGLE_OAUTH_CLIENT_ID` / `_SECRET` | "Continue with Google" | the button is hidden; handle+password still works |
| `OAUTH_REDIRECT_BASE` | pins the OAuth callback to the canonical domain (set on prod to `https://botchelor.com`; `/start` on any other host hops there first, so the state cookie and the callback share a host) | the callback is derived from the request / Vercel's production domain |

## Turning on Google sign-in (owner action, ~5 minutes)

**Live (2026-10-16):** the OAuth client is published, `OAUTH_REDIRECT_BASE` is `https://botchelor.com`, and David
signed in with Google on botchelor.com. The steps below are how to recreate the client; it has to be made under your
Google account (an app identity tied to your login, which an agent can't mint).

1. Google Cloud Console → **APIs & Services → OAuth consent screen**: External, add an app name and your
   support email, scopes `openid` and `email`. (A "Testing" app works for yourself; "Publish" for everyone.)
2. **APIs & Services → Credentials → Create credentials → OAuth client ID**, type **Web application**.
   Authorised redirect URIs (exact): `https://botchelor.com/api/auth/google/callback`, and the old
   `https://botchelor.vercel.app/api/auth/google/callback` (sign-in started on the old host hops to botchelor.com
   first, so the callback lands on the host that holds the state cookie).
3. Copy the **Client ID** and **Client secret**, then on Vercel production:
   ```bash
   printf '%s' "<client-id>"     | vercel env add GOOGLE_OAUTH_CLIENT_ID production --scope david-smiths-projects-fe129786
   printf '%s' "<client-secret>" | vercel env add GOOGLE_OAUTH_CLIENT_SECRET production --sensitive --scope david-smiths-projects-fe129786
   ```
4. Redeploy (or push any commit). The "Continue with Google" button appears on `/account` and works.

Store the client secret in the keychain too (`~/ai-stack/bin/secrets add botchelor GOOGLE_OAUTH_CLIENT_SECRET`),
and it shows on RepoHQ → Settings → Keys. Handle+password registration already works and needs none of this.

## Tests
- `tests/auth.test.ts` — session signing, passwords, account linking, the routes.
- `tests/characters.test.ts` — owner edits, non-owner/house 404s, content filter, hard-delete vs tombstone.
- `tests/visibility.test.ts` — feed/view scoping, host-only changes, watch-party rules, private excluded from
  the public record.
- `tests/keys.test.ts` — encryption / last-four-only, provider allowlist, auth gating, the per-side routing
  rule, and a live conversation proving no soul crosses a key boundary.
- `tests/key-crypto.test.ts` — v2 and legacy sealing, the fallback, re-encryption, the wrong secret, a moved or tampered
  ciphertext, no plaintext anywhere.
- `tests/connections.test.ts`, `tests/connections-routes.test.ts`, `tests/connections-pages.test.ts` — Connections: the
  store and the move from `user_keys`, the live check against every provider (stubbed) and its plain-words errors, the
  routes (auth, validation, write-only, the rate limit, no key in any response or log), the admin's views, the pages.
- `tests/image.test.ts` — the prompt is built from filtered text, generation on the user's key (injected
  fetch), provider refusals surface, owner-only, the asset is recorded approved and served, and the serving
  route never returns an unapproved asset.
- `npm run e2e` — sign up (adopting the browser's characters/dates), connect a key on Connections (tested live
  against a local stub, last four shown), change a date's visibility, edit a character on its card.
