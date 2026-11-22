# Runbook: an incident

_2026-11-22. Something in production is down, slow, wrong or spending. Work down the list; most incidents end at step
2 or 3. Related: [rollback.md](rollback.md), [restore.md](restore.md), [rotate-keys.md](rotate-keys.md)._

## What raises the alarm

- **UptimeRobot**, a keyword check every 5 minutes on `https://botchelor.com/api/health?db=1` and
  `https://ad.botchelor.com/api/health?db=1`, keyword `"db":"ok"`. The answer is `{"ok":true,"db":"ok"}`, or 503
  `{"ok":false,"db":"unreachable"}` when that server can't reach the database. It holds no secret and asks the
  database at most every 30 seconds per server (`lib/public-health.ts`), so being polled can't load it.
- **DigitalOcean's alerts** (email to the account, set in both `.do/*.yaml`): a failed deploy or domain, and on each
  web service CPU over 90% for 10 minutes, memory over 85% for 5 minutes, or more than one restart in 5 minutes.
- **RepoHQ's monitor** on David's Mac: botchelor.com's `/api/health` every 5 minutes and the deep check (with the cron
  secret) hourly. It stops while the Mac sleeps.
- **People**: the feedback form, email, Discord.

## 1. Is it everyone, and since when?

Load both health URLs and the home page; note the time in UTC. Health fine but a page broken is a code problem
(step 2); a 503 from `?db=1` is the database (step 4); nothing at all is the app or the edge (steps 3 and 5).

## 2. Did a deploy just go live?

/admin → Servers shows each host's commit, when it started and how often it started in the last day (each start is a
row in `ops_log`). DigitalOcean → Apps → the app → Activity has the deploys. A bad deploy: [rollback.md](rollback.md),
or revert the merge if the fix is quick. Merges deploy both apps about six minutes later; each app has one instance,
so every deploy restarts it.

## 3. Restarts without a deploy: memory or a crash

A start on the same commit as the one before is a restart. DigitalOcean → the app → Insights shows memory, CPU and
restarts. The show has 2 GB since 2026-11-22, After Dark 1 GB; each start's `ops_log` row records the memory the
container sees (`total_memory_mb`, the instance's size: 2048 and 1024) and the heap limit Node takes from it (1120
and 560 MB). The run log just before the restart usually says why (DigitalOcean → Runtime Logs, or
`doctl apps logs <app id> --type run_restarted`).

## 4. The database

`{"ok":false,"db":"unreachable"}` on both hosts: Neon's status page and the project's Monitoring tab in the Neon
console (project `cool-boat-29098893`, compute fixed at 0.25 CU). On one host only: that app (restart it from
DigitalOcean). Slow rather than down: the run log's `[db]` lines name the routes that waited, gave up or held a
connection long (`lib/db-watch.ts`).

## 5. The edge

botchelor.com goes through Cloudflare; ad.botchelor.com doesn't. Cloudflare's 502/504 means the app didn't answer in
time (its one instance busy or restarting), 520–526 an origin or certificate problem, 530 no origin at all. A burst of
requests from one agent or path shows in Cloudflare → botchelor.com → Analytics.

## Where the logs are

| Log | Keeps | Where |
|---|---|---|
| Runtime logs | the current container only: a deploy or restart takes them along | DigitalOcean → the app → Runtime Logs, or `doctl apps logs <app id> --type run --follow` |
| `ops_log` | 30 days: each server start (commit, memory and heap limits), each failed date or conversation with its reason, each date's cost, each part of the daily job (started, done, failed) | /admin → Servers, or a read-only query |
| `server_errors` | 7 days: route failures and database pool timeouts | the deep health check's count and latest, or a read-only query |
| `job_runs` | each daily-job part's time, memory peak and longest event-loop stall | the deep health check, or a query |
| The hourly job's runs | each run's output; a call that didn't end `"ok":true` prints `FAILED: <host> <job>` and fails the run | DigitalOcean → After Dark's app (`botchelor`) → the `lobby` job |

## Stop the harm first

- **A bad deploy:** [rollback.md](rollback.md).
- **One feature misbehaving:** its switch ([../switches.md](../switches.md)). An environment value redeploys the app
  with it; After Dark's pieces also have database switches on its Settings page, which apply at once.
- **Spend running away:** `BOTCHELOR_PAUSE=1` on the show's app (and After Dark's) stops all generation; dates fail
  closed with a plain "Generation is paused" (`lib/compute.ts`). Behind it, each provider's own limit: OpenRouter keys
  have credit limits and the balance is prepaid; Venice tops itself up, so for Venice remove its key on After Dark's
  Settings page.
- **A flood of requests:** Cloudflare → botchelor.com → Security: a rule for the path or user agent, or Under Attack
  mode for a while. ad.botchelor.com has no such shield.
- **A key leaked:** [rotate-keys.md](rotate-keys.md), that provider first.
- **Bad data:** [restore.md](restore.md), starting with a side branch.

## Afterwards

1. Both health URLs answer `{"ok":true,"db":"ok"}`, the page or job that broke works, and /admin → Servers shows the
   commit you expect.
2. Write it down in the fix's pull request: what broke, when (UTC), how it showed, what fixed it, and what would have
   caught it sooner. An agent also logs it to the system log:
   `~/ai-stack/bin/emit-event botchelor <component> incident fail "<one line>"`, then `ok` when it's over.
3. If an alarm stayed quiet, fix the alarm too.
