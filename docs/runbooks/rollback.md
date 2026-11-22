# Runbook: rolling back a deploy

_2026-11-22. For when a deploy broke something and the fix isn't minutes away. Related: [incident.md](incident.md),
[restore.md](restore.md) (data), [../hosting.md](../hosting.md) (how the apps are set up)._

Both DigitalOcean apps build `main` on every merge (`deploy_on_push`), about six minutes from merge to live, and each
runs a single instance, so every deploy restarts it. A rollback brings back an earlier deployment's code **and its app
spec**; it never touches the database, Bunny's media or Cloudflare.

| App | What it serves | App id |
|---|---|---|
| `botchelor-show` | botchelor.com, www, staging | `37356cc9-c561-473a-861e-331b8086ae81` |
| `botchelor` (address `clownfish-app-dvoft.ondigitalocean.app`) | ad.botchelor.com, and the hourly job `lobby` | `fe0525e1-ec79-4be1-ae27-9737cbd6f51b` |

Both apps run the same commit, so a bad commit usually needs both rolled back; After Dark's rollback also brings back
that deployment's job command.

## 1. Find the last good deployment

- **Which commit is live:** /admin → Servers shows each host's commit and when it started (each start is a row in
  `ops_log`). A start on the same commit as the one before is a restart, not a deploy.
- **The deployments:** DigitalOcean → Apps → the app → Activity. Or the API, with the token read from the keychain
  into a variable (never printed, never in a file):

  ```sh
  TOKEN=$(security find-generic-password -s vault/botchelor/DO_APPS_TOKEN -w)
  APP=37356cc9-c561-473a-861e-331b8086ae81   # the show; After Dark is fe0525e1-ec79-4be1-ae27-9737cbd6f51b
  curl -s -H "Authorization: Bearer $TOKEN" "https://api.digitalocean.com/v2/apps/$APP/deployments?per_page=15" \
    | jq -r '.deployments[] | [.id, .phase, .created_at, .cause] | @tsv'
  ```

  `ACTIVE` is live, `SUPERSEDED` ran before it. Pick the newest `SUPERSEDED` one from before the bad commit.

## 2. Roll back

**Dashboard:** Apps → the app → Activity → **Rollback** beside that deployment. Read the diff (ALL SETTINGS DIFF shows
the spec), and under MORE OPTIONS untick "Automatically Deploy Code Changes" so the next merge can't bring the bad
commit back before the fix. Then Rollback. Do the other app the same way.

**API** (the same token and app id):

```sh
D=<deployment id>
curl -s -X POST -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d "{\"deployment_id\":\"$D\",\"skip_pin\":false}" "https://api.digitalocean.com/v2/apps/$APP/rollback/validate"
# {"valid":true} (checked on the show, 2026-11-22), then:
curl -s -X POST -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d "{\"deployment_id\":\"$D\",\"skip_pin\":false}" "https://api.digitalocean.com/v2/apps/$APP/rollback"
```

With `skip_pin: false` the app is **pinned**: no new deployment starts, merges to `main` included, until the rollback
is committed or reverted. That is what you want while the fix is written. `skip_pin: true` commits it at once and the
next merge deploys as usual.

Limits (DigitalOcean's): one of the app's ten most recent successful deployments, in the same region.

## 3. Check it

- `https://botchelor.com/api/health?db=1` and `https://ad.botchelor.com/api/health?db=1` answer `{"ok":true,"db":"ok"}`.
- /admin → Servers shows the old commit on both hosts, started a minute ago.
- The page or job that broke works again.

## 4. Fix forward, then unpin

1. Fix it on a branch the usual way (a `git revert -m 1 <merge sha>` of the bad merge is often the fix), PR, merge
   when every check is green. Never force-push.
2. Unpin each app: commit the rollback (`POST /v2/apps/$APP/rollback/commit`), then deploy `main`'s head
   (`POST /v2/apps/$APP/deployments` with `{"force_build":true}`, or Activity → Deploy). Or revert the rollback
   (`POST /v2/apps/$APP/rollback/revert`), which redeploys from the newest spec and unpins. If you unticked
   "Automatically Deploy Code Changes", tick it again (Settings → the component → Source).
3. Check step 3 again on the new commit.

## Watch out

- **The spec rolls back too.** An environment value changed since that deployment (a rotated key, a switch) goes back
  to its old value. After a rollback, check the values you changed recently ([../switches.md](../switches.md)).
- **The database doesn't.** Data written since the bad deploy stays; bad data needs [restore.md](restore.md). The
  older code applies its own schema at its first start (`ensureSchemaCurrent` in `lib/db.ts`: the recorded version
  differs). That schema is nearly all `add ... if not exists`, so it runs on the newer tables, and the run log says
  `[db] schema apply ok`. If it says `schema apply failed` instead, usually an older check on a `kind` or `status`
  column that newer rows break, every database request fails: roll forward (revert the bad commit) instead.
- **Faster than a rollback, for one feature:** its switch. Most features ship with a `0` to turn them off
  ([../switches.md](../switches.md)), and After Dark's pieces have database switches that need no deploy at all.
