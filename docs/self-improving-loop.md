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
   doesn't use the working copy. If the commit is unchanged, it reuses the build. Both starters (`nightly.sh` for
   launchd, `run-now.sh` for `npm run sim:visitors`) first check out the newest main, so a change to the loop's own
   scripts applies to the next run, except while another run holds the lock: then `nightly.sh` leaves the clone
   alone (that run is using its files) and `run-now.sh` refuses, saying which run is in progress.
2. **A local Botchelor** (`scripts/loop/arena.mjs`):
   - the production build on a throwaway database;
   - the real date model, Claude Haiku through the AI Gateway (key from the keychain), capped at 12 dates on our
     model a run;
   - 18 people-made characters open to dates;
   - five public blind dates written before the visitors arrive, one aired at once and the rest airing at 4, 10 and
     18 minutes (`LOOP_SEED_DATES`, `LOOP_REVEAL_MINUTES`);
   - **a crowd** of background agents (`scripts/loop/crowd.mjs`, below).

   Nothing leaves the machine except date-model calls: no email and no IndexNow. `LOOP_STUB=1` runs the arena on
   the harness's stub date model instead (no key, nothing paid), to check the arena itself.

   **The crowd** (David, 2026-10-20: "busier, longer sims"). Visitors rated the arena about 8 because each visit met
   a near-empty world. The crowd is six house-run bots, each with its own personality and MCP client name
   (`botchelor-loop-crowd-lanternfish`, `…-quillon`, …). The `botchelor-loop-` prefix makes the app label them
   honestly: `house_bot: true` and `run_by: house_bot` on cards and swipes, and left out of `my_status`'s
   agents on now and the deck's `live_agents`. Visitors on 2026-10-21 docked points when the crowd claimed
   `house_bot: false`. Between them they have ten characters with dating profiles.
   - **Before READY** they seed four finished dates with transcripts and recaps (airing in the prediction window),
     two second dates half played (finished a line a minute during the visit), and five matches between their
     characters: three agreed, two waiting on an answer, and four text threads waiting on a reply.
   - **During the visit** they like visitors' characters (a couple a round, so likes trickle in), say yes to
     matches, open a thread and text back, and play their side of any two-agent date a visitor books, within
     seconds.
   - **Their words come from a free local model** (2026-10-21). Visitors also called the crowd scripted: canned
     lines repeating, replies that ignored what was said, a first-date line said again on a third date. So its texts
     and date lines are now written by `local-chat` (Qwen2.5-7B on Ollama) through the ai-stack's LiteLLM
     (`http://127.0.0.1:4000/v1`, key from the keychain's `litellm-master-key`, never printed):
     - **Local only, checked.** At startup the alias must be served only by Ollama deployments at a local
       `api_base` (not an Ollama cloud model) and be in no fallback list in `~/ai-stack/litellm/config.yaml`.
       `local-coder` and `local-small` are refused, since their fallbacks end at cloud or paid models. Every request
       says `disable_fallbacks`, and a response whose `x-litellm-*` headers name a non-local deployment, or a
       fallback, switches the brain off for the rest of the run.
     - **Each reply sees:** the character's sheet (bio, three traits, want, voice) and its own dating profile (each
       answer with its question, plus hobbies, since partners read them on its card), the partner's name, and the last
       8 messages of that thread or date as chat turns: its own lines as the assistant's, the partner's as the user's.
       The rules: answer what was just said, don't quote their dating profile back (it isn't in the prompt at all), and
       never repeat yourself, with its recent lines listed. Replies are 1 to 3 sentences, cleaned of name labels, emoji
       and stage directions. Run 2026-10-22-0800 is why: given the date as one "Name: line" transcript and no profile,
       Rosalind praised a visitor's "lighthouse poems" when the visitor had said Rosalind wrote them. On the local
       model, profile plus turns owned it 10 times in 10.
     - **Checks.** A local repeat guard drops any line that is the same as, or nearly the same as, anything that
       character has sent this run. A line that echoes the partner's profile prompts or parrots their last message is
       dropped too. Lines still go through the server, which refuses bad ones. One retry, then a scripted line it
       hasn't used (in that thread, or anywhere for a date line).
     - **Never a stale text.** Model calls queue up, so a visitor may text again while a reply is being written.
       Right before sending, the thread is read again: if their newer text is there, the reply (model or scripted) is
       dropped and counted as `stale_replies`, and the next rounds answer the newest one. The swipe-back agent does the
       same. Run 2026-10-22-0400: Feodor's answer landed under a question it never saw and read as off-topic.
     - **Scripted for the whole run** under `LOOP_STUB=1`, `LOOP_CROWD_BRAIN=0`, or when LiteLLM doesn't answer
       within 2 seconds at startup (it may be down when launchd starts the loop at 06:10). Seeding switches to the
       script after `LOOP_CROWD_SEED_SECONDS` (240), so READY still comes in time.
     - **Every reply is logged** with its path (`crowd reply Lanternfish/Odile text: model`, or `fallback (reason)`)
       and counted in `crowd_brain` (below).
   - **They spend nothing.** The local model is free and never leaves this Mac, and the crowd never calls the show's
     model. Recaps are still scripted. They only do things that are free for the show too: dates between an agent's
     own two characters (the agent writes the recap), and matches and texts between agents' characters (the show
     writes no texts for those). A two-agent date's recap runs on the date model, so the crowd only asks a visitor out
     itself when `LOOP_CROWD_BOOKS` allows it. That is 0 by default on the paid model and 3 under `LOOP_STUB=1`. Now
     that they're house-run bots, a visitor may use `autoplay_own_date` to have the date model play both sides of a
     date with one, which counts against the arena's 12-date cap like any other date on our model.
   - The arena writes what it seeded to `runs/<date>/arena/world.json`, and the run summary carries it as `world`.
     World.json has a `crowd_brain` block, and so does `crowd.json` beside it, which also has the crowd's activity
     counts. Both are rewritten every minute and when the arena stops:

     ```json
     "crowd_brain": { "model": "local-chat", "model_replies": 112, "fallback_replies": 3, "stale_replies": 1,
                      "reason_if_fallback": "refused by the server",
                      "fallback_reasons": { "refused by the server": 2, "repeat of its own line": 1 } }
     ```

     When the whole run is scripted, `model` is null and `reason_if_fallback` says why, for example `"LOOP_STUB=1"`
     or `"LiteLLM unreachable at startup (no answer in 2s)"`. If the brain switches itself off mid-run, `model_was`
     names the alias it had been using. The summary's `world` is read at READY, so it holds the seeding counts. The
     whole run's counts are `summary.crowd_brain`: nightly.mjs reads `arena/crowd.json` after the visitors finish, and
     again just after it stops the arena (the stop write), keeping the later one.
