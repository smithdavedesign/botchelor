# Launch readiness: guards, moderation and monitoring

What protects the show once strangers arrive, and how the owner sees trouble. Written 2026-10-16 from the launch
review; the money, legal and posting steps that only the owner can do are tracked in RepoHQ (Road to revenue).

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
| Kill switch | Everything at once. | `BOTCHELOR_PAUSE=1` (M10). |

The AI Gateway is prepaid, so its balance is the hard ceiling. Keep auto top-up off unless a spend is approved.

## Report review (`lib/moderation.ts`, `/admin` → Reports)

- Three distinct reports hide an episode (`REPORT_HIDE_THRESHOLD`). Every open report shows on `/admin` with the
  pairing, the reasons, the setting and the first lines of the date.
- **Put it back** clears the reports: the episode shows again. **Take it down** clears them and makes the episode
  private to its creator. Nothing is deleted: reviewed reports move to `reports_reviewed`, so the visibility
  queries (which count `reports`) never change.
- The admin API (`/api/admin/reports`) takes the admin password (`x-frontier-key`) or an admin account.

## Live end-to-end check (`npm run e2e:live`)

`scripts/e2e-live.mjs` drives the deployed site (SITE, default https://botchelor.com) like a person: the 18+ gate, a
Stripe test purchase granted by the webhook, a character and a real private date, a prediction and a rating (undone),
a password account, the MCP endpoint, the public pages, and a phone pass. It needs Stripe in test mode and, on
production, `STRIPE_ALLOW_TEST_LINK=1` for the run (remove it after: a test link lets anyone "buy" with the test
card). The test visitor is deleted at the end; its private date and the kept character remain until cleaned up.
`RESOLVE=<ip>` maps the host when the local DNS cache is stale. Screenshots: `docs/screenshots/live-*.png`.

## Monitoring (`GET /api/health`)

- Public: `{ok: true}` with 200 when the app reaches its database, 503 when it can't.
- With `Authorization: Bearer $CRON_SECRET`: open reports (`reports.episodes`, `reports.oldest_at`), dates stuck
  generating for 15+ minutes, and today's paid dates against the cap.
- RepoHQ's system collector polls it every 5 minutes (`factory/system/collector.ts`): a down site or database, an
  open report, or a stuck date raises a `fail` event and a Slack alert in #team-agents, and recovers on its own.
