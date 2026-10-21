#!/usr/bin/env node
/**
 * The After Dark observer, every night (David, 2026-10-21: "an observer for background testing", made to run on its own).
 * It finds every After Dark pair whose running scene or saved nights changed in the last 24 hours, runs the observer's
 * checks on each pair's latest night (lib/adult/observer.ts through scripts/eval/after-dark-observer.mjs's loadLib and
 * fromDb, imported, never shelled out to per pair), and then:
 *   - writes .data/observer/nightly-<date>.json: every pair's report, with each chapter's scene or night id;
 *   - posts one summary row to the site's quality runs (POST /api/admin/quality, kind after_dark_observer, label
 *     nightly-<date>; a rerun the same day replaces it), shown on /admin/analytics next to Real use;
 *   - emits one event with ~/ai-stack/bin/emit-event when that exists.
 *
 * Read-only on the database, and free (no model):
 *   DATABASE_URL="$(neon connection-string --profile davejobs-agent --project-id cool-boat-29098893)" \
 *     node scripts/eval/observer-nightly.mjs
 * Every connection is default_transaction_read_only=on and only SELECTs run. The summary goes to the site with the admin
 * password (FRONTIER_PASSWORD from the environment, else the keychain's vault/botchelor/FRONTIER_PASSWORD; never printed).
 *
 * Options:
 *   --hours N            how far back "changed" looks (default 24)
 *   --db url | --pglite dir   the database (default $OBSERVER_DATABASE_URL, then $DATABASE_URL)
 *   --owner <user id>    only that admin's pairs
 *   --out dir            where the report goes (default .data/observer)
 *   --site url           where the summary is posted (default https://botchelor.com)
 *   --no-post            write the report, post nothing
 *   --dry-run            print the summary; write and post nothing
 * A night with no changed pair writes its report and posts nothing (there are no numbers to show).
 */
