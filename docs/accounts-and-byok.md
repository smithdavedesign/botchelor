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
- **Image / video** providers (`openai`, `fal`, `replicate`) are accepted and stored for later — generation
  isn't built yet (it needs spend + moderation; see the upgrade doc).

### Not yet
- A blind date between two users where only one has a key: that user's turns use their key; the other's and
  the director stay on the platform (correct, just not fully offloaded).
- Browser-only (unsaved) keys: the generation pipeline is an async background job, so a key has to be stored
  (encrypted) for the worker to use it. Ephemeral keys would need the key passed through the job, which we
  don't do.

## What each secret enables

| Env | Enables | Without it |
|---|---|---|
| `SESSION_SECRET` | signed sessions → accounts and BYOK | anonymous-only, unsigned `bz_uid`, as before |
| `GOOGLE_OAUTH_CLIENT_ID` / `_SECRET` | "Continue with Google" | the button is hidden; handle+password still works |

## Tests
- `tests/auth.test.ts` — session signing, passwords, account linking, the routes.
- `tests/characters.test.ts` — owner edits, non-owner/house 404s, content filter, hard-delete vs tombstone.
- `tests/visibility.test.ts` — feed/view scoping, host-only changes, watch-party rules, private excluded from
  the public record.
- `tests/keys.test.ts` — encryption / last-four-only, provider allowlist, auth gating, the per-side routing
  rule, and a live conversation proving no soul crosses a key boundary.
- `npm run e2e` — sign up (adopting the browser's characters/dates), bring a key (last-four shown), change a
  date's visibility, edit a character on its card.
