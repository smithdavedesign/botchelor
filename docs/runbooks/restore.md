# Runbook: restoring the database

_2026-11-22. For data that was deleted or damaged, or a database that's gone. Code problems are
[rollback.md](rollback.md); the first steps of any outage are [incident.md](incident.md)._

The database is Neon project `cool-boat-29098893` (Postgres 18, `aws-us-west-2`), branch `main`
(`br-rapid-rice-ard1rwy8`), which both apps use. Three ways back, newest first:

| Way back | Covers | Set |
|---|---|---|
| **Point in time** on `main` | any moment of the last **7 days** | `history_retention_seconds` 604800 (it was 6 hours until 2026-11-22) |
| **Snapshots** of `main` | daily at 11:00 UTC, kept **14 days**; weekly at 11:00 UTC, kept **35 days** | Neon's snapshot schedule on `main`; the first is 2026-11-22 11:00 UTC |
| **The nightly dump** on David's Mac | each night's copy for 7 nights, then one a week for a month | ai-stack `bin/db-backup botchelor` at 03:40 Mac time (launchd), `~/backups/botchelor/botchelor-YYYY-MM-DD.dump`, about 1.2–1.3 GB |

The dump runs late when the Mac sleeps, and it is the only copy that doesn't live at Neon. Bunny's media (After Dark)
has no versions: a deleted file there is gone.

**Restoring `main` replaces it.** Everything written after the moment you pick leaves `main` (it's kept in the preserved
branch, below), so that is David's call. Looking at the past on a side branch changes nothing and is the first step.

The commands use the Neon CLI (`neon`, signed in to the account that owns the project) with
`--project-id cool-boat-29098893` on each. A side branch's compute bills by the hour it runs ($0.106 a CU-hour on
Launch): delete it when you're done.

## 1. Pick the moment

The last good moment, in UTC: when the bad deploy went live (DigitalOcean → Activity, or /admin → Servers), when the
bad job part ran (`ops_log`, `job_runs`), or the time in the report. Take a minute or two before it.

## 2. Look at it on a side branch first

```sh
P="--project-id cool-boat-29098893"
neon branches create $P --name restore-check --parent 2026-11-22T10:00:00Z   # a timestamp: main as it was then
# Older than 7 days: a snapshot instead
neon snapshots list $P
neon snapshots restore <snapshot id> $P --name restore-check                  # a new branch, main untouched
```

Connect with `psql "$(neon connection-string restore-check $P)"` and check the rows you care about against `main`.
For a few rows, the side branch is often the whole fix: copy them back with an `insert ... select` through a script, or
`pg_dump --data-only --table=<table>` from the branch, and leave `main` alone.

## 3. Restore `main` (David's call)

```sh
# From main's own history (last 7 days); the old main is kept as main-before-restore
neon branches restore main ^self@2026-11-22T10:00:00Z $P --preserve-under-name main-before-restore
# From a snapshot: restore onto main without finalizing, check it, then swap it in
neon snapshots restore <snapshot id> $P --target-branch main
neon snapshots finalize <the branch it printed> $P
```

`main` keeps its id, computes and connection string, so neither app's `DATABASE_URL` changes; their connections drop
and reconnect. Then check `https://botchelor.com/api/health?db=1` and `https://ad.botchelor.com/api/health?db=1`
(`{"ok":true,"db":"ok"}`) and the rows themselves. Keep `main-before-restore` until you're sure, then delete it and
`restore-check` (`neon branches delete <name> $P`).

## 4. If Neon itself is gone: the nightly dump

Restore into an empty Postgres 18 database (a new Neon project, or a branch with nothing in it), with the Postgres 18
tools (`/opt/homebrew/opt/libpq/bin`; the dump is from `pg_dump` 18):

```sh
/opt/homebrew/opt/libpq/bin/pg_restore --no-owner --no-privileges -d "$TARGET_URL" ~/backups/botchelor/botchelor-2026-11-22.dump
```

Put the target's address in a variable from the keychain or the Neon console, never on a command line you keep. Then:
store it with `~/ai-stack/bin/secrets add botchelor DATABASE_URL`, set `DATABASE_URL` on both apps (and the show's
`DATABASE_URL_UNPOOLED`) in DigitalOcean (Encrypt), and let them redeploy. The first start applies the schema
(`ensureSchemaCurrent`, `lib/db.ts`) and logs `[db] schema apply ok`. Anything written after 03:40 Mac time that night is
lost.

## Rehearsed

- **2026-11-22, the dump, locally:** see "Rehearsal" below for the result of restoring that morning's dump into a
  throwaway local Postgres.
- **Not yet:** a point-in-time side branch and a snapshot restored to a side branch (a few cents of compute, nothing
  touched on `main`): do one the next time someone is at Neon's console, and note it here.
