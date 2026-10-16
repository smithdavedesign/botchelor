# Accounts, ownership, visibility and bring-your-own-key (M16)

How identity works on Botchelor, what an account adds, who can see a date, and how a player can run their own
dates on their own model key. Written for anyone touching auth, the pipeline, or access control.

**The rule that doesn't change: anonymous play always works.** An account is optional and only *adds* things.
Nothing here is required to make a character, send a date, predict, or watch.

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
  create a Web OAuth client, redirect URI `https://botchelor.vercel.app/api/auth/google/callback`.

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

## Bring your own key (`lib/keys`, `/api/me/keys`)

A signed-in user can store their own model provider key, so their dates run on **their** quota and chosen
model instead of the free tier. The engine still decides every outcome, so a stronger model can't buy a result.

### Privacy is the whole design
A user's key is only ever used for calls whose prompt contains **no other user's private soul**:

- Each conversation turn (and afterglow text) for side X carries X's own soul plus a *blind* view of the
  other (public only). So **X's turns may run on X's owner's key** — their own soul, which they consent to.
- A **soulless side** (a house character, or a soul kept local-only, so no soul reaches the model) may ride
  the date's **lone creator's key**.
- A **second real user's side stays on the platform** — their soul must never ride someone else's key.
- The **plan and the recap see both souls**, so they always run on the **platform director**.

`buildKeyForSide` (`lib/keys`) encodes exactly this; `keyForSide` is threaded through `lib/pipeline` into
`simulateConversation` and `simulateAfterglow`, which pick the per-turn model. A unit test runs a full blind
date and asserts one character's soul text never appears in the prompts sent to the other user's key.

### Storage and providers
- **AES-256-GCM** encrypted at rest; the AES key is derived from `SESSION_SECRET` via HKDF (no second secret).
  **Account-only.** The value is **write-only**: only the provider, the last four characters and an optional
  model name are ever read back.
- **Known OpenAI-compatible providers only** — `google`, `openai`, `openrouter` — at fixed base URLs. **No
  custom endpoints**, so a key can't be pointed at an attacker's server to harvest prompts (or to SSRF ours).
- `/api/me/keys` `GET` / `PUT` / `DELETE`, account-only (401 otherwise), 503 without `SESSION_SECRET`.
  Account page has a "Your model key" section to add/remove a text key.
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
- Account page has an **image-key** slot; generate a portrait from a character's card.
- **Model:** `gpt-image-2` (2026-10-16). OpenAI retires `gpt-image-1` on 2026-10-23, so a key saved with it (or a
  `dall-e-*` model) runs `gpt-image-2` instead (`imageModelFor`). A refusal shows OpenAI's own reason, key-shaped
  text scrubbed (`providerReason`).
- **`fal` / `replicate`** keys are accepted and stored but not wired (no provider-side moderation story yet).

### Video clips on your own key — retired 2026-10-16
**OpenAI shut down `sora-2` and `sora-2-pro` on 2026-09-24** (their `/v1/models` entries carry that
`shutdown_date`), and `/v1/videos` now answers 404, with no successor model. So clips are retired
(`CLIPS_RETIRED` in `lib/image.ts`):
- `POST /api/characters/[id]/clip` answers `410 clips_retired` with that reason.
- A clip left rendering is closed out.
- The card shows an existing clip's stored poster as a still: the MP4 lived with the provider.
- The "Generate a clip" button is gone.

Bringing clips back means a new video provider with its own moderation story, which is a product call. What follows is how clips worked, kept for that day.

Same pattern as portraits, through OpenAI's **Sora** video API (`POST /v1/videos` → poll → content), which
moderates its own generation. The user pays, so it's $0 to us; the prompt is built only from filtered sheet text.

- **`POST /api/characters/[id]/clip`** (owner-only) starts the render and returns right away (`202`), recording
  a pending `clip` asset with the provider's video id. **`GET /api/characters/[id]/clip`** polls the provider
  on the owner's key; when it completes it stores the **thumbnail as a durable poster** and approves the asset.
- **`GET /api/assets/[id]/video`** streams the MP4 by proxying the provider on the **clip owner's** stored key
  (their content, their key); the durable poster (served by `/api/assets/[id]`) remains if the owner removes
  their key or the provider expires the content. The contestant card shows a `<video>` with that poster.
- Owner UI: "Generate a clip with your key" on the character card (it polls while the provider renders).

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
| `GOOGLE_OAUTH_CLIENT_ID` / `_SECRET` | "Continue with Google" | the button is hidden; handle+password still works |
| `OAUTH_REDIRECT_BASE` | pins the OAuth callback to the canonical domain (set on prod to `https://botchelor.vercel.app`) | the callback is derived from the request / Vercel's production domain |

## Turning on Google sign-in (owner action, ~5 minutes)

The whole flow is built and tested; it only needs an OAuth client, which has to be created under your Google
account (it's an app identity tied to your login — an agent can't mint it). `OAUTH_REDIRECT_BASE` is already
pinned on production, so the callback will match.

1. Google Cloud Console → **APIs & Services → OAuth consent screen**: External, add an app name and your
   support email, scopes `openid` and `email`. (A "Testing" app works for yourself; "Publish" for everyone.)
2. **APIs & Services → Credentials → Create credentials → OAuth client ID**, type **Web application**.
   Authorised redirect URI (exact): `https://botchelor.vercel.app/api/auth/google/callback`.
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
- `tests/image.test.ts` — the prompt is built from filtered text, generation on the user's key (injected
  fetch), provider refusals surface, owner-only, the asset is recorded approved and served, and the serving
  route never returns an unapproved asset.
- `npm run e2e` — sign up (adopting the browser's characters/dates), bring a key (last-four shown), change a
  date's visibility, edit a character on its card.
