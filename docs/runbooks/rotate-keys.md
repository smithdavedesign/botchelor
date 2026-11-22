# Runbook: rotating keys

_2026-11-22. For a key that leaked, one that expires, or a routine change. Names only here, never a value._

**Keys live in the macOS keychain** as `vault/botchelor/<NAME>`, through `~/ai-stack/bin/secrets`, and in DigitalOcean's
encrypted environment values. Never write a key into a file, a commit, an issue, a chat or a command line you keep.
`CRON_SECRET` never goes to an outside service.

## The steps, for any key

1. **Make the new key** at the provider. If it can spend money, set its spend limit there as you create it.
2. **Store it:** `~/ai-stack/bin/secrets add botchelor <NAME> --cap "<limit>"`. It asks for the value without showing
   it and replaces `vault/botchelor/<NAME>`. A secret of our own (no provider) is any long random value:
   `openssl rand -base64 48 | tr -d '\n' | pbcopy` puts one on the clipboard without printing it; paste it at the
   prompt and in step 3, then clear the clipboard (`pbcopy < /dev/null`).
3. **Set it in DigitalOcean** on every app the table lists: Apps → the app → Settings → the component (or App-Level)
   → Environment Variables → Edit → paste → Encrypt → Save. Saving redeploys that app, so change all of one app's
   values in one save.
4. **Check** both health URLs (`https://botchelor.com/api/health?db=1`, `https://ad.botchelor.com/api/health?db=1`)
   and the feature that uses the key.
5. **Revoke the old key** at the provider. If an old copy stays in a backup or file,
   `~/ai-stack/bin/secrets revoked <file> <NAME>` stops the daily scan from flagging it.

Where it's set, below: **show** is `botchelor-show` (service `web`), **AD** is After Dark's app `botchelor` (service
`botchelor`), **job** is AD's hourly job `lobby`, **AD Settings** is After Dark's admin Settings page (the key is
sealed in the database: no deploy, nothing in DigitalOcean), **Mac** is the keychain only.

## Each provider

| Provider | Names | Where | How, and what to watch |
|---|---|---|---|
| Neon (database) | `DATABASE_URL`, `DATABASE_URL_UNPOOLED` | show (both), AD (`DATABASE_URL`), Mac (the nightly backup reads it) | Neon console → the project → Branches → `main` → Roles → reset the app role's password. The old one stops at once, so have both apps' edits ready; without a gap: make a second role with the same rights, move both apps to it, then remove the old role. |
| Ours: sign-in | `SESSION_SECRET` | show, AD (the same value) | Signs everyone out on both hosts. First check /admin's Stored keys panel counts no legacy keys (keys sealed from this secret before `KEY_ENCRYPTION_SECRET`), or they're lost. |
| Ours: stored keys | `KEY_ENCRYPTION_SECRET` | show, AD (the same value) | Seals people's own model keys and After Dark's house keys, and there's no second slot: a new value makes every stored key unreadable. Only if it leaked; then everyone saves their key again and the house keys are entered again on AD Settings. |
| Ours: jobs | `CRON_SECRET` | show, AD, job (the same value), Mac (RepoHQ's monitor sends it for the deep health check) | Change all three in one go: until they match, the hourly job's calls fail (`FAILED:` in its run). |
| Ours: admin | `WATCH_ADMIN_TOKEN`, `FRONTIER_PASSWORD` | show; `FRONTIER_PASSWORD` on AD too | Internal job token, and the admin tools' password. |
| OpenRouter | `FRONTIER_LLM_API_KEY` | show (the show's dates; kept as `OPENROUTER_SHOW_KEY` in the keychain, per `.do/show.yaml`) | openrouter.ai → Keys → create with a credit limit ($50 now), then delete the old key. After Dark's OpenRouter key is separate: AD Settings. |
| After Dark's house keys | OpenRouter, Venice, Hive, fal, Replicate, Sightengine, the moderation endpoint | AD Settings | Paste the new key and save, then revoke the old one at the provider. Venice tops itself up; the others are prepaid. |
| Google | `GOOGLE_API_KEY`, `EVAL_GOOGLE_API_KEY`, `EMBED_API_KEY` | show | Google Cloud console → APIs & Services → Credentials: a new key restricted to the APIs it needs, then delete the old one. |
| Google sign-in | `GOOGLE_OAUTH_CLIENT_SECRET` | show | Credentials → the OAuth client → add a secret, deploy it, then disable the old one (two can be live at once). |
| Stripe | `STRIPE_WEBHOOK_SECRET`, `STRIPE_PLANS_WEBHOOK_SECRET`, `OPERATOR_PASS_WEBHOOK_SECRET` | show | Developers → Webhooks → the endpoint → Roll secret; Stripe can keep the old one valid for a while, so set the new one before it ends. Payments use links: there's no Stripe API key on the apps. |
| Bunny | `MEDIA_BUNNY_KEY`, `MEDIA_BUNNY_TOKEN_KEY` | show, AD | Storage zone `botchelor-ad` → FTP & API Access → reset the password (`MEDIA_BUNNY_KEY`); pull zone `botchelor-ad-media` → Security → Token Authentication → a new key (`MEDIA_BUNNY_TOKEN_KEY`; links already handed out stop working). |
| Neon Object Storage | `MEDIA_S3_ACCESS_KEY_ID`, `MEDIA_S3_SECRET_ACCESS_KEY` | show | The show's media bucket: a new access key pair where the old one was made, both names in one save. |
| Replicate | `REPLICATE_API_TOKEN` | show, AD (AD Settings' own key wins on After Dark) | replicate.com → API tokens. |
| Resend | `RESEND_API_KEY` | show, AD (app-level) | resend.com → API Keys. |
| Deepgram | `DEEPGRAM_API_KEY` | show | Deepgram console → API Keys. |
| Didit | `DIDIT_API_KEY`, `DIDIT_WEBHOOK_SECRET` | show, AD | Didit's console: the key, and the webhook's secret. |
| Simli, Runpod | `SIMLI_API_KEY`; `RUNPOD_API_KEY` (app-level) | show | Each dashboard's API keys. Runpod is prepaid. |
| Cloudflare Workers AI | `WORKERS_AI_KEY` | show, and the `botchelor-images` Worker's `GATE_KEY` | Both sides: [workers/cf-images/README.md](../../workers/cf-images/README.md). |
| DigitalOcean billing | `DO_BILLING_TOKEN` | show | DigitalOcean → API → Tokens: a read-only token. |
| Discord | `DISCORD_WEBHOOK_URL` | show | The channel → Integrations → Webhooks: a new one, then delete the old. |
| IndexNow | `INDEXNOW_KEY` | show | Any new random 32-hex value; the app serves it at `/indexnow-key.txt`. |
| Web push | `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` | show | A pair, changed together. A new pair ends every push subscription (people turn notifications on again): only if it leaked. |
| DigitalOcean API | `DO_APPS_TOKEN` | Mac (the agents' deploy and rollback scripts) | **Expires 2026-11-29.** DigitalOcean → API → Tokens → Generate New Token, the app scopes it needs and an expiry, then `secrets add botchelor DO_APPS_TOKEN`. The old one lapses on its own. |

Tools on the Mac (the Neon CLI, Cloudflare, GitHub) have their own keys; `~/ai-stack/bin/secrets scan` lists every key
it finds by name, and RepoHQ → Settings → Keys shows them with their caps.
