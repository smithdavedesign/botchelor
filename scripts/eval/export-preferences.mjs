#!/usr/bin/env node
/**
 * The preference dataset (David, 2026-10-21: real-user signals, for fine-tuning later): every line of a date someone rated
 * 👍 or 👎 (lib/line-feedback.ts, app/ChatThread.tsx), as JSONL, read-only. One JSON object per rated line:
 *
 *   { kind: "episode", ref_id, line_index,
 *     votes: { up, down, voters, score }, last_vote,
 *     speaker: { side, name, character_id }, other: { name, character_id },
 *     text, action, emotion, act, moved_to,
 *     context: [{ side, name, text }],             (the lines just before it)
 *     source: { … } }                              (the date's setting, venue, ending, who performed it and the model)
 *
 * No user ids, only the counts. A line whose date is gone is skipped (and counted).
 *
 * Gated (David, 2026-10-22; the privacy page's "Training and research" promise; docs/data-plan.md):
 *  - the date aired publicly: public, revealed, ready, not hidden by reports, not an After Dark date;
 *  - both characters are the show's own or their owners opted in;
 *  - only the votes of people who opted in are counted: a line nobody who opted in voted on is left out.
 * Consent is lib/ml-consent.ts consentedOwnerSql itself, loaded through Vite's module runner (loadConsent), never a
 * copy: the current wording version only, and an agent through the account it was linked to at the time of the date or
 * the vote. Lines the gates drop are counted as excluded. The `publicOnly` / `consentOnly` options exist for the
 * script's own tests, never a CLI flag.
 *
 * After Dark is never exported, whatever anyone chose: the privacy page and the account toggle promise it. Its votes
 * aren't even read.
 *
 *   DATABASE_URL="$(neon connection-string --profile davejobs-agent --project-id cool-boat-29098893)" \
 *     node scripts/eval/export-preferences.mjs [--out .data/preferences/preferences-<date>.jsonl]
 *       [--since 2026-10-01] [--context 4] [--db url | --pglite dir]
 *
 * Every connection is default_transaction_read_only=on and only SELECTs run (the observer's openDb). Free: no model.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { openDb } from "./after-dark-observer.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const asArray = (v) => (Array.isArray(v) ? v : typeof v === "string" ? JSON.parse(v) : []);
const asObject = (v) => (v && typeof v === "object" ? v : typeof v === "string" ? JSON.parse(v) : null);
const iso = (d) => (d ? new Date(d).toISOString() : null);

/**
 * A lib/ module through Vite's module runner (the same TypeScript the app and the tests run, as after-dark-observer.mjs
 * loadLib does), so a script reads the app's own code, never a copy. `rel` is relative to the repo root.
 */
