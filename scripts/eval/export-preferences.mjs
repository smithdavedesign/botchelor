#!/usr/bin/env node
/**
 * The preference dataset (David, 2026-10-21: real-user signals, for fine-tuning later): every line someone rated 👍 or 👎
 * (lib/line-feedback.ts, app/ChatThread.tsx), as JSONL, read-only. One JSON object per rated line:
 *
 *   { kind: "episode" | "after_dark", ref_id, line_index,
 *     votes: { up, down, voters, score }, last_vote,
 *     speaker: { side, name, character_id }, other: { name, character_id },
 *     text, action, emotion, act,                  (a date's line)
 *     why, memory, stage, moved_to,                (an After Dark line's private notes, when it has them)
 *     context: [{ side, name, text }],             (the lines just before it)
 *     observer_flags: [{ check, from, to, note }] | null,   (After Dark: what lib/adult/observer.ts flags on that line)
 *     source: { … } }                              (the date's setting, venue, ending and model; the night's chapter)
 *
 * No user ids, only the counts. A line whose date or night is gone is skipped (and counted).
 *
 * Gated by default (David, 2026-10-22; the privacy page's "Training and research" promise): only dates that aired
 * publicly (public, revealed, ready, not hidden by reports, not an After Dark date), and only when both characters are
 * the show's own or their owners opted in (lib/ml-consent.ts; an agent follows the account it's linked to). After Dark
 * is left out unless --include-after-dark, and then only scenes whose owner opted in. Lines the gates drop are counted
 * as excluded. The `publicOnly` / `consentOnly` options exist for the script's own tests, never a CLI flag.
 *
 *   DATABASE_URL="$(neon connection-string --profile davejobs-agent --project-id cool-boat-29098893)" \
 *     node scripts/eval/export-preferences.mjs [--out .data/preferences/preferences-<date>.jsonl]
 *       [--since 2026-10-01] [--kind episode|after_dark] [--context 4] [--no-observer] [--db url | --pglite dir]
 *
 * Every connection is default_transaction_read_only=on and only SELECTs run (the observer's openDb). Free: no model.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { fromDb as observerFromDb, loadLib, openDb } from "./after-dark-observer.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const asArray = (v) => (Array.isArray(v) ? v : typeof v === "string" ? JSON.parse(v) : []);
const asObject = (v) => (v && typeof v === "object" ? v : typeof v === "string" ? JSON.parse(v) : null);
const iso = (d) => (d ? new Date(d).toISOString() : null);

/** A scene line's leading *action*, apart from what's said. */
function splitAction(text) {
  const m = String(text ?? "").match(/^\*([^*]+)\*\s*([\s\S]*)$/);
  return m ? { action: m[1].trim(), said: m[2].trim() } : { action: null, said: String(text ?? "").trim() };
}

/** lib/rules.ts REPORT_HIDE_THRESHOLD: a date with this many reports is hidden from everyone, datasets included. */
const REPORT_HIDE_THRESHOLD = 3;
/** lib/ml-consent.ts consentedOwnerSql, mirrored here (this script runs without the app's TypeScript). */
const consentedOwnerSql = (ownerExpr) =>
  `exists (select 1 from ml_consents mc where mc.granted and (mc.user_id = ${ownerExpr}
     or mc.user_id = (select al.user_id from agent_links al where al.agent_id = ${ownerExpr})))`;

/**
 * Every rated line with its votes, words, context and notes. deps: lib ({ observeNight }) for the After Dark flags (null
 * leaves them out), fromDb (the observer script's), since (ISO), kind, context (how many lines before), observer.
 * Gates (see the header): includeAfterDark (default false), publicOnly and consentOnly (default true; tests only).
 */
