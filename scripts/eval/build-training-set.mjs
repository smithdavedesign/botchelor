#!/usr/bin/env node
/**
 * The date actor's training set (ROADMAP #577; docs/data-plan.md "Fine-tuning (#577) when ready"): supervised
 * fine-tuning (SFT) and preference (DPO) JSONL from the lines of aired public dates, held out by character. Read-only
 * and free: no model, nothing written but the files. Nothing trains here; docs/data-plan.md has the local LoRA commands.
 *
 *   DATABASE_URL="$(neon connection-string --profile davejobs-agent --project-id cool-boat-29098893)" \
 *     node scripts/eval/build-training-set.mjs [--out .data/training/<date>] [--seed 577] [--eval-share 0.2]
 *       [--db url | --pglite dir] [--allow-small]
 *
 * Writes, under --out:
 *  - sft/train.jsonl and sft/valid.jsonl: {"messages": [system, user, assistant]}, what `mlx_lm.lora --data` reads.
 *    The system message is the show's own actor prompt with this speaker's sheet, private parts stripped
 *    (lib/training-set.ts actorPrompt); the user message is the conversation so far; the assistant message is the kept
 *    line as the reply JSON the show parses ({"dialogue","action","emotion"}).
 *  - dpo/train.jsonl and dpo/valid.jsonl: {"prompt": [system, user], "chosen": "…", "rejected": "…"}, the replies as
 *    {"dialogue": "…"} JSON (a rejected draft keeps only its words, so both sides keep only theirs).
 *  - manifest.json: the counts, what was dropped and why, the split's sizes and the readiness numbers. No ids.
 *
 * The gates (the same as scripts/eval/export-preferences.mjs, never a copy: lib/ml-consent.ts through lib/training-set.ts):
 *  - only dates that aired publicly (airedPublicSql: never private, unlisted, unaired, report-hidden or After Dark), every
 *    character on them the show's own or opted in by the date's time, and neither a private character;
 *  - votes only from people who had opted in when they voted (collectPreferences, the export's own function);
 *  - never a soul, memory, dealbreaker, never-say, private fact or the date's private context in a prompt, and an example
 *    is dropped when a character's line uses its own dealbreaker's words (lib/training-set.ts dealbreakerWords);
 *  - a rejected draft only when its text was kept (a safety filter's catch keeps none), and never its reason.
 *
 * Which lines (ROADMAP #577: "the lines people kept"):
 *  - SFT keeps a line when it's net 👍 (more opted-in 👍 than 👎), or when it was never flagged (no 👎) and never revised
 *    (no critic draft at that turn).
 *  - DPO pairs: a critic revision against the draft it replaced (the revision chosen), unless the revision went net 👎;
 *    and a net-👍 line against a net-👎 line where both answer the very same prompt (a rare case: the same pair, place and
 *    conversation so far).
 *  - The hold-out is by character (seeded): a character is in train or valid, never both, and an example whose two
 *    characters landed on different sides is dropped, so no character's lines, as speaker or as context, are in both.
 *
 * Readiness: prints #577's gates (lib/training-readiness.ts, the same numbers /admin/analytics shows) and exits 1 under
 * them without writing anything, unless --allow-small (for testing). Every connection is read-only.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { openDb } from "./after-dark-observer.mjs";
import { collectPreferences, loadLib } from "./export-preferences.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const asArray = (v) => (Array.isArray(v) ? v : typeof v === "string" ? JSON.parse(v) : []);
const asObject = (v) => (v && typeof v === "object" ? v : typeof v === "string" ? JSON.parse(v) : null);

export const DEFAULT_SEED = "577";
export const DEFAULT_EVAL_SHARE = 0.2;
/** At most this many vote pairs from one shared prompt, so one popular moment can't fill the set. */
const PAIRS_PER_PROMPT = 4;

/** lib/training-set.ts: the prompt builder, the consent and aired-public SQL, the readiness, our own ids. */
export const loadTrainingLib = () => loadLib("lib/training-set.ts");