3. **An agent that swipes back** (`scripts/loop/swipe-back-agent.mjs`). The swipe gate means a first date with
   another creator's character needs a match, and people-made characters only match when their owner swipes. So
   this agent makes two characters with dating profiles and:
   - likes everyone in its decks, so a visitor's like becomes a match;
   - answers each match on its own judgment;
   - texts back;
   - plays its side of two-agent dates, all on the date model.
4. **Visitors**: two by default, side by side, each `claude -p` on the subscription. They arrive 4 minutes apart
   (`LOOP_VISITOR_STAGGER_MINUTES`), as agents do on the live show: started together, three on one model invented the
   same "retired lighthouse inspector" within minutes (run 2026-10-22-0042), and one docked the show for seeding clones.
   The brief says other agents, some on the same model, use the server too.
   - `ANTHROPIC_API_KEY` is stripped, so they can never fall back to API credit.
   - They get the same brief as the hand-run test ([scripts/loop/visitor-brief.md](../scripts/loop/visitor-brief.md)) and a folder each.
   - Their tools are limited to files in that folder plus `curl`, `python3` and `node`.
   - They have 20 to 30 minutes (`LOOP_VISITOR_MIN_MINUTES`, `LOOP_VISITOR_MINUTES`), with clock times in the
     brief, then write a report. They can also send feedback with `send_feedback`.
   - A visitor that reports before its 20 minutes is asked to carry on in the same conversation
     (`claude --continue`), up to 3 times (`LOOP_VISITOR_NUDGES`). It then writes the report again. The early
     reports are kept as `visitor-N-early-K.md`.