export async function collectPreferences(
  query,
  { lib = null, fromDb = observerFromDb, since = null, kind = null, context = 4, observer = true, includeAfterDark = false, publicOnly = true, consentOnly = true } = {},
) {
  const votes = await query(
    `select kind, ref_id, line_index,
            count(*) filter (where vote > 0)::int as up, count(*) filter (where vote < 0)::int as down,
            count(distinct user_id)::int as voters, max(updated_at) as last_vote
       from line_feedback
      where ($1::timestamptz is null or updated_at >= $1) and ($2::text is null or kind = $2) and ($3::boolean or kind <> 'after_dark')
      group by kind, ref_id, line_index
      order by kind, ref_id, line_index`,
    [since, kind, includeAfterDark],
  );
  const refs = (k) => [...new Set(votes.filter((v) => v.kind === k).map((v) => v.ref_id))];

  const episodes = new Map();
  const present = new Set();
  if (refs("episode").length) {
    const gates = [];
    if (publicOnly) {
      gates.push(`e.visibility = 'public' and e.revealed_at is not null and e.status = 'ready'
              and coalesce(e.setup->>'after_dark', 'false') <> 'true'
              and (select count(*) from reports rp where rp.episode_id = e.id) < ${REPORT_HIDE_THRESHOLD}`);
    }
    if (consentOnly) gates.push(`(a.is_house or ${consentedOwnerSql("a.owner_id")}) and (b.is_house or ${consentedOwnerSql("b.owner_id")})`);
    const rows = await query(
      `select e.id, e.transcript, e.setting, e.ending, e.setup->>'venue' as venue, e.performed_by, e.generated_with, e.created_at,
              a.id as a_id, a.name as a_name, b.id as b_id, b.name as b_name
         from episodes e join characters a on a.id = e.character_a join characters b on b.id = e.character_b
        where e.id = any($1)${gates.map((g) => ` and ${g}`).join("")}`,
      [refs("episode")],
    );
    for (const r of rows) episodes.set(r.id, r);
    for (const r of await query(`select id from episodes where id = any($1)`, [refs("episode")])) present.add(r.id);
  }

  const nights = new Map();
  if (refs("after_dark").length) {
    const owned = consentOnly ? ` and ${consentedOwnerSql("owner_id")}` : "";
    const rows = await query(
      `select id, owner_id, character_a, character_b, lines, chapter, 'scene' as source from adult_scenes where id = any($1)${owned}
       union all
       select id, owner_id, character_a, character_b, lines, chapter, 'night' as source from adult_nights where id = any($1)${owned}`,
      [refs("after_dark")],
    );
    for (const r of await query(`select id from adult_scenes where id = any($1) union all select id from adult_nights where id = any($1)`, [refs("after_dark")])) {
      present.add(r.id);
    }
    const ids = [...new Set(rows.flatMap((r) => [r.character_a, r.character_b]))];
    const names = new Map(ids.length ? (await query(`select id, name from characters where id = any($1)`, [ids])).map((r) => [r.id, r.name]) : []);
    for (const r of rows) nights.set(r.id, { ...r, lines: asArray(r.lines), a_name: names.get(r.character_a) ?? r.character_a, b_name: names.get(r.character_b) ?? r.character_b });
  }

  // The observer's findings per scene or night id: each pair with rated lines, all its runs of chapters, observed once.
  const flags = new Map();
  if (lib && observer && nights.size) {
    const pairs = new Map();
    for (const n of nights.values()) pairs.set(`${n.owner_id}|${n.character_a}|${n.character_b}`, n);
    for (const n of pairs.values()) {
      try {
        for (const input of await fromDb(query, { pair: [n.character_a, n.character_b], owner: n.owner_id, nights: "all" })) {
          const report = lib.observeNight(input);
          for (const ch of input.chapters) flags.set(ch.id, report.findings.filter((f) => f.chapter === ch.chapter).map(({ check, from, to, note }) => ({ check, from, to, note })));
        }
      } catch {
        /* that pair's flags stay unknown (null) */
      }
    }
  }

  const records = [];
  let skipped = 0;
  let excluded = 0;
  for (const v of votes) {
    const tally = { up: Number(v.up), down: Number(v.down), voters: Number(v.voters), score: Number(v.up) - Number(v.down) };
    const i = Number(v.line_index);
    // Still in the database, but a gate (public, consent) left it out: counted apart from what's gone.
    const gated = present.has(v.ref_id) && !(v.kind === "episode" ? episodes : nights).has(v.ref_id);
    if (gated) {
      excluded++;
      continue;
    }
    if (v.kind === "episode") {
      const e = episodes.get(v.ref_id);
      const transcript = e ? asArray(e.transcript) : [];
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
        why: null,
        memory: null,
        stage: null,
        moved_to: t.moved_to ?? null,
        context: transcript.slice(Math.max(0, i - context), i).map((x) => ({ side: x.side, name: side(x.side).name, text: x.dialogue ?? "" })),
        observer_flags: null,
        source: { setting: e.setting ?? null, venue: e.venue ?? null, ending: e.ending ?? null, performed_by: e.performed_by ?? null, generated_with: asObject(e.generated_with), created_at: iso(e.created_at) },
      });
      continue;
    }
    const n = nights.get(v.ref_id);
    const l = n?.lines[i];
    if (!l) {
      skipped++;
      continue;
    }
    const side = (w) => (w === "b" ? { name: n.b_name, character_id: n.character_b } : { name: n.a_name, character_id: n.character_a });
    const { action, said } = splitAction(l.text);
    const known = flags.get(v.ref_id);
    records.push({
      kind: "after_dark",
      ref_id: v.ref_id,
      line_index: i,
      votes: tally,
      last_vote: iso(v.last_vote),
      speaker: { side: l.who, ...side(l.who) },
      other: side(l.who === "a" ? "b" : "a"),
      text: said,
      action,
      emotion: null,
      act: null,
      why: l.why ?? null,
      memory: l.memory ?? null,
      stage: typeof l.stage === "number" ? l.stage : null,
      moved_to: l.moved_to ?? null,
      context: n.lines.slice(Math.max(0, i - context), i).map((x) => ({ side: x.who, name: side(x.who).name, text: x.text })),
      observer_flags: known === undefined ? null : known.filter((f) => f.from <= i && i <= f.to),
      source: { kind: n.source, chapter: n.chapter ?? null },
    });
  }
  return { records, skipped, excluded, votes: votes.length };
}