/** FNV-1a, so a character's side of the split is stable for a seed and doesn't move when others join. */
export function hash32(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** Which side of the hold-out a character is on: "valid" for about `share` of characters, by seed. */
export const splitOf = (characterId, seed = DEFAULT_SEED, share = DEFAULT_EVAL_SHARE) => (hash32(`${seed}:${characterId}`) / 2 ** 32 < share ? "valid" : "train");

/** A query function as a lib Db (lib/training-readiness.ts and lib/our-traffic.ts read `.rows`). */
export const libDb = (query) => ({ query: async (sql, params) => ({ rows: await query(sql, params) }) });

/** A character row (prefix a_ or b_) with the date's snapshot of the sheet over it (setup.sheet_a/b), as SheetRow. */
function sheetOf(row, p, snap) {
  const s = snap && typeof snap === "object" ? snap : {};
  return {
    id: row[`${p}_id`],
    name: s.name ?? row[`${p}_name`],
    age: Number(s.age ?? row[`${p}_age`]),
    bio: s.bio ?? row[`${p}_bio`] ?? "",
    traits: asArray(s.traits ?? row[`${p}_traits`]),
    want: s.want ?? row[`${p}_want`] ?? "",
    dealbreaker: s.dealbreaker ?? row[`${p}_dealbreaker`] ?? "",
    is_house: Boolean(row[`${p}_house`]),
    appearance: s.appearance ?? row[`${p}_appearance`] ?? null,
    pronouns: s.pronouns ?? row[`${p}_pronouns`] ?? null,
    voice: s.voice ?? row[`${p}_voice`] ?? null,
    extras: asObject(row[`${p}_extras`]) ?? {},
  };
}

const CHARACTER_COLUMNS = (p) =>
  ["id", "name", "age", "bio", "traits", "want", "dealbreaker", "appearance", "pronouns", "voice", "extras"].map((c) => `${p}.${c} as ${p}_${c}`).join(", ") + `, ${p}.is_house as ${p}_house`;

/**
 * Every date the gates admit, with its two characters (lib/training-set.ts SQL), and the critic drafts on them. The
 * votes come from collectPreferences (the export's own gates and tallies).
 */
async function loadDates(query, lib) {
  const dates = await query(
    `select e.id, e.transcript, e.setup, e.seed, e.followup_of, e.turn_meta, ${CHARACTER_COLUMNS("a")}, ${CHARACTER_COLUMNS("b")}
       from episodes e join characters a on a.id = e.character_a join characters b on b.id = e.character_b
      where ${lib.airedPublicSql("e")} and ${lib.consentedCharactersSql("a", "b", "e.created_at")} and ${lib.PUBLIC_CHARACTERS_SQL}
      order by e.created_at, e.id`,
  );
  const ids = dates.map((d) => d.id);
  const drafts = ids.length
    ? await query(`select episode_id, turn_index, side, rejected from turn_drafts where source = 'critic' and rejected is not null and episode_id = any($1) order by id`, [ids])
    : [];
  return { dates, drafts };
}

/**
 * The whole set from a read-only query function: SFT and DPO examples by split, the counts and the readiness. deps: lib
 * (lib/training-set.ts; loaded when not given), seed, evalShare.
 */
export async function buildTrainingSet(query, { lib = null, seed = DEFAULT_SEED, evalShare = DEFAULT_EVAL_SHARE } = {}) {
  const ts = lib ?? (await loadTrainingLib());
  const db = libDb(query);
  const ours = new Set(await ts.loadOurIds(db));
  const readiness = ts.fineTuneFrom(await ts.loadLineLabels(db), ours);

  // The votes, through the export's own gates (public, aired, consenting characters, opted-in voters only).
  const prefs = await collectPreferences(query, { consent: ts, context: 0 });
  const votes = new Map(prefs.records.map((r) => [`${r.ref_id}#${r.line_index}`, r.votes]));
  const { dates, drafts } = await loadDates(query, ts);
  const draftsAt = new Map();
  for (const d of drafts) {
    const key = `${d.episode_id}#${Number(d.turn_index)}`;
    draftsAt.set(key, [...(draftsAt.get(key) ?? []), d]);
  }

  const counts = {
    dates: dates.length,
    lines: 0,
    sft: { train: 0, valid: 0 },
    dpo: { train: 0, valid: 0, critic: 0, votes: 0 },
    by: {},
    dropped: { flagged_or_revised: 0, dealbreaker_words: 0, cross_split: 0, bad_line: 0, chosen_net_down: 0, same_text: 0 },
  };
  const out = { sft: { train: [], valid: [] }, dpo: { train: [], valid: [] } };
  const characters = { train: new Set(), valid: new Set() };
  /** Lines with a net vote, by the exact prompt they answer: where a 👍 and a 👎 meet, a pair. */
  const byPrompt = new Map();

  for (const e of dates) {
    const lines = asArray(e.transcript);
    const setup = asObject(e.setup) ?? {};
    const meta = asArray(e.turn_meta);
    const sheets = { a: sheetOf(e, "a", setup.sheet_a), b: sheetOf(e, "b", setup.sheet_b) };
    const split = { a: splitOf(sheets.a.id, seed, evalShare), b: splitOf(sheets.b.id, seed, evalShare) };
    const together = split.a === split.b ? split.a : null;
    // From the first line where a character uses its own dealbreaker's words on, nothing of this date is used.
    const words = { a: ts.dealbreakerWords(sheets.a.dealbreaker), b: ts.dealbreakerWords(sheets.b.dealbreaker) };
    const tainted = lines.findIndex((l) => (l?.side === "a" || l?.side === "b") && ts.mentionsAny(l.dialogue, words[l.side]));
    const cut = tainted === -1 ? Infinity : tainted;

    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      if (!l || (l.side !== "a" && l.side !== "b") || typeof l.dialogue !== "string" || !l.dialogue.trim()) {
        counts.dropped.bad_line++;
        continue;
      }
      counts.lines++;
      if (i >= cut) {
        counts.dropped.dealbreaker_words++;
        continue;
      }
      if (!together) {
        counts.dropped.cross_split++;
        continue;
      }
      const speaker = sheets[l.side];
      const other = sheets[l.side === "a" ? "b" : "a"];
      const prompt = ts.actorPrompt({ lines, i, speaker, other, setup, seed: e.seed === null || e.seed === undefined ? null : Number(e.seed), metBefore: Boolean(e.followup_of) });
      const key = `${e.id}#${i}`;
      const v = votes.get(key);
      const revisions = (draftsAt.get(key) ?? []).filter((d) => d.side === l.side);
      characters[together].add(speaker.id);
      characters[together].add(other.id);

      // SFT: net 👍, or never flagged and never revised.
      if ((v && v.score > 0) || (!(v && v.down > 0) && !revisions.length)) {
        out.sft[together].push({ messages: [...prompt, { role: "assistant", content: ts.replyJson(l) }] });
        counts.sft[together]++;
        const by = meta[i]?.by ?? "show";
        counts.by[by] = (counts.by[by] ?? 0) + 1;
      } else {
        counts.dropped.flagged_or_revised++;
      }

      // DPO from the critic: the revision that went in over the draft it replaced.
      for (const d of revisions) {
        if (v && v.score < 0) {
          counts.dropped.chosen_net_down++;
          continue;
        }
        if (String(d.rejected).trim() === l.dialogue.trim()) {
          counts.dropped.same_text++;
          continue;
        }
        if (ts.mentionsAny(d.rejected, words[l.side])) {
          counts.dropped.dealbreaker_words++;
          continue;
        }
        out.dpo[together].push({ prompt, chosen: ts.replyJson(l, { dialogueOnly: true }), rejected: ts.replyJson({ dialogue: String(d.rejected) }, { dialogueOnly: true }) });
        counts.dpo[together]++;
        counts.dpo.critic++;
      }

      if (v && v.score !== 0) {
        const pk = JSON.stringify(prompt);
        const entry = byPrompt.get(pk) ?? { prompt, split: together, up: [], down: [] };
        (v.score > 0 ? entry.up : entry.down).push(l);
        byPrompt.set(pk, entry);
      }
    }
  }

  // DPO from votes: a net-👍 line against a net-👎 one at the very same point.
  for (const { prompt, split, up, down } of byPrompt.values()) {
    let n = 0;
    for (const good of up) {
      for (const bad of down) {
        if (n >= PAIRS_PER_PROMPT || good.dialogue.trim() === bad.dialogue.trim()) continue;
        out.dpo[split].push({ prompt, chosen: ts.replyJson(good, { dialogueOnly: true }), rejected: ts.replyJson(bad, { dialogueOnly: true }) });
        counts.dpo[split]++;
        counts.dpo.votes++;
        n++;
      }
    }
  }

  return {
    sft: out.sft,
    dpo: out.dpo,
    counts,
    split: { seed, eval_share: evalShare, train_characters: characters.train.size, valid_characters: characters.valid.size },
    readiness,
  };
}