import { execFile, execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { fromDb as observerFromDb, loadLib, openDb } from "./after-dark-observer.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const round = (x) => Math.round(x * 100) / 100;

/**
 * The pairs whose running scene was written to, or that filed a night, since `since`: one row per owner and pair, the
 * latest change first.
 */
export async function selectChangedPairs(query, { since, owner = null }) {
  const rows = await query(
    `select owner_id, character_a, character_b, max(at) as changed_at,
            bool_or(src = 'scene') as scene_changed, count(*) filter (where src = 'night')::int as nights_changed
       from (
         select owner_id, character_a, character_b, updated_at as at, 'scene' as src from adult_scenes where updated_at > $1
         union all
         select owner_id, character_a, character_b, created_at as at, 'night' as src from adult_nights where created_at > $1
       ) changed
      where ($2::text is null or owner_id = $2)
      group by owner_id, character_a, character_b
      order by max(at) desc, character_a, character_b`,
    [since, owner],
  );
  return rows.map((r) => ({
    owner: r.owner_id,
    a: r.character_a,
    b: r.character_b,
    changed_at: new Date(r.changed_at).toISOString(),
    scene_changed: Boolean(r.scene_changed),
    nights_changed: Number(r.nights_changed),
  }));
}

/** The night's numbers over every pair the observer read: totals, the "why" shares weighted by lines, and the worst pairs. */
export function summarize(entries) {
  const ok = entries.filter((e) => e.report);
  const sum = (k) => ok.reduce((s, e) => s + (Number(e.report.summary[k]) || 0), 0);
  const withWhy = sum("lines_with_why");
  const share = (k) => (withWhy ? round(ok.reduce((s, e) => s + (Number(e.report.summary[k]) || 0) * (Number(e.report.summary.lines_with_why) || 0), 0) / withWhy) : null);
  return {
    pairs: entries.length,
    observed: ok.length,
    errors: entries.length - ok.length,
    chapters: ok.reduce((s, e) => s + e.report.chapters, 0),
    lines: ok.reduce((s, e) => s + e.report.lines, 0),
    findings: ok.reduce((s, e) => s + e.report.findings.length, 0),
    unprovoked_moves: sum("unprovoked_moves"),
    agreed_moves: sum("agreed_moves"),
    refused_moves: sum("refused_moves"),
    my_place_when_there: sum("my_place_when_there"),
    verbatim_repeats: sum("verbatim_repeats"),
    near_repeats: sum("near_repeats"),
    unfounded_memories: sum("unfounded_memories"),
    lines_with_why: withWhy,
    share_memory: share("share_memory"),
    share_trait: share("share_trait"),
    share_moment: share("share_moment"),
    worst: ok
      .map((e) => ({ pair: e.report.pair, findings: e.report.findings.length }))
      .filter((w) => w.findings > 0)
      .sort((x, y) => y.findings - x.findings)
      .slice(0, 3),
  };
}

/**
 * One nightly run over a read-only query function: the changed pairs, each one observed (a pair that can't be read is
 * noted and the rest carry on), the report written, the summary posted and the event emitted.
 * deps: query, lib ({ observeNight }), fromDb (defaults to the observer script's), now, hours, owner, outDir, post
 * (async (row) => result, or null to post nothing), emit (async (status, message), or null), sha, log, write.
 */
export async function runNightly({
  query,
  lib,
  fromDb = observerFromDb,
  now = new Date(),
  hours = 24,
  owner = null,
  outDir = join(ROOT, ".data", "observer"),
  post = null,
  emit = null,
  sha = null,
  log = () => {},
  write = true,
}) {
  const since = new Date(now.getTime() - hours * 3_600_000).toISOString();
  const date = now.toISOString().slice(0, 10);
  const pairs = await selectChangedPairs(query, { since, owner });
  log(`[observer-nightly] ${pairs.length} pair${pairs.length === 1 ? "" : "s"} changed since ${since}`);
  const entries = [];
  for (const p of pairs) {
    const entry = { owner: p.owner, a: p.a, b: p.b, changed_at: p.changed_at, scene_changed: p.scene_changed, nights_changed: p.nights_changed };
    try {
      const inputs = await fromDb(query, { pair: [p.a, p.b], owner: p.owner, nights: "latest" });
      const input = inputs[inputs.length - 1];
      const report = lib.observeNight(input);
      entry.pair = report.pair;
      entry.chapters = input.chapters.map((c) => ({ chapter: c.chapter, id: c.id, source: c.source, lines: c.lines.length }));
      entry.report = report;
      log(`[observer-nightly] ${report.pair}: ${report.lines} lines, ${report.findings.length} findings`);
    } catch (e) {
      entry.error = String(e instanceof Error ? e.message : e).slice(0, 300);
      log(`[observer-nightly] ${p.a} × ${p.b}: ${entry.error}`);
    }
    entries.push(entry);
  }
  const summary = summarize(entries);
  const out = { date, ran_at: now.toISOString(), since, hours, sha, summary, pairs: entries };
  let file = null;
  if (write) {
    mkdirSync(outDir, { recursive: true });
    file = join(outDir, `nightly-${date}.json`);
    writeFileSync(file, `${JSON.stringify(out, null, 2)}\n`);
    log(`[observer-nightly] wrote ${file}`);
  }
  let posted = null;
  if (post && entries.length) posted = await post({ kind: "after_dark_observer", label: `nightly-${date}`, sha, at: now.toISOString(), metrics: summary });
  const message = entries.length
    ? `${summary.pairs} pair${summary.pairs === 1 ? "" : "s"}, ${summary.lines} lines: ${summary.unprovoked_moves} unprovoked moves, ${summary.my_place_when_there} my-place-when-there, ` +
      `${summary.verbatim_repeats + summary.near_repeats} repeats, ${summary.unfounded_memories} unfounded memories${summary.errors ? `, ${summary.errors} couldn't be read` : ""}`
    : `no After Dark pair changed in the last ${hours}h`;
  if (emit) await emit(entries.length ? "ok" : "skipped", message);
  return { file, out, summary, posted, message };
}

function adminPassword() {
  if (process.env.FRONTIER_PASSWORD) return process.env.FRONTIER_PASSWORD;
  try {
    return execFileSync("security", ["find-generic-password", "-s", "vault/botchelor/FRONTIER_PASSWORD", "-w"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim() || null;
  } catch {
    return null;
  }
}

/** Posts a quality-run row to the site with the admin password (never printed). Never throws: says what happened. */
export function poster({ site, password, fetchImpl = globalThis.fetch, log = () => {} }) {
  return async (row) => {
    if (!password) {
      log("[observer-nightly] not posted: no FRONTIER_PASSWORD in the environment or the keychain");
      return { ok: false, why: "no admin password" };
    }
    try {
      const res = await fetchImpl(`${site}/api/admin/quality`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-frontier-key": password },
        body: JSON.stringify(row),
        signal: AbortSignal.timeout(30_000),
      });
      log(res.ok ? `[observer-nightly] posted to ${site}` : `[observer-nightly] posting failed (HTTP ${res.status})`);
      return { ok: res.ok, status: res.status };
    } catch (e) {
      log(`[observer-nightly] posting failed: ${e instanceof Error ? e.message : e}`);
      return { ok: false, why: "network" };
    }
  };
}

/** ~/ai-stack/bin/emit-event when it exists (the shared system log, RepoHQ docs/logging.md); best effort. */
export function emitter(bin = join(homedir(), "ai-stack/bin/emit-event")) {
  return (status, message) =>
    new Promise((done) => {
      if (!existsSync(bin)) return done();
      execFile(bin, ["botchelor", "after-dark-observer", "nightly", status, message.slice(0, 500)], () => done());
    });
}

function parseArgs(argv) {
  const o = { hours: 24, out: join(ROOT, ".data", "observer"), site: "https://botchelor.com", post: true, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--hours") o.hours = Number(argv[++i]);
    else if (a === "--db") o.db = argv[++i];
    else if (a === "--pglite") o.pglite = argv[++i];
    else if (a === "--owner") o.owner = argv[++i];
    else if (a === "--out") o.out = resolve(argv[++i]);
    else if (a === "--site") o.site = String(argv[++i]).replace(/\/+$/, "");
    else if (a === "--no-post") o.post = false;
    else if (a === "--dry-run") o.dryRun = true;
    else throw new Error(`unknown option ${a}`);
  }
  if (!(o.hours > 0)) throw new Error("--hours is a number of hours");
  return o;
}

function gitSha() {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim() || null;
  } catch {
    return null;
  }
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  const emit = o.dryRun ? null : emitter();
  const log = (m) => console.error(m);
  let db;
  try {
    db = await openDb({ db: o.db, pglite: o.pglite });
    const lib = await loadLib();
    const r = await runNightly({
      query: db.query,
      lib,
      hours: o.hours,
      owner: o.owner ?? null,
      outDir: o.out,
      post: o.dryRun || !o.post ? null : poster({ site: o.site, password: adminPassword(), log }),
      emit,
      sha: gitSha(),
      log,
      write: !o.dryRun,
    });
    console.log(o.dryRun ? JSON.stringify(r.summary, null, 2) : `[observer-nightly] ${r.message}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[observer-nightly] ${message}`);
    if (emit) await emit("fail", message.slice(0, 300));
    process.exitCode = 1;
  } finally {
    await db?.close().catch(() => {});
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
