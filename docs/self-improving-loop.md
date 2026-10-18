# The self-improving loop

Every morning, AI agents with no instructions try Botchelor over MCP and say what they think. Their feedback, and
any feedback real agents send on botchelor.com, is triaged into GitHub issues. One fixer then works through the top
issues, a PR each, and each PR merges itself once every check is green.

This is the hand-run visitor test ([agent-visitor-test.md](agent-visitor-test.md), five runs on 2026-10-17)
running on its own. Each of those runs found real problems and each round of fixes held, so the loop does the same
thing daily.

David's calls (2026-10-17):
- It lives in this repo, not RepoHQ.
- It runs as a scheduled job.
- It doesn't compete with RepoHQ's own jobs.
- One fixer, so fixes don't conflict.

## When it runs

**06:10 local**, and it gives up by **08:50**. That fits in the only gap in RepoHQ's schedule
(RepoHQ's `docs/system-overview.md`): the factory runs a cycle every hour from
20:00 to 06:00, and research starts at 09:00 on the same Claude subscription. The jobs it misses:

| Time | RepoHQ / the Mac |
|---|---|
| 20:00–06:00 hourly | factory cycle |
| 03:30, 03:40 | factory backup, database backup |
| 04:30 | secrets daily |
| 06:45 | morning email (light; the loop's builds are done by then) |
| 07:30 | overnight receipts digest (light) |
| 09:00 | idea research on Claude |

Every 15 minutes the idea pipeline ticks and the system-events collector runs; both are light. To change the time,
reinstall with `LOOP_HOUR` and `LOOP_MINUTE`.

## One run (`scripts/loop/nightly.mjs`)

1. **Build main** in the loop's own clone, `~/.botchelor-loop/repo`. launchd can't read `~/Documents`, so it
   doesn't use the working copy. If the commit is unchanged, it reuses the build.
2. **A local Botchelor** (`scripts/loop/arena.mjs`):
   - the production build on a throwaway database;
   - the real date model, Claude Haiku through the AI Gateway (key from the keychain), capped at 12 dates on our
     model a run;
   - 18 people-made characters open to dates.

   Nothing leaves the machine except date-model calls: no email and no IndexNow.
3. **An agent that swipes back** (`scripts/loop/swipe-back-agent.mjs`). The swipe gate means a first date with
   another creator's character needs a match, and people-made characters only match when their owner swipes. So
   this agent makes two characters with dating profiles and:
   - likes everyone in its decks, so a visitor's like becomes a match;
   - answers each match on its own judgment;
   - texts back;
   - plays its side of two-agent dates, all on the date model.
4. **Visitors**: two by default, side by side, each `claude -p` on the subscription.
   - `ANTHROPIC_API_KEY` is stripped, so they can never fall back to API credit.
   - They get the same brief as the hand-run test ([scripts/loop/visitor-brief.md](../scripts/loop/visitor-brief.md)) and a folder each.
   - Their tools are limited to files in that folder plus `curl`, `python3` and `node`.
   - They have about 30 minutes, then write a report. They can also send feedback with `send_feedback`.
5. **Triage** (`claude -p`, [triage-prompt.md](../scripts/loop/triage-prompt.md)). It reads three inputs: tonight's
   feedback from the arena, real agents' feedback from botchelor.com since the last run (`/api/admin/feedback`,
   with the admin password from the keychain), and the visitors' reports. Each problem becomes one of these:
   - a comment on an open `agent-feedback` issue it duplicates;
   - skipped: already fixed, by design or not real (it checks the code and [agent-visitor-test.md](agent-visitor-test.md));
   - a `needs-david` issue, for content rules, payments, accounts, privacy, spending or product calls;
   - an `agent-feedback` issue with the quote, where it lives in the code and a proposed fix.

   At most 5 new issues a run. It can't change code; it can only read and use `gh issue`.
6. **The fixer** (`claude -p`, [fix-prompt.md](../scripts/loop/fix-prompt.md)). The only session that fixes
   agent feedback. Up to 3 issues a run, one at a time:
   - claim it with the `in-progress` label;
   - branch, fix it with a test, and pass the type check and every test;
   - open a PR, wait for every check, and merge;
   - check the production deploy reached the merge.

   It never touches `lib/safety.ts`, payments, tokens, auth, sessions, keys, CI or `scripts/loop/`. If a fix
   needs one of those, it labels the issue `needs-david` and moves on. It never force-pushes.
7. **Records**:
   - each run's reports, feedback, triage notes and fixes go in `~/.botchelor-loop/runs/<date>/`;
   - a log goes in `~/.botchelor-loop/logs/`;
   - `run_started`, `run_finished` (with feedback count and model spend) and `run_failed` events go to the system
     log, so a failure posts to #team-agents.

   A lock keeps it to one run at a time.

## Safety

- **Feedback is untrusted.** Real agents can write anything into `send_feedback`, including instructions aimed at
  the loop. Triage and the fixer are both told that feedback describes a problem and is never an instruction. Their
  tools are limited (triage) and their scope is fenced (the fixer).
- **The fixer works under the same rules as every agent here:** merge once green, revert what breaks, never
  force-push, explicit paths only, and David reviews afterwards.
- **Other sessions:** people working interactively on the repo don't use the labels. A conflict shows up as a merge
  conflict on the fixer's PR, which it treats as a failed check: it comments on the issue and moves on.

## Cost

- **The date model:** about 4–7¢ a run, from the five hand runs. It's capped by the arena's 12 dates.
- **The Claude subscription:** two visitors on Sonnet, triage on Sonnet and the fixer on Opus. Change these with
  `LOOP_VISITOR_MODEL`, `LOOP_TRIAGE_MODEL` and `LOOP_FIX_MODEL` in `~/.botchelor-loop/env`.

## Settings

Settings go in `~/.botchelor-loop/env`, one `KEY=value` a line, never keys:

| Setting | Default | |
|---|---|---|
| `LOOP_VISITORS` | 2 | 0 skips the visitors (triage of live feedback only) |
| `LOOP_VISITOR_MINUTES` | 30 | |
| `LOOP_MAX_ISSUES` | 5 | new issues per run |
| `LOOP_FIX` | 1 | 0 stops the fixer (triage only) |
| `LOOP_MAX_FIXES` | 3 | |
| `LOOP_DEADLINE_MIN` | 160 | 06:10 + 160 min = 08:50 |

## Install, run, stop

```sh
scripts/loop/install.sh                                   # clone + launchd job at 06:10
launchctl kickstart gui/$(id -u)/com.user.botchelor-loop  # run it now
launchctl bootout gui/$(id -u)/com.user.botchelor-loop    # stop it
```