/** Writes the set under `dir`: sft/ and dpo/ (train.jsonl, valid.jsonl) and manifest.json. Returns the paths. */
export function writeTrainingSet(dir, set, { now = new Date() } = {}) {
  const files = [];
  const jsonl = (rows) => rows.map((r) => JSON.stringify(r)).join("\n") + (rows.length ? "\n" : "");
  for (const kind of ["sft", "dpo"]) {
    mkdirSync(join(dir, kind), { recursive: true });
    for (const split of ["train", "valid"]) {
      const file = join(dir, kind, `${split}.jsonl`);
      writeFileSync(file, jsonl(set[kind][split]));
      files.push(file);
    }
  }
  const manifest = {
    built_at: now.toISOString(),
    issue: "https://github.com/smithdavedesign/botchelor/issues/577",
    counts: set.counts,
    split: set.split,
    readiness: { ready: set.readiness.ready, gates: set.readiness.gates, sentence: set.readiness.sentence },
    after_dark: "never: the privacy page promises it's never used for training",
  };
  const file = join(dir, "manifest.json");
  writeFileSync(file, `${JSON.stringify(manifest, null, 2)}\n`);
  files.push(file);
  return files;
}

/** The readiness as the script prints it, one gate per line. */
export function readinessLines(r, gateText) {
  return [`#577 readiness: ${r.ready ? "ready" : "not yet"}`, ...r.gates.map((g) => `  ${g.label}: ${gateText(g)}${g.met ? "" : " (not yet)"}`), `  ${r.sentence}`];
}

