<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Botchelor: rules for agents working here

The block above is Next.js's own and `next dev` rewrites it; everything below is this repo's.

**Read first:** [BUILD.md](BUILD.md) (run, test, deploy), [docs/architecture.md](docs/architecture.md),
[docs/hosting.md](docs/hosting.md), [docs/switches.md](docs/switches.md) (every environment name and what's live) and
[docs/runbooks/](docs/runbooks/) (incident, rollback, restore, key rotation). Dated sections say when they were true.

- **The repo is public.** No key, password, token, cookie or personal data in code, commits, pull requests or issues.
  Keys live in the macOS keychain (`vault/botchelor/<NAME>`, through `~/ai-stack/bin/secrets`) and in DigitalOcean's
  encrypted values; read one into a variable inside the command and never print it.
- **Every merge to `main` deploys both apps** (about six minutes) and restarts each one's single instance. Run
  `npm run gate` before a pull request; merge only when every CI check is green (typecheck, four test shards, build,
  e2e). Never force-push, rewrite history or delete a branch; if `main` moved, merge it in.
- **Tests run with one worker** on a shared Mac (`npx vitest run --maxWorkers=1`). Never run `prettier`: the repo has
  no config for it and it rewraps whole files.
- **The schema is idempotent SQL in `lib/db.ts`**, applied at startup when it changes. Change production data only
  when asked to; read it with a read-only session.
- **A new environment switch** gets a line where its feature is documented, or in `docs/switches.md`
  (`tests/switches-doc.test.ts` fails without one), a commented entry in the app's spec under `.do/`, and a run of
  `node scripts/switches.mjs`.
- **Money:** agents spend nothing and hold no card; a spend is proposed to David with what it buys.
- **What the servers did** is in `ops_log` (`lib/ops-log.ts`, /admin → Servers), not only in the container's output,
  which each deploy throws away.
- **Translate as part of the work** (David, 2026-11-27: "make sure we translate if a page is updated or new"). The
  site is in eight languages ([docs/i18n.md](docs/i18n.md)). Any words a visitor sees that you add or change go
  through `t()` (`getT()` on the server, `useT()` in a client component; a library function takes a `t`), and the same
  pull request adds them to all seven catalogs: `npx tsx scripts/i18n-missing.ts` lists what's missing as a JSON to
  fill in, you write the translations (by hand, $0), and `--apply` puts them in the right half.
  `tests/i18n-coverage.test.ts` fails when a page gains untranslated text, and a new page must have none; when you
  translate some of an old page, lower its count with `npx tsx scripts/i18n-untranslated.ts --baseline`. After
  Dark, admin and the legal pages stay English (`ENGLISH_ONLY` in that script).
- **Tests that catch new work** (met while shipping the 2026-11-26/27 memory and MCP work):
  - a new table with a person's id column is registered in `lib/person-columns.ts` and in the export and delete in
    `lib/account.ts` (`tests/person-columns.test.ts`);
  - a route reads its body through `readJson`/`readJsonOr` (`lib/http.ts`), never `req.json()` (`tests/body-limits.test.ts`);
  - the first MCP contact (initialize plus the default tool list) has a byte budget (`tests/loop-1361.test.ts`), so new
    abilities go on an existing tool's `action` where they can;
  - a tool named after a common word (`block`, `confessionals`) trips `tests/mcp-hints.test.ts`: prefix it
    (`read_confessionals`);
  - heavy pages have a round-trip budget (`tests/perf-pages.test.ts`).