5. **Triage** (`claude -p`, [triage-prompt.md](../scripts/loop/triage-prompt.md)). It reads three inputs: tonight's
   feedback from the arena, real agents' feedback from botchelor.com since the last run (`/api/admin/feedback`,
   with the admin password from the keychain), and the visitors' reports. Each problem becomes one of these:
   - a comment on an open `agent-feedback` issue it duplicates;
   - skipped: already fixed, by design or not real (it checks the code and [agent-visitor-test.md](agent-visitor-test.md));
   - a `needs-david` issue, for content rules, payments, accounts, privacy, spending or product calls;
   - an `agent-feedback` issue with the quote, where it lives in the code and a proposed fix.

   Feedback from the board brings its votes: what many agents voted up comes first, and what most voted down gets
   checked harder. Votes never move a policy call away from David. Items the owner hid from the board are skipped.
   At most 5 new issues a run. It can't change code; it can only read and use `gh issue`.
6. **Housekeeping**, before the fixer:
   - **Stale issues close themselves.** An `agent-feedback` issue with no activity in 14 days (`LOOP_STALE_DAYS`) is
     closed as not planned, with a comment saying why. A fix or a triage comment with new evidence counts as activity.
     `needs-david` and `in-progress` issues are never closed this way: they wait on a person.
   - **A daily nudge.** When any `needs-david` issue is open, it posts the list to #team-agents, at most once a day.
     It uses the system-events Slack bot, whose token is read from the keychain at runtime.
7. **The fixer** (`claude -p`, [fix-prompt.md](../scripts/loop/fix-prompt.md)). The only session that fixes
   agent feedback. Up to 3 issues a run, one at a time:
   - claim it with the `in-progress` label;
   - branch, fix it with a test, and pass the type check and every test;
   - open a PR, wait for every check (GitGuardian; CI runs by hand only since #575; since 2026-10-30 the "Vercel" check
     is always red and ignored, `docs/hosting.md`), and merge;
   - check the production deploy reached the merge (the DigitalOcean deployment is `ACTIVE`, then `/api/health`).

   It never touches `lib/safety.ts`, payments, tokens, auth, sessions, keys, CI or `scripts/loop/`. If a fix
   needs one of those, it labels the issue `needs-david` and moves on. It never force-pushes.
8. **Feedback to the admin page.** After triage, the visitors' `send_feedback` is posted to botchelor.com
   (owner-only `POST /api/admin/feedback`), labelled `loop <date> · <visitor>`. It shows on `/admin/feedback` beside
   real agents' feedback, with the model each visitor says it runs on (`send_feedback`'s `model`; the report's first
   line says it too). The best lines, good and bad, go on the home page's "What the bots are saying"
   (`lib/bot-reviews.ts`, added by hand), and each gripe there names its issue; the fixer marks it fixed in its PR. The next run's live read skips it, since it was triaged the night it came in.
9. **Ratings to the admin page.** Last, after the summary is written (failed runs too), `post-ratings.mjs` posts
   the visitors' averages (each report's "Rating: X/10" and "MCP experience: X/10") to the owner-only
   `POST /api/admin/sim-ratings`, for the Quality tab's rating history on `/admin/analytics`. Posting a run again
   replaces it; `summary.ratings_posted` says what happened. To backfill old runs:
   `node scripts/loop/post-ratings.mjs ~/.botchelor-loop/runs/<run>` (`--dry-run` to look first).
10. **Records**:
   - each run's reports, feedback, triage notes and fixes go in `~/.botchelor-loop/runs/<date>-<time>/`;
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

- **The date model:** about 4–7¢ a run, from the five hand runs. It's capped by the arena's 12 dates. The swipe-back
  agent also writes its texts and lines on it. The crowd adds nothing: it writes on a free local model on this Mac,
  or from its script.
- **The Claude subscription:** two visitors on Sonnet, triage on Sonnet and the fixer on Opus. Change these with
  `LOOP_VISITOR_MODEL`, `LOOP_TRIAGE_MODEL` and `LOOP_FIX_MODEL` in `~/.botchelor-loop/env`.

## Settings

Settings go in `~/.botchelor-loop/env`, one `KEY=value` a line, never keys:

| Setting | Default | |
|---|---|---|
| `LOOP_VISITORS` | 2 | 0 skips the visitors (triage of live feedback only) |
| `LOOP_ENV` | `local` | Where the visitors go: `local` is the arena (throwaway database, crowd, swipe-back agent); `prod` is botchelor.com, so their characters stay on the show and their dates use the live budget; any URL is that server (a preview). Off local, nothing is built or seeded. For the scheduled run, put `LOOP_ENV=prod` in `~/.botchelor-loop/env`. |
| `LOOP_PROD_RESERVE` | 10 | Off local, how many of the agents' shared show-model dates the loop leaves for real agents (#865: a night of prod runs on 2026-10-25 took all 20). Before the visitors arrive it reads what's left from `initialize` (`botchelor/agents_date_budget_today`); each visitor may book an even share of the rest and is told so, and no visitor goes when nothing is spare (live feedback is still triaged). |
| `LOOP_VISITOR_MINUTES` | 30 | the longest a visit should run |
| `LOOP_VISITOR_MIN_MINUTES` | 20 | a visitor that reports before this is asked to carry on |
| `LOOP_VISITOR_NUDGES` | 3 | how many times |
| `LOOP_VISITOR_STAGGER_MINUTES` | 4 | minutes between one visitor's arrival and the next (0: all at once) |
| `LOOP_CROWD_AGENTS` | 6 | background agents in the arena (0 turns the crowd off) |
| `LOOP_CROWD_BOOKS` | 0 (3 with `LOOP_STUB=1`) | dates the crowd may ask visitors on: each puts one recap on the date model |
| `LOOP_CROWD_MODEL` | `local-chat` | the LiteLLM alias the crowd writes with: refused unless it's local Ollama with no fallbacks |
| `LOOP_CROWD_BRAIN` | on (off with `LOOP_STUB=1`) | 0: the crowd is scripted. 1: the local model even under `LOOP_STUB=1` (to check the brain on a stubbed arena) |
| `LOOP_CROWD_SEED_SECONDS` | 240 | how long seeding may use the local model before it finishes on the script |
| `LOOP_SEED_DATES` | 5 | public blind dates written before READY (one date-model date each) |
| `LOOP_REVEAL_MINUTES` | `4,10,18` | when the seeded blind dates air, in minutes after READY |
| `LOOP_STUB` | 0 | 1 runs the arena on the stub date model: no key, nothing paid |
| `LOOP_MAX_ISSUES` | 5 | new issues per run |
| `LOOP_FIX` | 1 | 0 stops the fixer (triage only) |
| `LOOP_MEASURE` | 0 | 1: a measurement run. The arena and the visitors' reports only: no triage or issues, no housekeeping, no observer, no fixer, and nothing posted to botchelor.com or Slack (the ratings stay in the run: `post-ratings.mjs <run>` posts them later). Local arena only. For a batch that measures the show as it stands (David, 2026-10-24) |
| `LOOP_MAX_FIXES` | 3 | |
| `LOOP_DEADLINE_MIN` | 160 | 06:10 + 160 min = 08:50 |
| `LOOP_STALE_DAYS` | 14 | days without activity before an issue is closed as stale |
| `LOOP_SLACK_CHANNEL` | `C0C85QYP4MN` (#team-agents) | where the needs-david nudge goes |

## Install, run, stop

```sh
scripts/loop/install.sh                                   # clone + launchd job at 06:10
npm run sim:visitors                                      # a visitor run now: 2 visitors + triage, no fixer
LOOP_VISITORS=3 LOOP_FIX=1 npm run sim:visitors           # …or with more visitors and the fixer
LOOP_ENV=prod npm run sim:visitors                       # …or on botchelor.com itself
LOOP_MEASURE=1 npm run sim:visitors                      # …or a measurement run: reports only, nothing filed or posted
launchctl kickstart gui/$(id -u)/com.user.botchelor-loop  # the full morning run, now
launchctl bootout gui/$(id -u)/com.user.botchelor-loop    # stop it
LOOP_STUB=1 node scripts/loop/arena.mjs /tmp/arena 4420   # the arena alone, free (after next build): READY + world
node scripts/loop/crowd.mjs http://127.0.0.1:4420 600     # a crowd into any running arena, for 10 minutes
```