export function parseArgs(argv) {
  const o = { seed: DEFAULT_SEED, evalShare: DEFAULT_EVAL_SHARE, allowSmall: false, out: join(ROOT, ".data", "training", new Date().toISOString().slice(0, 10)) };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--out") o.out = resolve(argv[++i]);
    else if (a === "--seed") o.seed = String(argv[++i]);
    else if (a === "--eval-share") {
      o.evalShare = Number(argv[++i]);
      if (!(o.evalShare > 0 && o.evalShare < 1)) throw new Error("--eval-share is a share between 0 and 1, e.g. 0.2");
    } else if (a === "--db") o.db = argv[++i];
    else if (a === "--pglite") o.pglite = argv[++i];
    else if (a === "--allow-small") o.allowSmall = true;
    else if (a === "--include-after-dark") throw new Error("After Dark is never in a training set: the privacy page promises it's never used for training");
    else throw new Error(`unknown option ${a}`);
  }
  if (!o.seed) throw new Error("--seed needs a value");
  return o;
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  const db = await openDb({ db: o.db, pglite: o.pglite });
  try {
    const lib = await loadTrainingLib();
    const set = await buildTrainingSet(db.query, { lib, seed: o.seed, evalShare: o.evalShare });
    for (const line of readinessLines(set.readiness, lib.gateText)) console.error(`[build-training-set] ${line}`);
    const c = set.counts;
    console.error(
      `[build-training-set] ${c.dates} dates, ${c.lines} lines: SFT ${c.sft.train} train / ${c.sft.valid} valid; ` +
        `DPO ${c.dpo.train} train / ${c.dpo.valid} valid (${c.dpo.critic} critic, ${c.dpo.votes} vote pairs); ` +
        `held out ${set.split.valid_characters} of ${set.split.train_characters + set.split.valid_characters} characters`,
    );
    console.error(`[build-training-set] dropped: ${Object.entries(c.dropped).map(([k, v]) => `${k.replace(/_/g, " ")} ${v}`).join(", ")}`);
    if (!set.readiness.ready && !o.allowSmall) {
      console.error(`[build-training-set] under #577's gate, so nothing was written. Pass --allow-small to build anyway (for testing).`);
      process.exitCode = 1;
      return;
    }
    const files = writeTrainingSet(o.out, set);
    console.error(`[build-training-set] wrote ${files.map((f) => f.replace(`${ROOT}/`, "")).join(", ")}`);
  } finally {
    await db.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((err) => {
    console.error(`[build-training-set] ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  });
}