export async function loadLib(rel) {
  const { runnerImport } = await import("vite");
  const { module } = await runnerImport(join(ROOT, rel), {
    configFile: false,
    root: ROOT,
    logLevel: "error",
    resolve: { alias: [{ find: /^@\//, replacement: `${ROOT}/` }] },
  });
  return module;
}

/**
 * lib/ml-consent.ts: the consent gate (consentedOwnerSql, consentedCharactersSql) and the aired-public gate
 * (airedPublicSql) are the app's own SQL, so the export, the training-set builder and the readiness tracker can't drift.
 */
export const loadConsent = () => loadLib("lib/ml-consent.ts");

/**
 * Every rated line of a date with its votes, words and context. deps: consent (lib/ml-consent.ts; loaded when not
 * given), since (ISO), context (how many lines before). Gates (see the header): publicOnly and consentOnly (default
 * true; tests only).
 */
export async function collectPreferences(query, { consent = null, since = null, context = 4, publicOnly = true, consentOnly = true } = {}) {
  const lib = publicOnly || consentOnly ? (consent ?? (await loadConsent())) : null;
  const gate = consentOnly ? lib : null;
  // A vote counts only from someone who opted in (an agent: through the account it was linked to when it voted).
  const voterOk = gate ? gate.consentedOwnerSql("lf.user_id", "lf.created_at") : "true";
  const votes = await query(
    `select ref_id, line_index,
            count(*) filter (where ok and vote > 0)::int as up, count(*) filter (where ok and vote < 0)::int as down,
            count(distinct user_id) filter (where ok)::int as voters, max(updated_at) filter (where ok) as last_vote
       from (select lf.ref_id, lf.line_index, lf.vote, lf.user_id, lf.updated_at, (${voterOk}) as ok
               from line_feedback lf
              where lf.kind = 'episode' and ($1::timestamptz is null or lf.updated_at >= $1)) v
      group by ref_id, line_index
      order by ref_id, line_index`,
    [since],
  );
  const refs = [...new Set(votes.map((v) => v.ref_id))];

  const episodes = new Map();
  const present = new Set();
  if (refs.length) {
    const gates = [];
    // lib/ml-consent.ts's own SQL: the date aired publicly (fewer than 3 reports, never After Dark), and both characters
    // are the show's own or their owners opted in by the date's time.
    if (publicOnly) gates.push(lib.airedPublicSql("e"));
    if (gate) gates.push(gate.consentedCharactersSql("a", "b", "e.created_at"));
    const rows = await query(
      `select e.id, e.transcript, e.setting, e.ending, e.setup->>'venue' as venue, e.performed_by, e.generated_with, e.created_at,
              a.id as a_id, a.name as a_name, b.id as b_id, b.name as b_name
         from episodes e join characters a on a.id = e.character_a join characters b on b.id = e.character_b
        where e.id = any($1)${gates.map((g) => ` and ${g}`).join("")}`,
      [refs],
    );
    for (const r of rows) episodes.set(r.id, r);
    for (const r of await query(`select id from episodes where id = any($1)`, [refs])) present.add(r.id);
  }

  const records = [];
  let skipped = 0;
  let excluded = 0;
  for (const v of votes) {
    if (!present.has(v.ref_id)) {
      skipped++;
      continue;
    }
    // Still in the database, but a gate (public, the characters' consent, the voters' consent) left it out.
    const e = episodes.get(v.ref_id);
    if (!e || Number(v.voters) === 0) {
      excluded++;
      continue;
    }
    const tally = { up: Number(v.up), down: Number(v.down), voters: Number(v.voters), score: Number(v.up) - Number(v.down) };
    const i = Number(v.line_index);
    const transcript = asArray(e.transcript);
    const t = transcript[i];
    if (!t) {
      skipped++;
      continue;
    }
    const side = (s) => (s === "b" ? { name: e.b_name, character_id: e.b_id } : { name: e.a_name, character_id: e.a_id });
    records.push({
      kind: "episode",
      ref_id: v.ref_id,
      line_index: i,
      votes: tally,
      last_vote: iso(v.last_vote),
      speaker: { side: t.side, ...side(t.side) },
      other: side(t.side === "a" ? "b" : "a"),
      text: t.dialogue ?? "",
      action: t.action || null,
      emotion: t.emotion || null,
      act: typeof t.act === "number" ? t.act : null,
      moved_to: t.moved_to ?? null,
      context: transcript.slice(Math.max(0, i - context), i).map((x) => ({ side: x.side, name: side(x.side).name, text: x.dialogue ?? "" })),
      source: { setting: e.setting ?? null, venue: e.venue ?? null, ending: e.ending ?? null, performed_by: e.performed_by ?? null, generated_with: asObject(e.generated_with), created_at: iso(e.created_at) },
    });
  }
  return { records, skipped, excluded, votes: votes.length };
}

/** Collects the dataset and writes it as JSONL (one record per line). */
export async function exportPreferences({ query, consent = null, out, since = null, context = 4, publicOnly = true, consentOnly = true, log = () => {} }) {
  const { records, skipped, excluded, votes } = await collectPreferences(query, { consent, since, context, publicOnly, consentOnly });
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, records.map((r) => JSON.stringify(r)).join("\n") + (records.length ? "\n" : ""));
  log(
    `[export-preferences] ${records.length} rated lines (of ${votes}) to ${out}` +
      `${skipped ? `; ${skipped} skipped (their date is gone)` : ""}${excluded ? `; ${excluded} excluded (not public, or no opt-in)` : ""}`,
  );
  return { file: out, count: records.length, skipped, excluded, records };
}

export function parseArgs(argv) {
  const o = { context: 4, out: join(ROOT, ".data", "preferences", `preferences-${new Date().toISOString().slice(0, 10)}.jsonl`) };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--out") o.out = resolve(argv[++i]);
    else if (a === "--since") o.since = new Date(argv[++i]).toISOString();
    else if (a === "--context") o.context = Math.max(0, Math.min(20, Number(argv[++i]) || 0));
    else if (a === "--db") o.db = argv[++i];
    else if (a === "--pglite") o.pglite = argv[++i];
    else if (a === "--include-after-dark") throw new Error("After Dark is never exported: the privacy page promises it's never used for training");
    else throw new Error(`unknown option ${a}`);
  }
  return o;
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  const db = await openDb({ db: o.db, pglite: o.pglite });
  try {
    await exportPreferences({
      query: db.query,
      consent: await loadConsent(),
      out: o.out,
      since: o.since ?? null,
      context: o.context,
      log: (m) => console.error(m),
    });
  } finally {
    await db.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((err) => {
    console.error(`[export-preferences] ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  });
}