/** Collects the dataset and writes it as JSONL (one record per line). */
export async function exportPreferences({
  query,
  lib = null,
  fromDb,
  out,
  since = null,
  kind = null,
  context = 4,
  observer = true,
  includeAfterDark = false,
  publicOnly = true,
  consentOnly = true,
  log = () => {},
}) {
  const { records, skipped, excluded, votes } = await collectPreferences(query, { lib, fromDb, since, kind, context, observer, includeAfterDark, publicOnly, consentOnly });
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, records.map((r) => JSON.stringify(r)).join("\n") + (records.length ? "\n" : ""));
  log(
    `[export-preferences] ${records.length} rated lines (of ${votes}) to ${out}` +
      `${skipped ? `; ${skipped} skipped (their date or night is gone)` : ""}${excluded ? `; ${excluded} excluded (not public, or no opt-in)` : ""}`,
  );
  return { file: out, count: records.length, skipped, excluded, records };
}

function parseArgs(argv) {
  const o = { context: 4, observer: true, out: join(ROOT, ".data", "preferences", `preferences-${new Date().toISOString().slice(0, 10)}.jsonl`) };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--out") o.out = resolve(argv[++i]);
    else if (a === "--since") o.since = new Date(argv[++i]).toISOString();
    else if (a === "--kind") o.kind = argv[++i];
    else if (a === "--context") o.context = Math.max(0, Math.min(20, Number(argv[++i]) || 0));
    else if (a === "--no-observer") o.observer = false;
    else if (a === "--include-after-dark") o.includeAfterDark = true;
    else if (a === "--db") o.db = argv[++i];
    else if (a === "--pglite") o.pglite = argv[++i];
    else throw new Error(`unknown option ${a}`);
  }
  if (o.kind && !["episode", "after_dark"].includes(o.kind)) throw new Error("--kind is episode or after_dark");
  if (o.kind === "after_dark" && !o.includeAfterDark) throw new Error("After Dark is left out by default: pass --include-after-dark too");
  return o;
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  const db = await openDb({ db: o.db, pglite: o.pglite });
  try {
    const lib = o.observer ? await loadLib() : null;
    await exportPreferences({
      query: db.query,
      lib,
      out: o.out,
      since: o.since ?? null,
      kind: o.kind ?? null,
      context: o.context,
      observer: o.observer,
      includeAfterDark: o.includeAfterDark === true,
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
