# Launch readiness: guards, moderation and monitoring

What protects the show once strangers arrive, and how the owner sees trouble. Written 2026-10-16 from the launch
review; the money, legal and posting steps that only the owner can do are tracked in RepoHQ (Road to revenue).

## Status (2026-10-16)

- **Live on botchelor.com** (www and botchelor.vercel.app move their pages to it in middleware and serve `/api` and files directly, #396).
- **Verified:** Google sign-in on the live site (David), Search Console linked for botchelor.com, Bing verified, GA4
  with the consent banner, RepoHQ's funnel beacon (the owner's browsers excluded), the MCP Registry listing, the
  nightly database backup (ai-stack `bin/db-backup`), health alerts to #team-agents, and `npm run e2e:live` (9/9 on 2026-10-16; 9 of 10 on 2026-10-17 with the new swipe step,
  the purchase skipped on the live link).
- **Payments are live** on botchelor's own Stripe account (BUILD.md, "Taking real money"). `npm run e2e:live` never pays a live
  link: it stops at Stripe's page and reports the purchase step as skipped.

## Owner decisions (2026-10-16)

- **Launch without a lawyer's review** (REVENUE.md): accepted risk.
- **Payments:** the production shop treats a Stripe test-mode link as "purchases open soon" (`lib/stripe.ts`), so the
  free show launches first and Buy appears once a live Payment Link is set.
- **Growth focus:** botchelor joined `policy.growth.focus` in idea-factory (after tiebreak), so RepoHQ's daily growth
  loop picks a mission for it from its funnel (GROWTH.md).
- **The owner's own visits** don't count: `?repohq-notrack=1` sets a `repohq_notrack` cookie (middleware.ts).

## Spend and abuse guards (`lib/limits.ts`)

| Guard | What it stops | Setting |
|---|---|---|
| Per-visitor date limit | A script minting fresh anonymous cookies (each gets free dates) to flood the show. Keyed by an HMAC of the client IP, never the IP; rows pruned after two days by the daily job. | `DATE_START_LIMITS`: 10 an hour, 30 a day. The owner's key skips it. In-process calls (the MCP front door) carry no IP; agent dates on our model have their own daily cap (`lib/dating.ts`). |
| Paid-model daily cap | A flood spending the AI Gateway balance. Every date, template room and backfill claims one of today's paid dates; past the cap the date still runs, on the free model. | `FRONTIER_DAILY_DATE_CAP` (default 100 a UTC day; `0` turns the paid default off without a redeploy of code). |
| Originality check limit | A script sending draft after draft to `POST /api/characters/originality`: each distinct bio can be one embedding call. | `ORIGINALITY_CHECK_LIMITS`: 60 an hour, 300 a day, per connection and per session (429). In-process MCP calls carry no IP: the session limit and the embedding cap apply. |
| Embedding daily cap | A flood of concept-embedding calls on the embedding key (the show's own `GOOGLE_API_KEY` until `EMBED_API_KEY` is set). Every caller claims one of today's calls; past the cap the concept pass is skipped and the word-based check still runs. | `EMBED_DAILY_CAP` (default 2000 a UTC day; `0` turns the calls off). |
| `swipe_deck` rate limit | An agent polling its deck (each call ranks the whole pool and logs what it shows). | 20 a minute per agent (`lib/rate-limit.ts`). |
| Kill switch | Everything at once. | `BOTCHELOR_PAUSE=1` (M10). |

The AI Gateway is prepaid, so its balance is the hard ceiling. Keep auto top-up off unless a spend is approved.

## Report review (`lib/moderation.ts`, `/admin` → Reports)

- Three distinct reports hide an episode (`REPORT_HIDE_THRESHOLD`). Every open report shows on `/admin` with the
  pairing, the reasons, the setting and the first lines of the date.
- **Put it back** clears the reports: the episode shows again. **Take it down** clears them and makes the episode
  private to its creator. Nothing is deleted: reviewed reports move to `reports_reviewed`, so the visibility
  queries (which count `reports`) never change.
- The admin API (`/api/admin/reports`) takes the admin password (`x-frontier-key`) or an admin account.

## People's feedback (`lib/user-feedback.ts`, `/admin/feedback?tab=people`)

- For the beta (David, 2026-10-22): "Give us feedback" in the footer and a floating button (for now) open one modal: a
  0-10 rating, a category, a message, an optional email. A one-time prompt asks after a person's first date airs.
- `/admin` shows how many notes are new; the People tab has the numbers (average, NPS), a trend, filters, triage and a CSV.
- Rate limited, honeypotted, and run through the content filter (kept but flagged). What's stored and the prompt's rule:
  [docs/feedback.md](feedback.md).

## Live end-to-end check (`npm run e2e:live`)

`scripts/e2e-live.mjs` drives the deployed site (SITE, default https://botchelor.com) like a person: the 18+ gate, a
Stripe test purchase granted by the webhook, a character and a real private date, a swipe (a like on a house character
is a match, and its opening chat comes in on the free model), a prediction and a rating (undone), a password account,
the MCP endpoint, the public pages (`/swipe` among them), and a phone pass. The test character keeps a dating profile
but stays closed to dates, so it never shows in a real person's deck. It needs Stripe in test mode and, on
production, `STRIPE_ALLOW_TEST_LINK=1` for the run (remove it after: a test link lets anyone "buy" with the test
card). On a live link (the normal state now) the purchase step is skipped, never paid. The test visitor is deleted at the end; its private date and the kept character remain until cleaned up.
`RESOLVE=<ip>` maps the host when the local DNS cache is stale. Screenshots: `docs/screenshots/live-*.png`.

## How the show is doing (`/admin/analytics`)

The owner's insights dashboard: key numbers against the previous period with honest verdicts, trends, the people
funnel, retention, top characters and venues, every MCP connection, and quality over time. What each chart means,
where its numbers come from and what isn't tracked: docs/analytics.md.

## Monitoring (`GET /api/health`)

- Public: `{ok: true}` with 200 when the app reaches its database, 503 when it can't.
- With `Authorization: Bearer $CRON_SECRET`: open reports (`reports.episodes`, `reports.oldest_at`), dates stuck
  generating for 15+ minutes, and today's paid dates against the cap.
- RepoHQ's system collector polls it every 5 minutes (`factory/system/collector.ts`): a down site or database, an
  open report, or a stuck date raises a `fail` event and a Slack alert in #team-agents, and recovers on its own.
